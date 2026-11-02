// Point d'entrée en production. Avant d'ouvrir la base, récupère si besoin les données :
// 1. depuis la sauvegarde externe (hébergement sans disque) : voir S3_* dans le README ;
// 2. sinon depuis une ancienne installation (changement d'hébergement) : voir MIGRATE_FROM_URL.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const storage = require('./storage');

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

async function restoreFromStorage() {
  if (!storage.enabled() || hasUsers()) return;
  const size = await storage.restore(dbPath);
  console.log(size ? `Sauvegarde : base récupérée (${Math.round(size / 1024)} Ko).` : 'Sauvegarde : aucune sauvegarde pour l’instant.');
}

restoreFromStorage()
  .then(importFromOldHost)
  .then(() => {
    const server = require('./server');
    server.start();
    if (storage.enabled()) storage.startBackups(require('./db'));
    else if (process.env.NODE_ENV === 'production' && !process.env.REDIRECT_TO) {
      console.log('Sauvegarde externe non configurée : sans disque, les données seront perdues au redémarrage.');
    }
  })
  .catch((err) => {
    // Mieux vaut un démarrage raté (Render réessaie) qu'un site qui repart avec une base vide
    // et écraserait la sauvegarde.
    console.error(err.message);
    process.exit(1);
  });
