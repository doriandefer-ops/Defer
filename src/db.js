const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'defer.db');
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'foyer',
  plan TEXT NOT NULL DEFAULT 'gratuit',
  company_name TEXT,
  siret TEXT,
  address TEXT,
  phone TEXT,
  vat_rate REAL NOT NULL DEFAULT 20,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  ai_messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

CREATE TABLE IF NOT EXISTS echeances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'autre',
  amount REAL,
  due_date TEXT NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'aucune',
  status TEXT NOT NULL DEFAULT 'a_faire',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'autre',
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  number TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'brouillon',
  issue_date TEXT NOT NULL,
  due_date TEXT,
  items TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  total_ht REAL NOT NULL DEFAULT 0,
  total_tva REAL NOT NULL DEFAULT 0,
  total_ttc REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_echeances_user ON echeances(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, type);
CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id, id);
`);

// Migrations légères (colonnes ajoutées après la création de la table)
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns.includes('show_branding')) {
  db.exec('ALTER TABLE users ADD COLUMN show_branding INTEGER NOT NULL DEFAULT 1');
}
// Message d'envoi retenu par l'artisan (« ne plus me demander »), par type de document : {"devis":1,"facture":0}
if (!userColumns.includes('share_prefs')) {
  db.exec("ALTER TABLE users ADD COLUMN share_prefs TEXT NOT NULL DEFAULT '{}'");
}
// Offre obtenue à vie grâce à un code promo (jamais repassée en gratuit par Stripe)
if (!userColumns.includes('lifetime_plan')) {
  db.exec('ALTER TABLE users ADD COLUMN lifetime_plan INTEGER NOT NULL DEFAULT 0');
}
// Codes « à vie » déjà utilisés (chaque code ne sert qu'une fois). Les codes eux-mêmes sont dans LIFETIME_CODES.
db.exec(`CREATE TABLE IF NOT EXISTS lifetime_redemptions (
  code TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  redeemed_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// Devis & factures : acceptation en ligne, acomptes, encaissement (livre des recettes)
const docColumns = db.prepare('PRAGMA table_info(documents)').all().map((c) => c.name);
for (const [col, def] of [
  ['share_token', 'TEXT'], // lien public du devis (acceptation en ligne)
  ['viewed_at', 'TEXT'],
  ['accepted_at', 'TEXT'],
  ['accepted_name', 'TEXT'],
  ['accepted_ip', 'TEXT'],
  ['refused_at', 'TEXT'],
  ['refusal_reason', 'TEXT'],
  ['kind', "TEXT NOT NULL DEFAULT 'standard'"], // standard | acompte
  ['source_id', 'INTEGER'], // devis d'origine (facture d'acompte ou facture finale)
  ['paid_at', 'TEXT'],
  ['payment_method', 'TEXT'],
]) {
  if (!docColumns.includes(col)) db.exec(`ALTER TABLE documents ADD COLUMN ${col} ${def}`);
}
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_token ON documents(share_token);

-- Tarifs habituels de l'artisan, repris par l'assistant dans les devis
CREATE TABLE IF NOT EXISTS catalog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'u',
  unit_price REAL NOT NULL,
  vat_rate REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_catalog_user ON catalog_items(user_id);

-- Abonnements du foyer (box, assurance, salle de sport…)
CREATE TABLE IF NOT EXISTS abonnements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'autre',
  amount REAL,
  frequency TEXT NOT NULL DEFAULT 'mensuelle',
  next_renewal TEXT,
  commitment_end TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_abonnements_user ON abonnements(user_id);
`);
// Périodicité de déclaration URSSAF du micro-entrepreneur
if (!userColumns.includes('urssaf_period')) {
  db.exec("ALTER TABLE users ADD COLUMN urssaf_period TEXT NOT NULL DEFAULT 'trimestrielle'");
}

module.exports = db;
