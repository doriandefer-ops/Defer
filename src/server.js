const path = require('node:path');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const svc = require('./services');
const ai = require('./ai');
const billing = require('./billing');
const { publicPlans, getPlan } = require('./plans');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Le webhook Stripe a besoin du corps brut : il est déclaré avant express.json().
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billing.handleWebhook);

app.use(express.json({ limit: '200kb' }));
app.use(auth.loadUser);

// Les requêtes qui modifient des données doivent être en JSON (protection CSRF basique avec SameSite=Lax).
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type application/json requis.' });
  }
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const id = (req) => Number(req.params.id);

// ---------- Public ----------
app.get('/api/plans', (_req, res) => res.json({ plans: publicPlans(), demoBilling: billing.isDemo() }));

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
    demoBilling: billing.isDemo(),
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

api.get('/dashboard', (req, res) => res.json(svc.dashboard(req.user)));

// ---------- Assistant IA ----------
api.get('/chat', (req, res) => res.json({ messages: ai.chatHistory(req.user), usage: svc.getUsage(req.user) }));
api.post('/chat', wrap(async (req, res) => res.json(await ai.chat(req.user, req.body.message))));
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
api.post('/documents', (req, res) => res.status(201).json({ document: svc.createDocument(req.user, req.body) }));
api.post('/documents/:id/statut', (req, res) =>
  res.json({ document: svc.updateDocumentStatus(req.user, id(req), req.body.status) }),
);
api.post('/documents/:id/facturer', (req, res) =>
  res.status(201).json({ document: svc.convertQuoteToInvoice(req.user, id(req)) }),
);
api.delete('/documents/:id', (req, res) => {
  svc.deleteDocument(req.user, id(req));
  res.json({ ok: true });
});

// ---------- Abonnement ----------
api.post('/billing/checkout', wrap(async (req, res) => res.json(await billing.startCheckout(req.user, req.body.plan))));
api.post('/billing/portal', wrap(async (req, res) => res.json(await billing.openPortal(req.user))));

app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Route inconnue.' }));

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// Gestion centralisée des erreurs
app.use((err, _req, res, _next) => {
  if (err instanceof svc.AppError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide.' });
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Defer est lancé sur http://localhost:${port}`);
    if (billing.isDemo()) console.log('Paiements : mode démo (STRIPE_SECRET_KEY non défini).');
    if (!process.env.ANTHROPIC_API_KEY) console.log("Assistant IA : ANTHROPIC_API_KEY non défini, l'assistant sera indisponible.");
  });
}

module.exports = app;
