// Opérations métier partagées entre l'API REST et les outils de l'assistant IA.
// Chaque fonction vérifie les droits liés à l'offre de l'utilisateur.
const db = require('./db');
const { getPlan, hasFeature } = require('./plans');

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const ECHEANCE_CATEGORIES = ['impots', 'loyer', 'energie', 'assurance', 'banque', 'sante', 'abonnement', 'vehicule', 'urssaf', 'tva', 'fournisseur', 'autre'];
const RECURRENCES = ['aucune', 'mensuelle', 'trimestrielle', 'annuelle'];
const DOC_STATUSES = {
  devis: ['brouillon', 'envoye', 'accepte', 'refuse'],
  facture: ['brouillon', 'envoyee', 'payee', 'en_retard', 'annulee'],
};

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);
const round2 = (n) => Math.round(n * 100) / 100;

function requireFeature(user, feature) {
  if (!hasFeature(user, feature)) {
    const needed = feature === 'clients' || feature === 'documents' ? 'Artisan' : 'Foyer ou Artisan';
    throw new AppError(`Cette fonctionnalité nécessite l'offre ${needed}.`, 403);
  }
}

function checkQuota(user, table, limitKey, label) {
  const limit = getPlan(user.plan).limits[limitKey];
  if (!Number.isFinite(limit)) return;
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(user.id);
  if (n >= limit) {
    throw new AppError(
      `Limite atteinte : ${limit} ${label} maximum avec l'offre ${getPlan(user.plan).name}. Passez à une offre supérieure pour continuer.`,
      403,
    );
  }
}

function str(v, field, { required = false, max = 500 } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new AppError(`Le champ « ${field} » est obligatoire.`);
    return null;
  }
  const s = String(v).trim();
  if (required && !s) throw new AppError(`Le champ « ${field} » est obligatoire.`);
  return s.slice(0, max);
}

function num(v, field, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new AppError(`Le champ « ${field} » est obligatoire.`);
    return null;
  }
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) throw new AppError(`Le champ « ${field} » doit être un nombre.`);
  return round2(n);
}

function date(v, field, { required = false } = {}) {
  const s = str(v, field, { required, max: 10 });
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new AppError(`Le champ « ${field} » doit être une date AAAA-MM-JJ.`);
  return s;
}

function oneOf(v, list, fallback) {
  return list.includes(v) ? v : fallback;
}

// ---------- Usage IA ----------
function getUsage(user) {
  const row = db.prepare('SELECT ai_messages FROM usage WHERE user_id = ? AND month = ?').get(user.id, currentMonth());
  const limit = getPlan(user.plan).limits.aiMessagesPerMonth;
  return { used: row ? row.ai_messages : 0, limit };
}

function consumeAiMessage(user) {
  const { used, limit } = getUsage(user);
  if (used >= limit) {
    throw new AppError(
      `Vous avez utilisé vos ${limit} messages IA du mois avec l'offre ${getPlan(user.plan).name}. Passez à une offre supérieure pour continuer.`,
      403,
    );
  }
  db.prepare(
    `INSERT INTO usage (user_id, month, ai_messages) VALUES (?, ?, 1)
     ON CONFLICT(user_id, month) DO UPDATE SET ai_messages = ai_messages + 1`,
  ).run(user.id, currentMonth());
}

// ---------- Échéances ----------
function listEcheances(user, { status } = {}) {
  const rows = status
    ? db.prepare('SELECT * FROM echeances WHERE user_id = ? AND status = ? ORDER BY due_date').all(user.id, status)
    : db.prepare('SELECT * FROM echeances WHERE user_id = ? ORDER BY status DESC, due_date').all(user.id);
  return rows;
}

