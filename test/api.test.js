process.env.DATABASE_PATH = ':memory:';
process.env.ADMIN_EMAILS = 'admin@test.fr';
process.env.RATE_LIMIT_DISABLED = 'true';
delete process.env.STRIPE_SECRET_KEY;

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/server');

let server;
let base;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

function agent() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

test('inscription, connexion et accès protégé', async () => {
  const a = agent();
  assert.equal((await a('/me')).status, 401);
  const reg = await a('/auth/register', { method: 'POST', body: { email: 'foyer@test.fr', password: 'motdepasse', name: 'Alice' } });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.plan, 'gratuit');
  const dup = await a('/auth/register', { method: 'POST', body: { email: 'foyer@test.fr', password: 'motdepasse', name: 'A' } });
  assert.equal(dup.status, 409);
  const me = await a('/me');
  assert.equal(me.body.usage.limit, 10);

  const b = agent();
  assert.equal((await b('/auth/login', { method: 'POST', body: { email: 'foyer@test.fr', password: 'mauvais!' } })).status, 401);
  assert.equal((await b('/auth/login', { method: 'POST', body: { email: 'foyer@test.fr', password: 'motdepasse' } })).status, 200);
});

test("l'offre gratuite est limitée", async () => {
  const a = agent();
  await a('/auth/register', { method: 'POST', body: { email: 'free@test.fr', password: 'motdepasse', name: 'Bob' } });
  for (let i = 0; i < 5; i++) {
    const r = await a('/echeances', { method: 'POST', body: { title: `E${i}`, due_date: '2026-12-01' } });
    assert.equal(r.status, 201);
  }
  assert.equal((await a('/echeances', { method: 'POST', body: { title: 'E6', due_date: '2026-12-01' } })).status, 403);
  assert.equal((await a('/transactions', { method: 'POST', body: { type: 'depense', label: 'x', amount: 5 } })).status, 403);
  assert.equal((await a('/documents')).status, 403);
});

test('offre Foyer : budget et échéances récurrentes', async () => {
  const a = agent();
  await a('/auth/register', { method: 'POST', body: { email: 'f2@test.fr', password: 'motdepasse', name: 'Chloé' } });
  const up = await a('/billing/checkout', { method: 'POST', body: { plan: 'foyer' } });
  assert.equal(up.body.demo, true);
  assert.equal((await a('/me')).body.plan.id, 'foyer');

  await a('/transactions', { method: 'POST', body: { type: 'revenu', label: 'Salaire', amount: 2000, date: '2026-10-01' } });
  await a('/transactions', { method: 'POST', body: { type: 'depense', label: 'Courses', amount: '86,40', category: 'courses', date: '2026-10-02' } });
  const t = await a('/transactions?month=2026-10');
  assert.equal(t.body.summary.solde, 1913.6);

  const e = await a('/echeances', { method: 'POST', body: { title: 'Loyer', due_date: '2026-01-31', recurrence: 'mensuelle', amount: 700 } });
  const done = await a(`/echeances/${e.body.echeance.id}/faite`, { method: 'POST', body: {} });
  assert.equal(done.body.next.due_date, '2026-02-28'); // 31 janvier + 1 mois → fin février
  assert.equal((await a('/clients')).status, 403);
});

test('offre Artisan : devis, facture, TVA et numérotation', async () => {
  const a = agent();
  await a('/auth/register', { method: 'POST', body: { email: 'art@test.fr', password: 'motdepasse', name: 'Plomberie Dupont', accountType: 'artisan' } });
  await a('/billing/checkout', { method: 'POST', body: { plan: 'artisan' } });
  const q = await a('/documents', {
    method: 'POST',
    body: {
      type: 'devis',
      client_name: 'Mme Martin',
      items: [
        { description: 'Pose carrelage', quantity: 12, unit: 'm²', unit_price: 45 },
        { description: 'Préparation', quantity: 2, unit: 'h', unit_price: 40, vat_rate: 10 },
      ],
    },
  });
  assert.equal(q.status, 201);
  const year = new Date().getFullYear();
  assert.equal(q.body.document.number, `D-${year}-0001`);
  assert.equal(q.body.document.total_ht, 620);
  assert.equal(q.body.document.total_tva, 116);
  assert.equal(q.body.document.total_ttc, 736);
  assert.equal(q.body.document.client.name, 'Mme Martin');

  const inv = await a(`/documents/${q.body.document.id}/facturer`, { method: 'POST', body: {} });
  assert.equal(inv.body.document.number, `F-${year}-0001`);
  assert.equal(inv.body.document.total_ttc, 736);

  const bad = await a(`/documents/${inv.body.document.id}/statut`, { method: 'POST', body: { status: 'accepte' } });
  assert.equal(bad.status, 400);
  await a(`/documents/${inv.body.document.id}/statut`, { method: 'POST', body: { status: 'envoyee' } });
  const dash = await a('/dashboard');
  assert.equal(dash.body.facturation.impayees, 1);
  assert.equal(dash.body.facturation.montantImpaye, 736);

  // Un autre utilisateur ne peut pas lire ce document
  const other = agent();
  await other('/auth/register', { method: 'POST', body: { email: 'other@test.fr', password: 'motdepasse', name: 'X', accountType: 'artisan' } });
  await other('/billing/checkout', { method: 'POST', body: { plan: 'artisan' } });
  assert.equal((await other(`/documents/${q.body.document.id}`)).status, 404);
});

