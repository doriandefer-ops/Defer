// Point d'entrée en production. Avant d'ouvrir la base, récupère si besoin les données
// d'une ancienne installation (changement d'hébergement) : voir MIGRATE_FROM_URL dans le README.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'defer.db');

// La copie n'a lieu que si la base locale est vide : des données existantes ne sont jamais écrasées.
function hasUsers() {
  if (!fs.existsSync(dbPath)) return false;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()
      ? db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0
      : false;
  } finally {
    db.close();
  }
}

async function importFromOldHost() {
  const from = process.env.MIGRATE_FROM_URL;
  const token = process.env.MIGRATION_TOKEN;
  if (!from || !token) return;
  if (hasUsers()) return console.log('Migration : base déjà remplie, rien à importer.');
  const res = await fetch(`${from.replace(/\/$/, '')}/api/migration/export`, { headers: { 'x-migration-token': token } });
  if (!res.ok) throw new Error(`Migration : export refusé (${res.status}).`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.subarray(0, 16).toString() !== 'SQLite format 3\0') throw new Error('Migration : fichier reçu invalide.');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
  fs.writeFileSync(dbPath, data);
  console.log(`Migration : ${Math.round(data.length / 1024)} Ko de données importés depuis ${from}.`);
}

importFromOldHost()
  .catch((err) => {
    console.error(err.message);
    process.exit(1); // mieux vaut un démarrage raté qu'un site qui repart avec une base vide
  })
  .then(() => require('./server').start());