function createEcheance(user, input) {
  requireFeature(user, 'echeances');
  checkQuota(user, 'echeances', 'echeances', 'échéances');
  const r = db
    .prepare(
      `INSERT INTO echeances (user_id, title, category, amount, due_date, recurrence, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.id,
      str(input.title, 'titre', { required: true, max: 200 }),
      oneOf(input.category, ECHEANCE_CATEGORIES, 'autre'),
      num(input.amount, 'montant'),
      date(input.due_date, 'date', { required: true }),
      oneOf(input.recurrence, RECURRENCES, 'aucune'),
      str(input.notes, 'notes', { max: 1000 }),
    );
  return db.prepare('SELECT * FROM echeances WHERE id = ?').get(r.lastInsertRowid);
}

function addPeriod(isoDate, recurrence) {
  const [y, m, day] = isoDate.split('-').map(Number);
  const months = { mensuelle: 1, trimestrielle: 3, annuelle: 12 }[recurrence];
  // On reste sur le dernier jour du mois si besoin (31 janvier → 28/29 février).
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

// Marque une échéance comme faite ; si elle est récurrente, la suivante est créée.
function completeEcheance(user, id) {
  const e = db.prepare('SELECT * FROM echeances WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!e) throw new AppError('Échéance introuvable.', 404);
  db.prepare("UPDATE echeances SET status = 'faite' WHERE id = ?").run(id);
  let next = null;
  if (e.recurrence !== 'aucune') {
    const r = db
      .prepare(
        `INSERT INTO echeances (user_id, title, category, amount, due_date, recurrence, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(user.id, e.title, e.category, e.amount, addPeriod(e.due_date, e.recurrence), e.recurrence, e.notes);
    next = db.prepare('SELECT * FROM echeances WHERE id = ?').get(r.lastInsertRowid);
  }
  return { done: { ...e, status: 'faite' }, next };
}

function deleteEcheance(user, id) {
  const r = db.prepare('DELETE FROM echeances WHERE id = ? AND user_id = ?').run(id, user.id);
  if (!r.changes) throw new AppError('Échéance introuvable.', 404);
}

// ---------- Budget ----------
function listTransactions(user, { month } = {}) {
  if (month) {
    return db
      .prepare("SELECT * FROM transactions WHERE user_id = ? AND substr(date, 1, 7) = ? ORDER BY date DESC, id DESC")
      .all(user.id, month);
  }
  return db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 200').all(user.id);
}

function createTransaction(user, input) {
  requireFeature(user, 'budget');
  checkQuota(user, 'transactions', 'transactions', 'opérations');
  const type = input.type === 'revenu' ? 'revenu' : 'depense';
  const amount = num(input.amount, 'montant', { required: true });
  if (amount <= 0) throw new AppError('Le montant doit être positif.');
  const r = db
    .prepare('INSERT INTO transactions (user_id, type, label, category, amount, date) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      user.id,
      type,
      str(input.label, 'libellé', { required: true, max: 200 }),
      str(input.category, 'catégorie', { max: 50 }) || 'autre',
      amount,
      date(input.date, 'date') || today(),
    );
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(r.lastInsertRowid);
}

function deleteTransaction(user, id) {
  const r = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(id, user.id);
  if (!r.changes) throw new AppError('Opération introuvable.', 404);
}

function budgetSummary(user, month = currentMonth()) {
  requireFeature(user, 'budget');
  const rows = db
    .prepare(
      `SELECT type, category, SUM(amount) AS total FROM transactions
       WHERE user_id = ? AND substr(date, 1, 7) = ? GROUP BY type, category ORDER BY total DESC`,
    )
    .all(user.id, month);
  const revenus = round2(rows.filter((r) => r.type === 'revenu').reduce((s, r) => s + r.total, 0));
  const depenses = round2(rows.filter((r) => r.type === 'depense').reduce((s, r) => s + r.total, 0));
  return {
    month,
    revenus,
    depenses,
    solde: round2(revenus - depenses),
    parCategorie: rows.map((r) => ({ ...r, total: round2(r.total) })),
  };
}

// ---------- Clients ----------
function listClients(user) {
  requireFeature(user, 'clients');
  return db.prepare('SELECT * FROM clients WHERE user_id = ? ORDER BY name').all(user.id);
}

function createClient(user, input) {
  requireFeature(user, 'clients');
  checkQuota(user, 'clients', 'clients', 'clients');
  const r = db
    .prepare('INSERT INTO clients (user_id, name, email, phone, address) VALUES (?, ?, ?, ?, ?)')
    .run(
      user.id,
      str(input.name, 'nom', { required: true, max: 200 }),
      str(input.email, 'email', { max: 200 }),
      str(input.phone, 'téléphone', { max: 50 }),
      str(input.address, 'adresse', { max: 500 }),
    );
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(r.lastInsertRowid);
}

function deleteClient(user, id) {
  const r = db.prepare('DELETE FROM clients WHERE id = ? AND user_id = ?').run(id, user.id);
  if (!r.changes) throw new AppError('Client introuvable.', 404);
}

// ---------- Devis & factures ----------
function hydrateDoc(row) {
  if (!row) return row;
  const client = row.client_id ? db.prepare('SELECT * FROM clients WHERE id = ?').get(row.client_id) : null;
  return { ...row, items: JSON.parse(row.items), client };
}

function listDocuments(user, { type } = {}) {
  requireFeature(user, 'documents');
  const rows = type
    ? db.prepare('SELECT * FROM documents WHERE user_id = ? AND type = ? ORDER BY id DESC').all(user.id, type)
    : db.prepare('SELECT * FROM documents WHERE user_id = ? ORDER BY id DESC').all(user.id);
  return rows.map(hydrateDoc);
}

function getDocument(user, id) {
  requireFeature(user, 'documents');
  const row = db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!row) throw new AppError('Document introuvable.', 404);
  return hydrateDoc(row);
}