test("l'assistant répond 503 sans clé API et ne consomme pas de quota", async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  const a = agent();
  await a('/auth/register', { method: 'POST', body: { email: 'ai@test.fr', password: 'motdepasse', name: 'Dan' } });
  const r = await a('/chat', { method: 'POST', body: { message: 'Bonjour' } });
  assert.equal(r.status, 503);
  assert.equal((await a('/me')).body.usage.used, 0);
  if (key) process.env.ANTHROPIC_API_KEY = key;
});

test('outils IA filtrés selon l’offre', () => {
  const ai = require('../src/ai');
  const names = (plan) => ai.toolsFor({ plan }).map((t) => t.name);
  assert.ok(!names('gratuit').includes('creer_document'));
  assert.ok(!names('gratuit').includes('ajouter_operation'));
  assert.ok(names('foyer').includes('ajouter_operation'));
  assert.ok(!names('foyer').includes('creer_document'));
  assert.ok(names('artisan').includes('creer_document'));
});

test('en production sans Stripe, les offres payantes ne sont pas accordées gratuitement', async () => {
  process.env.NODE_ENV = 'production';
  try {
    const a = agent();
    await a('/auth/register', { method: 'POST', body: { email: 'prod@test.fr', password: 'motdepasse', name: 'Eve' } });
    const r = await a('/billing/checkout', { method: 'POST', body: { plan: 'artisan' } });
    assert.equal(r.status, 503);
    assert.equal((await a('/me')).body.plan.id, 'gratuit');
    assert.equal((await a('/me')).body.demoBilling, false);
  } finally {
    delete process.env.NODE_ENV;
  }
});

test('export des données et suppression du compte', async () => {
  const a = agent();
  await a('/auth/register', { method: 'POST', body: { email: 'rgpd@test.fr', password: 'motdepasse', name: 'Fred' } });
  await a('/echeances', { method: 'POST', body: { title: 'Impôts', due_date: '2026-11-15' } });
  const exp = await a('/me/export');
  assert.equal(exp.body.compte.email, 'rgpd@test.fr');
  assert.equal(exp.body.echeances.length, 1);

  assert.equal((await a('/me', { method: 'DELETE', body: { password: 'mauvais!' } })).status, 401);
  assert.equal((await a('/me', { method: 'DELETE', body: { password: 'motdepasse' } })).status, 200);
  assert.equal((await a('/me')).status, 401);
  const b = agent();
  assert.equal((await b('/auth/login', { method: 'POST', body: { email: 'rgpd@test.fr', password: 'motdepasse' } })).status, 401);
});

