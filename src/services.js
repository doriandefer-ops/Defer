// Opérations métier partagées entre l'API REST et les outils de l'assistant IA.
// Chaque fonction vérifie les droits liés à l'offre de l'utilisateur.
const crypto = require('node:crypto');
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

const PAYMENT_METHODS = ['virement', 'cheque', 'especes', 'carte', 'autre'];
const ABO_FREQUENCIES = ['mensuelle', 'trimestrielle', 'annuelle'];
const ABO_CATEGORIES = ['internet', 'mobile', 'energie', 'assurance', 'banque', 'streaming', 'sport', 'presse', 'logiciel', 'autre'];

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

function createDocument(user, input, { kind = 'standard', sourceId = null } = {}) {
  requireFeature(user, 'documents');
  const type = input.type === 'facture' ? 'facture' : 'devis';
  const items = normalizeItems(input.items, user.vat_rate);
  const issueDate = date(input.issue_date, "date d'émission") || today();
  const dueDate =
    date(input.due_date, "date d'échéance") ||
    new Date(Date.parse(`${issueDate}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
  const r = db
    .prepare(
      `INSERT INTO documents (user_id, type, number, client_id, issue_date, due_date, items, notes, total_ht, total_tva, total_ttc, kind, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      kind,
      sourceId,
    );
  return getDocument(user, r.lastInsertRowid);
}

// Pour une facture payée, la date d'encaissement et le mode de règlement alimentent le livre des recettes.
function updateDocumentStatus(user, id, status, { paid_at: paidAt, payment_method: method } = {}) {
  const doc = getDocument(user, id);
  if (!DOC_STATUSES[doc.type].includes(status)) {
    throw new AppError(`Statut invalide. Valeurs possibles : ${DOC_STATUSES[doc.type].join(', ')}.`);
  }
  if (doc.type === 'facture' && status === 'payee') {
    const paid = date(paidAt, "date d'encaissement") || doc.paid_at || today();
    if (paid > today()) throw new AppError("La date d'encaissement ne peut pas être dans le futur.");
    db.prepare('UPDATE documents SET status = ?, paid_at = ?, payment_method = ? WHERE id = ?')
      .run(status, paid, oneOf(method, PAYMENT_METHODS, doc.payment_method), id);
  } else if (doc.type === 'facture') {
    db.prepare('UPDATE documents SET status = ?, paid_at = NULL, payment_method = NULL WHERE id = ?').run(status, id);
  } else {
    db.prepare('UPDATE documents SET status = ? WHERE id = ?').run(status, id);
  }
  return getDocument(user, id);
}

// ---------- Acceptation du devis en ligne (lien envoyé au client) ----------
function ensureShareToken(user, id) {
  const doc = getDocument(user, id);
  if (doc.type !== 'devis') throw new AppError('Seul un devis peut être accepté en ligne.');
  if (doc.share_token) return doc.share_token;
  const token = crypto.randomBytes(18).toString('base64url');
  db.prepare('UPDATE documents SET share_token = ? WHERE id = ?').run(token, id);
  return token;
}

function quoteByToken(token) {
  const row = typeof token === 'string' && /^[\w-]{20,40}$/.test(token)
    ? db.prepare("SELECT * FROM documents WHERE share_token = ? AND type = 'devis'").get(token)
    : null;
  if (!row) throw new AppError('Ce lien n’est plus valable. Contactez l’artisan pour recevoir un nouveau devis.', 404);
  return row;
}

function issuerOf(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// Vue du devis pour le client (sans compte) : uniquement ce qui figure sur le devis.
function publicQuote(token) {
  const row = quoteByToken(token);
  if (!row.viewed_at) db.prepare("UPDATE documents SET viewed_at = datetime('now') WHERE id = ?").run(row.id);
  const doc = hydrateDoc(row);
  const u = issuerOf(row.user_id);
  return {
    document: {
      type: doc.type, number: doc.number, status: doc.status, issue_date: doc.issue_date, due_date: doc.due_date,
      items: doc.items, notes: doc.notes, total_ht: doc.total_ht, total_tva: doc.total_tva, total_ttc: doc.total_ttc,
      accepted_at: doc.accepted_at, accepted_name: doc.accepted_name, refused_at: doc.refused_at,
      expired: Boolean(doc.due_date && doc.due_date < today()),
      client: doc.client ? { name: doc.client.name, address: doc.client.address } : null,
    },
    issuer: {
      companyName: u.company_name, name: u.name, address: u.address, phone: u.phone, email: u.email,
      siret: u.siret, showBranding: u.show_branding === 1,
    },
  };
}

function acceptQuote(token, { name, ip }) {
  const row = quoteByToken(token);
  if (row.status === 'accepte') throw new AppError('Ce devis a déjà été accepté.', 409);
  if (row.status === 'refuse') throw new AppError('Ce devis a été refusé. Contactez l’artisan pour en recevoir un nouveau.', 409);
  if (row.due_date && row.due_date < today()) {
    throw new AppError('La date de validité de ce devis est dépassée. Contactez l’artisan pour en recevoir un nouveau.', 409);
  }
  const signer = str(name, 'nom et prénom', { required: true, max: 120 });
  if (signer.length < 3) throw new AppError('Indiquez votre nom et prénom.');
  db.prepare(
    `UPDATE documents SET status = 'accepte', accepted_at = datetime('now'), accepted_name = ?, accepted_ip = ?,
       refused_at = NULL, refusal_reason = NULL WHERE id = ?`,
  ).run(signer, String(ip || '').slice(0, 64), row.id);
  return publicQuote(token);
}

function refuseQuote(token, { reason }) {
  const row = quoteByToken(token);
  if (row.status === 'accepte') throw new AppError('Ce devis a déjà été accepté.', 409);
  db.prepare("UPDATE documents SET status = 'refuse', refused_at = datetime('now'), refusal_reason = ? WHERE id = ?")
    .run(str(reason, 'motif', { max: 1000 }), row.id);
  return publicQuote(token);
}

// ---------- Acomptes ----------
const pctLabel = (p) => `${Number(p.toFixed(2)).toLocaleString('fr-FR')} %`;

function activeDeposits(user, quoteId) {
  return db
    .prepare("SELECT * FROM documents WHERE user_id = ? AND source_id = ? AND kind = 'acompte' AND status != 'annulee' ORDER BY id")
    .all(user.id, quoteId)
    .map(hydrateDoc);
}

// Facture d'acompte : un pourcentage du devis (ou un montant TTC), ventilé par taux de TVA.
function createDeposit(user, quoteId, { percent, amount } = {}) {
  const quote = getDocument(user, quoteId);
  if (quote.type !== 'devis') throw new AppError('Un acompte se demande sur un devis.');
  if (!(quote.total_ttc > 0)) throw new AppError('Ce devis n’a pas de montant.');
  let pct = num(percent, 'pourcentage');
  const ttc = num(amount, 'montant');
  if (pct === null && ttc !== null) pct = (ttc / quote.total_ttc) * 100;
  if (pct === null) throw new AppError('Indiquez un pourcentage ou un montant d’acompte.');
  if (!(pct > 0 && pct <= 100)) throw new AppError('Le pourcentage d’acompte doit être compris entre 0 et 100 %.');
  const already = activeDeposits(user, quote.id).reduce((s, d) => s + d.total_ttc, 0);
  if (already + (quote.total_ttc * pct) / 100 > quote.total_ttc + 0.01) {
    throw new AppError(`Les acomptes dépasseraient le montant du devis (déjà ${already.toLocaleString('fr-FR')} € TTC demandés).`);
  }
  const byRate = {};
  quote.items.forEach((it) => (byRate[it.vat_rate] = (byRate[it.vat_rate] || 0) + it.total_ht));
  const rates = Object.keys(byRate);
  const items = rates.map((rate) => ({
    description: `Acompte de ${pctLabel(pct)} sur le devis ${quote.number}${rates.length > 1 ? ` (travaux à ${rate.replace('.', ',')} % de TVA)` : ''}`,
    quantity: 1,
    unit: 'forfait',
    unit_price: round2((byRate[rate] * pct) / 100),
    vat_rate: Number(rate),
  }));
  const deposit = createDocument(
    user,
    {
      type: 'facture',
      client_id: quote.client_id,
      items,
      notes: `Facture d'acompte de ${pctLabel(pct)} sur le devis ${quote.number} du ${quote.issue_date.split('-').reverse().join('/')}, d'un montant total de ${quote.total_ttc.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € TTC.`,
    },
    { kind: 'acompte', sourceId: quote.id },
  );
  return deposit;
}

// Transforme un devis en facture (nouvelle numérotation, mêmes lignes).
function convertQuoteToInvoice(user, id) {
  const quote = getDocument(user, id);
  if (quote.type !== 'devis') throw new AppError("Seul un devis peut être transformé en facture.");
  // Les acomptes déjà facturés sont déduits, taux de TVA par taux de TVA.
  const deposits = activeDeposits(user, quote.id);
  const deductions = deposits.flatMap((dep) =>
    dep.items.map((it) => ({
      description: `Acompte déjà facturé (facture ${dep.number})`,
      quantity: 1,
      unit: 'forfait',
      unit_price: -it.unit_price,
      vat_rate: it.vat_rate,
    })),
  );
  const invoice = createDocument(
    user,
    {
      type: 'facture',
      client_id: quote.client_id,
      items: [...quote.items, ...deductions],
      notes: `Facture établie d'après le devis ${quote.number}.${deposits.length ? ' Les acomptes déjà facturés sont déduits.' : ''}${quote.notes ? `\n${quote.notes}` : ''}`,
    },
    { sourceId: quote.id },
  );
  db.prepare("UPDATE documents SET status = 'accepte' WHERE id = ?").run(quote.id);
  return invoice;
}

function deleteDocument(user, id) {
  requireFeature(user, 'documents');
  const r = db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(id, user.id);
  if (!r.changes) throw new AppError('Document introuvable.', 404);
}

// ---------- Tarifs habituels (catalogue de l'artisan) ----------
function listCatalog(user) {
  requireFeature(user, 'documents');
  return db.prepare('SELECT * FROM catalog_items WHERE user_id = ? ORDER BY label COLLATE NOCASE').all(user.id);
}

// Ajoute un tarif, ou met à jour celui qui porte déjà ce nom.
function saveCatalogItem(user, input) {
  requireFeature(user, 'documents');
  const label = str(input.label, 'prestation', { required: true, max: 200 });
  const unitPrice = num(input.unit_price, 'prix', { required: true });
  if (unitPrice < 0) throw new AppError('Le prix doit être positif.');
  const vat = num(input.vat_rate, 'TVA');
  if (vat !== null && !(vat >= 0 && vat <= 100)) throw new AppError('Taux de TVA invalide.');
  const unit = str(input.unit, 'unité', { max: 20 }) || 'u';
  const existing = db.prepare('SELECT id FROM catalog_items WHERE user_id = ? AND lower(label) = lower(?)').get(user.id, label);
  if (existing) {
    db.prepare('UPDATE catalog_items SET label = ?, unit = ?, unit_price = ?, vat_rate = ? WHERE id = ?').run(label, unit, unitPrice, vat, existing.id);
    return db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(existing.id);
  }
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM catalog_items WHERE user_id = ?').get(user.id);
  if (n >= 500) throw new AppError('500 tarifs maximum.');
  const r = db
    .prepare('INSERT INTO catalog_items (user_id, label, unit, unit_price, vat_rate) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, label, unit, unitPrice, vat);
  return db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(r.lastInsertRowid);
}

function deleteCatalogItem(user, id) {
  const r = db.prepare('DELETE FROM catalog_items WHERE id = ? AND user_id = ?').run(id, user.id);
  if (!r.changes) throw new AppError('Tarif introuvable.', 404);
}

// ---------- Déclaration URSSAF (micro-entrepreneur : chiffre d'affaires encaissé) ----------
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // m : 1 à 12

function paidInvoices(user, year) {
  return db
    .prepare(
      `SELECT * FROM documents WHERE user_id = ? AND type = 'facture' AND status = 'payee'
       AND substr(COALESCE(paid_at, issue_date), 1, 4) = ? ORDER BY COALESCE(paid_at, issue_date), id`,
    )
    .all(user.id, String(year))
    .map(hydrateDoc)
    .map((d) => ({ ...d, cashed_at: d.paid_at || d.issue_date }));
}

// Périodes de l'année avec le CA encaissé HT et la date limite de déclaration.
function urssafSummary(user, { year, period } = {}) {
  requireFeature(user, 'documents');
  const y = Number(year) || new Date().getFullYear();
  const per = oneOf(period, ['mensuelle', 'trimestrielle'], user.urssaf_period || 'trimestrielle');
  const invoices = paidInvoices(user, y);
  const periods = [];
  if (per === 'mensuelle') {
    for (let m = 1; m <= 12; m++) {
      periods.push({
        label: `${MONTHS[m - 1]} ${y}`,
        start: `${y}-${String(m).padStart(2, '0')}-01`,
        end: lastDayOf(y, m),
        deadline: m === 12 ? lastDayOf(y + 1, 1) : lastDayOf(y, m + 1),
      });
    }
  } else {
    const deadlines = [`${y}-04-30`, `${y}-07-31`, `${y}-10-31`, `${y + 1}-01-31`];
    for (let q = 0; q < 4; q++) {
      periods.push({
        label: `${q + 1}${q === 0 ? 'er' : 'e'} trimestre ${y} (${MONTHS[q * 3]} à ${MONTHS[q * 3 + 2]})`,
        start: `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`,
        end: lastDayOf(y, q * 3 + 3),
        deadline: deadlines[q],
      });
    }
  }
  const t = today();
  for (const p of periods) {
    const inside = invoices.filter((d) => d.cashed_at >= p.start && d.cashed_at <= p.end);
    p.total_ht = round2(inside.reduce((s, d) => s + d.total_ht, 0));
    p.count = inside.length;
    p.status = p.end < t ? (p.deadline < t ? 'passee' : 'a_declarer') : p.start <= t ? 'en_cours' : 'a_venir';
  }
  return { year: y, period: per, periods, total_ht: round2(periods.reduce((s, p) => s + p.total_ht, 0)) };
}

// Livre des recettes (obligatoire pour les micro-entrepreneurs), au format CSV pour Excel.
function livreRecettesCsv(user, year) {
  requireFeature(user, 'documents');
  const y = Number(year) || new Date().getFullYear();
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const money = (n) => n.toFixed(2).replace('.', ',');
  const methods = { virement: 'Virement', cheque: 'Chèque', especes: 'Espèces', carte: 'Carte bancaire', autre: 'Autre' };
  const rows = paidInvoices(user, y).map((d) => [
    d.cashed_at.split('-').reverse().join('/'),
    d.number,
    d.client?.name || '',
    d.items.filter((it) => it.total_ht > 0).map((it) => it.description).join(' ; ').slice(0, 300),
    money(d.total_ht),
    money(d.total_ttc),
    methods[d.payment_method] || '',
  ]);
  const header = ['Date d’encaissement', 'N° de facture', 'Client', 'Nature de la prestation', 'Montant HT (€)', 'Montant TTC (€)', 'Mode de règlement'];
  return `\ufeff${[header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
}

// ---------- Abonnements ----------
function rollRenewal(a) {
  let next = a.next_renewal;
  if (!next) return a;
  const t = today();
  let guard = 0;
  while (next < t && guard++ < 500) next = addPeriod(next, a.frequency);
  if (next !== a.next_renewal) db.prepare('UPDATE abonnements SET next_renewal = ? WHERE id = ?').run(next, a.id);
  return { ...a, next_renewal: next };
}

const MONTHS_PER = { mensuelle: 1, trimestrielle: 3, annuelle: 12 };

function listAbonnements(user) {
  requireFeature(user, 'abonnements');
  const rows = db
    .prepare('SELECT * FROM abonnements WHERE user_id = ? ORDER BY next_renewal IS NULL, next_renewal, name')
    .all(user.id)
    .map(rollRenewal)
    .sort((a, b) => (a.next_renewal || '9999').localeCompare(b.next_renewal || '9999'));
  const monthly = round2(rows.reduce((s, a) => s + (a.amount || 0) / MONTHS_PER[a.frequency], 0));
  return { abonnements: rows, totalMensuel: monthly, totalAnnuel: round2(monthly * 12) };
}

function createAbonnement(user, input) {
  requireFeature(user, 'abonnements');
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM abonnements WHERE user_id = ?').get(user.id);
  if (n >= 200) throw new AppError('200 abonnements maximum.');
  const amount = num(input.amount, 'montant');
  if (amount !== null && amount < 0) throw new AppError('Le montant doit être positif.');
  const r = db
    .prepare(
      `INSERT INTO abonnements (user_id, name, category, amount, frequency, next_renewal, commitment_end, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.id,
      str(input.name, 'nom', { required: true, max: 200 }),
      oneOf(input.category, ABO_CATEGORIES, 'autre'),
      amount,
      oneOf(input.frequency, ABO_FREQUENCIES, 'mensuelle'),
      date(input.next_renewal, 'prochain renouvellement'),
      date(input.commitment_end, "fin d'engagement"),
      str(input.notes, 'notes', { max: 1000 }),
    );
  return rollRenewal(db.prepare('SELECT * FROM abonnements WHERE id = ?').get(r.lastInsertRowid));
}

function deleteAbonnement(user, id) {
  const r = db.prepare('DELETE FROM abonnements WHERE id = ? AND user_id = ?').run(id, user.id);
  if (!r.changes) throw new AppError('Abonnement introuvable.', 404);
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
        "SELECT COALESCE(SUM(total_ht), 0) AS total FROM documents WHERE user_id = ? AND type = 'facture' AND status = 'payee' AND substr(COALESCE(paid_at, issue_date), 1, 4) = ?",
      )
      .get(user.id, t.slice(0, 4));
    const answered = db
      .prepare(
        `SELECT id, number, status, accepted_at, accepted_name, refused_at, refusal_reason, total_ttc, client_id FROM documents
         WHERE user_id = ? AND type = 'devis' AND COALESCE(accepted_at, refused_at) >= datetime('now', '-14 days')
         ORDER BY COALESCE(accepted_at, refused_at) DESC LIMIT 5`,
      )
      .all(user.id)
      .map((d) => ({ ...d, client: d.client_id ? db.prepare('SELECT name FROM clients WHERE id = ?').get(d.client_id)?.name : null }));
    const urssaf = urssafSummary(user);
    result.urssaf = urssaf.periods.find((p) => p.status === 'a_declarer') || urssaf.periods.find((p) => p.status === 'en_cours') || null;
    result.reponsesDevis = answered;
    result.facturation = {
      impayees: unpaid.n,
      montantImpaye: round2(unpaid.total),
      devisEnAttente: pendingQuotes.n,
      chiffreAffairesAnnuel: round2(ca.total),
    };
  }
  if (hasFeature(user, 'abonnements')) {
    result.renouvellements = listAbonnements(user).abonnements.filter((a) => a.next_renewal && a.next_renewal <= in30).slice(0, 5);
  }
  return result;
}

module.exports = {
  PAYMENT_METHODS,
  ABO_FREQUENCIES,
  ABO_CATEGORIES,
  ensureShareToken,
  publicQuote,
  acceptQuote,
  refuseQuote,
  issuerOf,
  quoteByToken,
  hydrateDoc,
  createDeposit,
  listCatalog,
  saveCatalogItem,
  deleteCatalogItem,
  urssafSummary,
  livreRecettesCsv,
  listAbonnements,
  createAbonnement,
  deleteAbonnement,
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