function nextNumber(user, type) {
  const prefix = `${type === 'devis' ? 'D' : 'F'}-${new Date().getFullYear()}-`;
  const { n } = db
    .prepare('SELECT COUNT(*) AS n FROM documents WHERE user_id = ? AND type = ? AND number LIKE ?')
    .get(user.id, type, `${prefix}%`);
  return `${prefix}${String(n + 1).padStart(4, '0')}`;
}

function normalizeItems(items, defaultVat) {
  if (!Array.isArray(items) || items.length === 0) throw new AppError('Ajoutez au moins une ligne.');
  return items.slice(0, 100).map((it, i) => {
    const quantity = num(it.quantity, `quantité ligne ${i + 1}`) ?? 1;
    const unitPrice = num(it.unit_price, `prix ligne ${i + 1}`, { required: true });
    const vatRate = num(it.vat_rate, `TVA ligne ${i + 1}`) ?? defaultVat;
    return {
      description: str(it.description, `description ligne ${i + 1}`, { required: true, max: 500 }),
      quantity,
      unit: str(it.unit, 'unité', { max: 20 }) || 'u',
      unit_price: unitPrice,
      vat_rate: vatRate,
      total_ht: round2(quantity * unitPrice),
    };
  });
}

function totals(items) {
  const ht = round2(items.reduce((s, it) => s + it.total_ht, 0));
  const tva = round2(items.reduce((s, it) => s + (it.total_ht * it.vat_rate) / 100, 0));
  return { total_ht: ht, total_tva: tva, total_ttc: round2(ht + tva) };
}

function resolveClientId(user, input) {
  if (input.client_id) {
    const c = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(Number(input.client_id), user.id);
    if (!c) throw new AppError('Client introuvable.', 404);
    return c.id;
  }
  if (input.client_name) {
    const existing = db
      .prepare('SELECT id FROM clients WHERE user_id = ? AND lower(name) = lower(?)')
      .get(user.id, String(input.client_name).trim());
    if (existing) return existing.id;
    return createClient(user, { name: input.client_name }).id;
  }
  return null;
}

