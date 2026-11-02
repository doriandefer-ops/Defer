// Sauvegarde de la base dans un stockage externe compatible S3 (Backblaze B2, Cloudflare R2…).
// Indispensable sur un hébergement sans disque (offre gratuite de Render) : le disque local
// repart à vide à chaque redémarrage, la base est donc récupérée au démarrage puis sauvegardée
// quelques secondes après chaque modification, et une dernière fois à l'arrêt.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KEY = 'mdia/defer.db';
const dailyKey = (day) => `mdia/journalier/${day}.db`;

function config() {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION } = process.env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return { endpoint: S3_ENDPOINT, bucket: S3_BUCKET, region: S3_REGION || 'auto', keyId: S3_ACCESS_KEY_ID, secret: S3_SECRET_ACCESS_KEY };
}

const enabled = () => Boolean(config());

let client = null;
function s3() {
  if (!client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    const c = config();
    client = new S3Client({
      endpoint: c.endpoint,
      region: c.region,
      forcePathStyle: true,
      credentials: { accessKeyId: c.keyId, secretAccessKey: c.secret },
      // B2 et R2 ne gèrent pas toutes les sommes de contrôle ajoutées par défaut par le SDK
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return client;
}

// Récupère la dernière sauvegarde. Renvoie false s'il n'y en a pas encore (premier démarrage).
async function restore(dest) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  let res;
  try {
    res = await s3().send(new GetObjectCommand({ Bucket: config().bucket, Key: KEY }));
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
  const data = Buffer.from(await res.Body.transformToByteArray());
  if (data.subarray(0, 16).toString() !== 'SQLite format 3\0') throw new Error('Sauvegarde : fichier distant invalide.');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (const f of [dest, `${dest}-wal`, `${dest}-shm`]) fs.rmSync(f, { force: true });
  fs.writeFileSync(dest, data);
  return data.length;
}

async function put(key, body) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await s3().send(new PutObjectCommand({ Bucket: config().bucket, Key: key, Body: body, ContentType: 'application/vnd.sqlite3' }));
}

// Sauvegarde en continu de la base ouverte par le site.
function startBackups(db, { intervalMs = 10000 } = {}) {
  let saved = -1; // nombre de modifications au moment de la dernière sauvegarde
  let lastDaily = null;
  let running = null;

  const backup = async () => {
    const changes = db.prepare('SELECT total_changes() AS n').get().n;
    if (changes === saved) return;
    const tmp = path.join(os.tmpdir(), `mdia-sauvegarde-${process.pid}.db`);
    fs.rmSync(tmp, { force: true });
    db.exec(`VACUUM INTO '${tmp}'`); // copie cohérente, sans arrêter le site
    try {
      const data = fs.readFileSync(tmp);
      await put(KEY, data);
      const day = new Date().toISOString().slice(0, 10);
      if (day !== lastDaily) {
        await put(dailyKey(day), data); // une copie par jour, pour revenir en arrière en cas de problème
        lastDaily = day;
      }
      saved = changes;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  };
  const run = () => {
    if (!running) {
      running = backup()
        .catch((err) => console.error('Sauvegarde impossible :', err.message))
        .finally(() => (running = null));
    }
    return running;
  };

  const timer = setInterval(run, intervalMs);
  timer.unref();
  run();

  // Render envoie SIGTERM avant d'arrêter le site (mise en veille, mise à jour) : dernière sauvegarde.
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await running;
    await run();
    console.log(`Sauvegarde finale faite (${signal}).`);
    process.exit(0);
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
  return { run, stop };
}

module.exports = { enabled, restore, startBackups, KEY };
