const path = require('node:path');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const svc = require('./services');
const ai = require('./ai');
const billing = require('./billing');
const stats = require('./stats');
const { renderPdf, fileName } = require('./pdf');
const { publicPlans, getPlan } = require('./plans');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// En-têtes de sécurité de base
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
  });
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Le webhook Stripe a besoin du corps brut : il est déclaré avant express.json().
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billing.handleWebhook);

// Les photos envoyées à l'assistant (tickets, courriers) ont besoin d'une limite plus large.
const jsonSmall = express.json({ limit: '200kb' });
const jsonLarge = express.json({ limit: '12mb' });
app.use((req, res, next) => (req.path === '/api/chat' ? jsonLarge : jsonSmall)(req, res, next));
app.use(auth.loadUser);
app.use(stats.trackPageView);

// Les requêtes qui modifient des données doivent être en JSON (protection CSRF basique avec SameSite=Lax).
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type application/json requis.' });
  }
  next();
});

const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const baseUrl = (req) => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const quoteLink = (req, token) => `${baseUrl(req)}/d/${token}`;

function sendPdf(res, doc, issuer, link) {
  const name = fileName(doc, issuer);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  });
  const pdf = renderPdf(doc, issuer, { link });
  pdf.pipe(res);
  pdf.end();
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const id = (req) => Number(req.params.id);

// ---------- Public ----------
app.get('/api/plans', (_req, res) => res.json({ plans: publicPlans(), demoBilling: billing.isDemo() && billing.demoAllowed() }));

// ---------- Devis en ligne (pour le client de l'artisan, sans compte) ----------
app.get('/d/:token', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'devis.html')));
app.get('/api/public/devis/:token', auth.rateLimit(120, 15 * 60 * 1000), (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(svc.publicQuote(req.params.token));
});
app.get('/api/public/devis/:token/pdf', auth.rateLimit(60, 15 * 60 * 1000), (req, res) => {
  const row = svc.quoteByToken(req.params.token);
  sendPdf(res, svc.hydrateDoc(row), svc.issuerOf(row.user_id), quoteLink(req, row.share_token));
});
app.post('/api/public/devis/:token/accepter', auth.rateLimit(20, 15 * 60 * 1000), (req, res) => {
  if (req.body.accept !== true) throw new svc.AppError('Cochez la case pour accepter le devis.');
  res.json(svc.acceptQuote(req.params.token, { name: req.body.name, ip: req.ip }));
});
app.post('/api/public/devis/:token/refuser', auth.rateLimit(20, 15 * 60 * 1000), (req, res) => {
  res.json(svc.refuseQuote(req.params.token, { reason: req.body.reason }));
});

// ---------- Authentification ----------
app.post('/api/auth/register', auth.rateLimit(10, 15 * 60 * 1000), (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const name = String(req.body.name || '').trim().slice(0, 100);
  const accountType = req.body.accountType === 'artisan' ? 'artisan' : 'foyer';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new svc.AppError('Adresse email invalide.');
  if (password.length < 8) throw new svc.AppError('Le mot de passe doit contenir au moins 8 caractères.');
  if (!name) throw new svc.AppError('Indiquez votre nom.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new svc.AppError('Un compte existe déjà avec cet email.', 409);
  }
  const r = db
    .prepare('INSERT INTO users (email, password_hash, name, account_type, company_name) VALUES (?, ?, ?, ?, ?)')
    .run(email, auth.hashPassword(password), name, accountType, accountType === 'artisan' ? name : null);
  auth.createSession(res, r.lastInsertRowid);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json({ user: auth.publicUser(user) });
});