function createDocument(user, input) {
  requireFeature(user, 'documents');
  const type = input.type === 'facture' ? 'facture' : 'devis';
  const items = normalizeItems(input.items, user.vat_rate);
  const issueDate = date(input.issue_date, "date d'émission") || today();
  const dueDate =
    date(input.due_date, "date d'échéance") ||
    new Date(Date.parse(`${issueDate}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
  const r = db
    .prepare(
      `INSERT INTO documents (user_id, type, number, client_id, issue_date, due_date, items, notes, total_ht, total_tva, total_ttc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.id,
      type,
      nextNumber(user, type),
      resolveClientId(user, input),
      issueDate,
      dueDate,
      JSON.stringify(items),
      str(input.notes, 'notes', { max: 2000 }),
      ...Object.values(totals(items)),
    );
  return getDocument(user, r.lastInsertRowid);
}

function updateDocumentStatus(user, id, status) {
  const doc = getDocument(user, id);
  if (!DOC_STATUSES[doc.type].includes(status)) {
    throw new AppError(`Statut invalide. Valeurs possibles : ${DOC_STATUSES[doc.type].join(', ')}.`);
  }
  db.prepare('UPDATE documents SET status = ? WHERE id = ?').run(status, id);
  return getDocument(user, id);
}

// Transforme un devis en facture (nouvelle numérotation, mêmes lignes).
function convertQuoteToInvoice(user, id) {
  const quote = getDocument(user, id);
  if (quote.type !== 'devis') throw new AppError("Seul un devis peut être transformé en facture.");
  const invoice = createDocument(user, {
    type: 'facture',
    client_id: quote.client_id,
    items: quote.items,
    notes: `Facture établie d'après le devis ${quote.number}.${quote.notes ? `\n${quote.notes}` : ''}`,
  });
  db.prepare("UPDATE documents SET status = 'accepte' WHERE id = ?").run(quote.id);
  return invoice;
}

function deleteDocument(user, id) {
  requireFeature(user, 'documents');
  const r = db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(id, user.id);
  if (!r.changes) throw new AppError('Document introuvable.', 404);
}

// ---------- Tableau de bord ----------
function dashboard(user) {
  const t = today();
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const echeances = db
    .prepare(
      "SELECT * FROM echeances WHERE user_id = ? AND status = 'a_faire' AND due_date <= ? ORDER BY due_date LIMIT 8",
    )
    .all(user.id, in30);
  const result = {
    usage: getUsage(user),
    echeancesAVenir: echeances,
    echeancesEnRetard: echeances.filter((e) => e.due_date < t).length,
  };
  if (hasFeature(user, 'budget')) result.budget = budgetSummary(user);
  if (hasFeature(user, 'documents')) {
    const unpaid = db
      .prepare(
        "SELECT COUNT(*) AS n, COALESCE(SUM(total_ttc), 0) AS total FROM documents WHERE user_id = ? AND type = 'facture' AND status IN ('envoyee', 'en_retard')",
      )
      .get(user.id);
    const pendingQuotes = db
      .prepare("SELECT COUNT(*) AS n FROM documents WHERE user_id = ? AND type = 'devis' AND status = 'envoye'")
      .get(user.id);
    const ca = db
      .prepare(
        "SELECT COALESCE(SUM(total_ht), 0) AS total FROM documents WHERE user_id = ? AND type = 'facture' AND status = 'payee' AND substr(issue_date, 1, 4) = ?",
      )
      .get(user.id, t.slice(0, 4));
    result.facturation = {
      impayees: unpaid.n,
      montantImpaye: round2(unpaid.total),
      devisEnAttente: pendingQuotes.n,
      chiffreAffairesAnnuel: round2(ca.total),
    };
  }
  return result;
}

module.exports = {
  AppError,
  ECHEANCE_CATEGORIES,
  RECURRENCES,
  DOC_STATUSES,
  today,
  getUsage,
  consumeAiMessage,
  listEcheances,
  createEcheance,
  completeEcheance,
  deleteEcheance,
  listTransactions,
  createTransaction,
  deleteTransaction,
  budgetSummary,
  listClients,
  createClient,
  deleteClient,
  listDocuments,
  getDocument,
  createDocument,
  updateDocumentStatus,
  convertQuoteToInvoice,
  deleteDocument,
  dashboard,
};