test('statistiques : visites anonymes et accès réservé à l’administrateur', async () => {
  const ua = { 'User-Agent': 'Mozilla/5.0 (Macintosh) Safari/605' };
  await fetch(base.replace('/api', '/'), { headers: { ...ua, Referer: 'https://www.google.com/search' } });
  await fetch(base.replace('/api', '/cgv'), { headers: ua });
  await fetch(base.replace('/api', '/?utm=flyer'), { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Mobile' } });
  await fetch(base.replace('/api', '/'), { headers: { 'User-Agent': 'Googlebot/2.1' } }); // robot ignoré
  await fetch(base.replace('/api', '/app.js'), { headers: ua }); // fichier, pas une page

  const user = agent();
  await user('/auth/register', { method: 'POST', body: { email: 'curieux@test.fr', password: 'motdepasse', name: 'C' } });
  assert.equal((await user('/admin/stats')).status, 404);
  assert.equal((await user('/me')).body.user.isAdmin, false);

  const admin = agent();
  await admin('/auth/register', { method: 'POST', body: { email: 'admin@test.fr', password: 'motdepasse', name: 'Admin' } });
  assert.equal((await admin('/me')).body.user.isAdmin, true);
  const s = (await admin('/admin/stats')).body;
  assert.equal(s.visits.today, 2); // même visiteur sur 2 pages = 1 visiteur, + 1 via le flyer
  assert.equal(s.visits.views30, 3);
  assert.deepEqual(s.visits.topReferrers.map((r) => r.referrer).sort(), ['Flyer (QR code)', 'google.com']);
  assert.equal(s.daily.length, 30);
  assert.ok(s.users.total >= 2);
  assert.ok(s.users.recent.some((u) => u.email === 'curieux@test.fr'));
});

test('envoi au client : PDF du document et message mémorisé', async () => {
  const a = agent();
  await a('/auth/register', { method: 'POST', body: { email: 'pdf@test.fr', password: 'motdepasse', name: 'Carrelage Dupont', accountType: 'artisan' } });
  await a('/billing/checkout', { method: 'POST', body: { plan: 'artisan' } });
  const q = await a('/documents', {
    method: 'POST',
    body: { type: 'devis', client_name: 'Mme Martin', items: [{ description: 'Pose carrelage', quantity: 12, unit: 'm²', unit_price: 45 }] },
  });
  const me = await a('/me');

  // Le PDF se télécharge avec le bon type et un nom lisible
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pdf@test.fr', password: 'motdepasse' }),
  });
  const sid = login.headers.get('set-cookie').split(';')[0];
  const res = await fetch(`${base}/documents/${q.body.document.id}/pdf`, { headers: { cookie: sid } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(decodeURIComponent(res.headers.get('content-disposition')), /Devis D-\d{4}-0001 - Carrelage Dupont\.pdf/);
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  // « Ne plus me demander » : seul un choix valide (0, 1 ou 2) par type est gardé
  assert.deepEqual(me.body.user.shareChoices, {});
  await a('/me', { method: 'PATCH', body: { shareChoices: { devis: 2, facture: 7, autre: 1 } } });
  assert.deepEqual((await a('/me')).body.user.shareChoices, { devis: 2 });
  await a('/me', { method: 'PATCH', body: { shareChoices: {} } });
  assert.deepEqual((await a('/me')).body.user.shareChoices, {});

  // Un autre compte ne peut pas récupérer ce PDF
  const other = agent();
  await other('/auth/register', { method: 'POST', body: { email: 'pdf2@test.fr', password: 'motdepasse', name: 'Y', accountType: 'artisan' } });
  await other('/billing/checkout', { method: 'POST', body: { plan: 'artisan' } });
  const o = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'pdf2@test.fr', password: 'motdepasse' }) });
  const r2 = await fetch(`${base}/documents/${q.body.document.id}/pdf`, { headers: { cookie: o.headers.get('set-cookie').split(';')[0] } });
  assert.equal(r2.status, 404);
});

test('code « Artisan gratuit à vie » : valable une seule fois', async () => {
  process.env.LIFETIME_CODES = 'MDIA-TEST-1234, AUTRE-CODE';
  try {
    const a = agent();
    await a('/auth/register', { method: 'POST', body: { email: 'vie@test.fr', password: 'motdepasse', name: 'Pierre' } });
    assert.equal((await a('/billing/redeem', { method: 'POST', body: { code: 'FAUX' } })).status, 400);
    assert.equal((await a('/billing/redeem', { method: 'POST', body: { code: ' mdia-test-1234 ' } })).status, 200);
    const me = (await a('/me')).body;
    assert.equal(me.plan.id, 'artisan');
    assert.equal(me.user.lifetime, true);
    assert.equal((await a('/documents')).status, 200);
    assert.equal((await a('/billing/checkout', { method: 'POST', body: { plan: 'foyer' } })).status, 400);

    const b = agent();
    await b('/auth/register', { method: 'POST', body: { email: 'vie2@test.fr', password: 'motdepasse', name: 'Paul' } });
    const again = await b('/billing/redeem', { method: 'POST', body: { code: 'MDIA-TEST-1234' } });
    assert.equal(again.status, 400);
    assert.match(again.body.error, /déjà été utilisé/);
    assert.equal((await b('/me')).body.plan.id, 'gratuit');
  } finally {
    delete process.env.LIFETIME_CODES;
  }
});

async function artisan(email) {
  const a = agent();
  await a('/auth/register', { method: 'POST', body: { email, password: 'motdepasse', name: 'Maçonnerie Leroy', accountType: 'artisan' } });
  await a('/billing/checkout', { method: 'POST', body: { plan: 'artisan' } });
  return a;
}
const pub = async (path, body) => {
  const res = await fetch(`${base}/public/devis/${path}`, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {});
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : null, res };
};