app.post('/api/auth/login', auth.rateLimit(10, 15 * 60 * 1000), (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password_hash)) {
    throw new svc.AppError('Email ou mot de passe incorrect.', 401);
  }
  auth.createSession(res, user.id);
  res.json({ user: auth.publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

// ---------- Compte ----------
const api = express.Router();
api.use(auth.requireAuth);

api.get('/me', (req, res) => {
  res.json({
    user: auth.publicUser(req.user),
    plan: publicPlans().find((p) => p.id === getPlan(req.user.plan).id),
    usage: svc.getUsage(req.user),
    demoBilling: billing.isDemo() && billing.demoAllowed(),
  });
});

api.patch('/me', (req, res) => {
  const b = req.body;
  const clip = (v, n) => (v === undefined ? undefined : String(v).trim().slice(0, n) || null);
  const fields = {
    name: clip(b.name, 100),
    company_name: clip(b.companyName, 200),
    siret: clip(b.siret, 20),
    address: clip(b.address, 500),
    phone: clip(b.phone, 30),
    vat_rate: b.vatRate === undefined ? undefined : Number(b.vatRate),
    show_branding: b.showBranding === undefined ? undefined : b.showBranding ? 1 : 0,
    urssaf_period: b.urssafPeriod === undefined ? undefined : b.urssafPeriod === 'mensuelle' ? 'mensuelle' : 'trimestrielle',
    share_prefs: b.shareChoices === undefined ? undefined : JSON.stringify(
      Object.fromEntries(['devis', 'facture']
        .map((t) => [t, b.shareChoices?.[t]])
        .filter(([, v]) => Number.isInteger(v) && v >= 0 && v <= 2)),
    ),
  };
  if (fields.vat_rate !== undefined && !(fields.vat_rate >= 0 && fields.vat_rate <= 100)) {
    throw new svc.AppError('Taux de TVA invalide.');
  }
  if (fields.name === null) throw new svc.AppError('Le nom ne peut pas être vide.');
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) db.prepare(`UPDATE users SET ${k} = ? WHERE id = ?`).run(v, req.user.id);
  }
  res.json({ user: auth.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// Suppression du compte et de toutes les données (droit à l'effacement, RGPD)
api.delete('/me', wrap(async (req, res) => {
  if (!auth.verifyPassword(String(req.body.password || ''), req.user.password_hash)) {
    throw new svc.AppError('Mot de passe incorrect.', 401);
  }
  await billing.cancelSubscription(req.user);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  auth.destroySession(req, res);
  res.json({ ok: true });
}));

// Export de toutes les données de l'utilisateur (droit à la portabilité, RGPD)
api.get('/me/export', (req, res) => {
  const uid = req.user.id;
  const all = (table) => db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(uid);
  res.set('Content-Disposition', 'attachment; filename="mdia-mes-donnees.json"');
  res.json({
    compte: auth.publicUser(req.user),
    echeances: all('echeances'),
    operations: all('transactions'),
    clients: all('clients'),
    documents: all('documents').map((d) => ({ ...d, items: JSON.parse(d.items) })),
    tarifs: all('catalog_items'),
    abonnements: all('abonnements'),
    conversation: all('chat_messages'),
  });
});

api.get('/dashboard', (req, res) => res.json(svc.dashboard(req.user)));

// ---------- Assistant IA ----------
api.get('/chat', (req, res) => res.json({ messages: ai.chatHistory(req.user), usage: svc.getUsage(req.user) }));
api.post('/chat', wrap(async (req, res) => res.json(await ai.chat(req.user, req.body.message, req.body.attachment))));
api.delete('/chat', (req, res) => {
  ai.clearHistory(req.user);
  res.json({ ok: true });
});

// ---------- Échéances ----------
api.get('/echeances', (req, res) => res.json({ echeances: svc.listEcheances(req.user, { status: req.query.status }) }));
api.post('/echeances', (req, res) => res.status(201).json({ echeance: svc.createEcheance(req.user, req.body) }));
api.post('/echeances/:id/faite', (req, res) => res.json(svc.completeEcheance(req.user, id(req))));
api.delete('/echeances/:id', (req, res) => {
  svc.deleteEcheance(req.user, id(req));
  res.json({ ok: true });
});

// ---------- Budget ----------
api.get('/transactions', (req, res) =>
  res.json({
    transactions: svc.listTransactions(req.user, { month: req.query.month }),
    summary: svc.budgetSummary(req.user, req.query.month || undefined),
  }),
);
api.post('/transactions', (req, res) => res.status(201).json({ transaction: svc.createTransaction(req.user, req.body) }));
api.delete('/transactions/:id', (req, res) => {
  svc.deleteTransaction(req.user, id(req));
  res.json({ ok: true });
});

// ---------- Clients ----------
api.get('/clients', (req, res) => res.json({ clients: svc.listClients(req.user) }));
api.post('/clients', (req, res) => res.status(201).json({ client: svc.createClient(req.user, req.body) }));
api.delete('/clients/:id', (req, res) => {
  svc.deleteClient(req.user, id(req));
  res.json({ ok: true });
});

// ---------- Devis & factures ----------
api.get('/documents', (req, res) => res.json({ documents: svc.listDocuments(req.user, { type: req.query.type }) }));
api.get('/documents/:id', (req, res) =>
  res.json({ document: svc.getDocument(req.user, id(req)), issuer: auth.publicUser(req.user) }),
);
api.get('/documents/:id/pdf', (req, res) => {
  let doc = svc.getDocument(req.user, id(req));
  // Un devis porte le lien d'acceptation en ligne
  if (doc.type === 'devis') {
    svc.ensureShareToken(req.user, doc.id);
    doc = svc.getDocument(req.user, doc.id);
  }
  sendPdf(res, doc, req.user, doc.share_token ? quoteLink(req, doc.share_token) : null);
});
api.post('/documents/:id/lien', (req, res) => res.json({ url: quoteLink(req, svc.ensureShareToken(req.user, id(req))) }));
api.post('/documents/:id/acompte', (req, res) =>
  res.status(201).json({ document: svc.createDeposit(req.user, id(req), req.body) }),
);
api.post('/documents', (req, res) => res.status(201).json({ document: svc.createDocument(req.user, req.body) }));
api.post('/documents/:id/statut', (req, res) =>
  res.json({ document: svc.updateDocumentStatus(req.user, id(req), req.body.status, req.body) }),
);
api.post('/documents/:id/facturer', (req, res) =>
  res.status(201).json({ document: svc.convertQuoteToInvoice(req.user, id(req)) }),
);
api.delete('/documents/:id', (req, res) => {
  svc.deleteDocument(req.user, id(req));
  res.json({ ok: true });
});

// ---------- Tarifs ----------
api.get('/catalogue', (req, res) => res.json({ items: svc.listCatalog(req.user) }));
api.post('/catalogue', (req, res) => res.status(201).json({ item: svc.saveCatalogItem(req.user, req.body) }));
api.delete('/catalogue/:id', (req, res) => {
  svc.deleteCatalogItem(req.user, id(req));
  res.json({ ok: true });
});

// ---------- Déclaration URSSAF ----------
api.get('/urssaf', (req, res) => res.json(svc.urssafSummary(req.user, { year: req.query.annee, period: req.query.periode })));
api.get('/urssaf/livre-recettes', (req, res) => {
  const year = Number(req.query.annee) || new Date().getFullYear();
  const csv = svc.livreRecettesCsv(req.user, year);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="livre-des-recettes-${year}.csv"` });
  res.send(csv);
});

// ---------- Abonnements du foyer ----------
api.get('/abonnements', (req, res) => res.json(svc.listAbonnements(req.user)));
api.post('/abonnements', (req, res) => res.status(201).json({ abonnement: svc.createAbonnement(req.user, req.body) }));
api.delete('/abonnements/:id', (req, res) => {
  svc.deleteAbonnement(req.user, id(req));
  res.json({ ok: true });
});

// ---------- Abonnement MDIA ----------
api.post('/billing/checkout', wrap(async (req, res) => res.json(await billing.startCheckout(req.user, req.body.plan))));
api.post('/billing/redeem', auth.rateLimit(10, 15 * 60 * 1000), wrap(async (req, res) => res.json(await billing.redeemLifetimeCode(req.user, req.body.code))));
api.post('/billing/portal', wrap(async (req, res) => res.json(await billing.openPortal(req.user))));

// ---------- Administration ----------
api.get('/admin/stats', (req, res) => {
  if (!stats.isAdmin(req.user)) return res.status(404).json({ error: 'Route inconnue.' });
  res.json(stats.adminStats());
});

app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Route inconnue.' }));

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// Gestion centralisée des erreurs
app.use((err, _req, res, _next) => {
  if (err instanceof svc.AppError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Fichier trop lourd.' });
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`MDIA est lancé sur http://localhost:${port}`);
    if (billing.isDemo() && billing.demoAllowed()) console.log('Paiements : mode démo (STRIPE_SECRET_KEY non défini).');
    if (billing.isDemo() && !billing.demoAllowed()) console.log('Paiements : Stripe non configuré, les abonnements payants sont désactivés.');
    billing.ensureStripeSetup().catch(() => {});
    stats.purgeOldViews();
    if (!process.env.ANTHROPIC_API_KEY) console.log("Assistant IA : ANTHROPIC_API_KEY non défini, l'assistant sera indisponible.");
  });
}

module.exports = app;
