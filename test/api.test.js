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