test('devis accepté en ligne par le client, sans compte', async () => {
  const a = await artisan('ligne@test.fr');
  const q = (await a('/documents', { method: 'POST', body: { type: 'devis', client_name: 'M. Petit', items: [{ description: 'Muret', unit_price: 1000 }] } })).body.document;
  const { url } = (await a(`/documents/${q.id}/lien`, { method: 'POST', body: {} })).body;
  const token = url.split('/d/')[1];
  assert.match(token, /^[\w-]{24}$/);
  assert.equal((await a(`/documents/${q.id}/lien`, { method: 'POST', body: {} })).body.url, url); // lien stable

  assert.equal((await pub('inconnu-inconnu-inconnu')).status, 404);
  const view = await pub(token);
  assert.equal(view.status, 200);
  assert.equal(view.body.document.number, q.number);
  assert.equal(view.body.issuer.companyName, 'Maçonnerie Leroy');
  assert.equal(view.body.document.client.email, undefined); // pas de données inutiles
  assert.equal(view.body.document.share_token, undefined);
  assert.equal((await pub(`${token}/pdf`)).res.headers.get('content-type'), 'application/pdf');

  assert.equal((await pub(`${token}/accepter`, { name: 'Jean Petit' })).status, 400); // case non cochée
  const ok = await pub(`${token}/accepter`, { name: 'Jean Petit', accept: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.document.status, 'accepte');
  assert.equal((await pub(`${token}/accepter`, { name: 'Jean Petit', accept: true })).status, 409);
  assert.equal((await pub(`${token}/refuser`, {})).status, 409);

  const doc = (await a(`/documents/${q.id}`)).body.document;
  assert.equal(doc.status, 'accepte');
  assert.equal(doc.accepted_name, 'Jean Petit');
  assert.ok(doc.viewed_at);
  assert.equal((await a('/dashboard')).body.reponsesDevis[0].number, q.number);

  // Un devis expiré ne peut plus être accepté ; une facture n'a pas de lien
  const old = (await a('/documents', { method: 'POST', body: { type: 'devis', due_date: '2020-01-01', items: [{ description: 'X', unit_price: 10 }] } })).body.document;
  const oldToken = (await a(`/documents/${old.id}/lien`, { method: 'POST', body: {} })).body.url.split('/d/')[1];
  assert.equal((await pub(`${oldToken}/accepter`, { name: 'Jean Petit', accept: true })).status, 409);
  const inv = (await a('/documents', { method: 'POST', body: { type: 'facture', items: [{ description: 'X', unit_price: 10 }] } })).body.document;
  assert.equal((await a(`/documents/${inv.id}/lien`, { method: 'POST', body: {} })).status, 400);
});

test('acompte puis facture finale : les acomptes sont déduits', async () => {
  const a = await artisan('acompte@test.fr');
  const q = (await a('/documents', {
    method: 'POST',
    body: { type: 'devis', client_name: 'Mme Roux', items: [
      { description: 'Salle de bain', quantity: 1, unit_price: 1000, vat_rate: 10 },
      { description: 'Meuble', quantity: 1, unit_price: 500, vat_rate: 20 },
    ] },
  })).body.document;
  assert.equal(q.total_ttc, 1700);
  const dep = await a(`/documents/${q.id}/acompte`, { method: 'POST', body: { percent: 30 } });
  assert.equal(dep.status, 201);
  assert.equal(dep.body.document.kind, 'acompte');
  assert.equal(dep.body.document.total_ttc, 510);
  assert.equal(dep.body.document.items.length, 2); // une ligne par taux de TVA
  assert.equal((await a(`/documents/${q.id}/acompte`, { method: 'POST', body: { percent: 80 } })).status, 400); // dépasse 100 %
  const final = (await a(`/documents/${q.id}/facturer`, { method: 'POST', body: {} })).body.document;
  assert.equal(final.total_ttc, 1190);
  assert.equal(final.total_ht, 1050);
});

test('mes prix, encaissement et déclaration URSSAF', async () => {
  const a = await artisan('urssaf@test.fr');
  await a('/catalogue', { method: 'POST', body: { label: 'Pose carrelage', unit: 'm²', unit_price: 45 } });
  await a('/catalogue', { method: 'POST', body: { label: 'pose carrelage', unit: 'm²', unit_price: 48 } }); // mise à jour, pas de doublon
  const { items } = (await a('/catalogue')).body;
  assert.equal(items.length, 1);
  assert.equal(items[0].unit_price, 48);
  const ai = require('../src/ai');
  const db = require('../src/db');
  const user = db.prepare("SELECT * FROM users WHERE email = 'urssaf@test.fr'").get();
  assert.match(ai.userContext(user), /pose carrelage : 48 € \/ m²/i);

  const year = new Date().getFullYear();
  const f = (await a('/documents', { method: 'POST', body: { type: 'facture', client_name: 'M. Blanc', items: [{ description: 'Pose', quantity: 10, unit_price: 48 }] } })).body.document;
  assert.equal((await a(`/documents/${f.id}/statut`, { method: 'POST', body: { status: 'payee', paid_at: '2999-01-01' } })).status, 400);
  await a(`/documents/${f.id}/statut`, { method: 'POST', body: { status: 'payee', paid_at: `${year}-01-15`, payment_method: 'cheque' } });
  const t = (await a(`/urssaf?annee=${year}&periode=trimestrielle`)).body;
  assert.equal(t.periods.length, 4);
  assert.equal(t.periods[0].total_ht, 480);
  assert.equal(t.periods[0].deadline, `${year}-04-30`);
  const m = (await a(`/urssaf?annee=${year}&periode=mensuelle`)).body;
  assert.equal(m.periods[0].total_ht, 480);
  assert.equal(m.periods[0].deadline, new Date(Date.UTC(year, 2, 0)).toISOString().slice(0, 10)); // fin février

  const res = await fetch(`${base}/urssaf/livre-recettes?annee=${year}`, { headers: { cookie: (await loginCookie('urssaf@test.fr')) } });
  const csv = await res.text();
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(csv, /"15\/01\/\d{4}";"F-\d{4}-0001";"M. Blanc";"Pose";"480,00";"576,00";"Chèque"/);

  // Repasser la facture en « envoyée » la retire du chiffre d'affaires
  await a(`/documents/${f.id}/statut`, { method: 'POST', body: { status: 'envoyee' } });
  assert.equal((await a(`/urssaf?annee=${year}`)).body.total_ht, 0);
});

async function loginCookie(email) {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'motdepasse' }) });
  return r.headers.get('set-cookie').split(';')[0];
}

test('abonnements du foyer : coût et renouvellement', async () => {
  const free = agent();
  await free('/auth/register', { method: 'POST', body: { email: 'abo-free@test.fr', password: 'motdepasse', name: 'Léa' } });
  assert.equal((await free('/abonnements')).status, 403);

  const a = agent();
  await a('/auth/register', { method: 'POST', body: { email: 'abo@test.fr', password: 'motdepasse', name: 'Léa' } });
  await a('/billing/checkout', { method: 'POST', body: { plan: 'foyer' } });
  await a('/abonnements', { method: 'POST', body: { name: 'Box', category: 'internet', amount: 30, frequency: 'mensuelle', next_renewal: '2020-01-10' } });
  await a('/abonnements', { method: 'POST', body: { name: 'Assurance', amount: 240, frequency: 'annuelle' } });
  const r = (await a('/abonnements')).body;
  assert.equal(r.totalMensuel, 50);
  assert.equal(r.totalAnnuel, 600);
  const box = r.abonnements.find((x) => x.name === 'Box');
  assert.ok(box.next_renewal >= new Date().toISOString().slice(0, 10)); // date passée → avancée au prochain mois
  assert.ok(box.next_renewal.endsWith('-10'));
  assert.ok((await a('/dashboard')).body.renouvellements.some((x) => x.name === 'Box'));
});

test('photo envoyée à l’assistant : format vérifié', async () => {
  const a = agent();
  await a('/auth/register', { method: 'POST', body: { email: 'photo@test.fr', password: 'motdepasse', name: 'Max' } });
  const key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-test'; // la vérification du fichier a lieu avant tout appel à Claude
  const bad = await a('/chat', { method: 'POST', body: { message: '', attachment: { media_type: 'text/html', data: 'PGI+' } } });
  assert.equal(bad.status, 400);
  const big = await a('/chat', { method: 'POST', body: { message: 'x', attachment: { media_type: 'image/jpeg', data: 'A'.repeat(7 * 1024 * 1024) } } });
  assert.equal(big.status, 400);
  assert.equal((await a('/me')).body.usage.used, 0); // refusé avant de consommer un message
  if (key) process.env.ANTHROPIC_API_KEY = key;
  else delete process.env.ANTHROPIC_API_KEY;
});
