// Statistiques du site : mesure d'audience anonyme (sans cookie) et tableau de bord administrateur.
//
// Mesure d'audience conforme aux recommandations de la CNIL pour l'exemption de consentement :
// aucune donnée stockée sur l'appareil du visiteur, adresse IP jamais enregistrée (seule une empreinte
// hachée avec un sel qui change chaque jour, donc impossible à relier d'un jour à l'autre), conservation 13 mois.
const crypto = require('node:crypto');
const db = require('./db');
const { PLANS } = require('./plans');

db.exec(`
CREATE TABLE IF NOT EXISTS page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  visitor TEXT NOT NULL,
  referrer TEXT
);
CREATE INDEX IF NOT EXISTS idx_page_views_day ON page_views(day);
`);

const RETENTION_MONTHS = 13;
const BOT_UA = /bot|crawl|spider|slurp|preview|monitor|curl|wget|python|go-http|java\/|headless|lighthouse|render/i;
const PAGE_NAMES = {
  '/': 'Accueil',
  '/inscription': 'Inscription',
  '/connexion': 'Connexion',
  '/cgv': 'CGV',
  '/confidentialite': 'Confidentialité',
  '/mentions-legales': 'Mentions légales',
};
const TRACKED_PATHS = new Map([
  ...Object.keys(PAGE_NAMES).map((p) => [p, p]),
  ['/index.html', '/'],
  ...Object.keys(PAGE_NAMES).filter((p) => p !== '/').map((p) => [`${p}.html`, p]),
]);

const adminEmails = () =>
  (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const isAdmin = (user) => Boolean(user) && adminEmails().includes(user.email.toLowerCase());

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

let salt = { day: null, value: null };
function dailySalt() {
  const day = today();
  if (salt.day !== day) {
    const key = `stats_salt_${day}`;
    let value = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
    if (!value) {
      value = crypto.randomBytes(16).toString('hex');
      db.prepare("DELETE FROM settings WHERE key LIKE 'stats_salt_%'").run();
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
      value = db.prepare('SELECT value FROM settings WHERE key = ?').get(key).value;
    }
    salt = { day, value };
  }
  return salt.value;
}

function referrerHost(req) {
  try {
    const host = new URL(req.get('referer')).hostname.replace(/^www\./, '');
    return host && host !== req.hostname ? host : null;
  } catch {
    return null;
  }
}

// Middleware : enregistre une page vue pour les pages publiques (pas l'espace client, ni les robots, ni l'administrateur).
function trackPageView(req, _res, next) {
  const path = req.method === 'GET' ? TRACKED_PATHS.get(req.path) : null;
  const ua = req.get('user-agent') || '';
  if (path && ua && !BOT_UA.test(ua) && !isAdmin(req.user)) {
    const visitor = crypto.createHash('sha256').update(`${dailySalt()}|${req.ip}|${ua}`).digest('hex').slice(0, 16);
    db.prepare('INSERT INTO page_views (day, path, visitor, referrer) VALUES (?, ?, ?, ?)').run(
      today(),
      path,
      visitor,
      referrerHost(req),
    );
  }
  next();
}

function purgeOldViews() {
  const limit = new Date();
  limit.setMonth(limit.getMonth() - RETENTION_MONTHS);
  db.prepare('DELETE FROM page_views WHERE day < ?').run(limit.toISOString().slice(0, 10));
}

const round2 = (n) => Math.round(n * 100) / 100;

function adminStats() {
  const from30 = daysAgo(29);
  const days = Array.from({ length: 30 }, (_, i) => daysAgo(29 - i));

  const viewsByDay = new Map(
    db
      .prepare(
        'SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM page_views WHERE day >= ? GROUP BY day',
      )
      .all(from30)
      .map((r) => [r.day, r]),
  );
  const signupsByDay = new Map(
    db
      .prepare('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM users WHERE created_at >= ? GROUP BY day')
      .all(from30)
      .map((r) => [r.day, r.n]),
  );
  const daily = days.map((day) => ({
    day,
    visitors: viewsByDay.get(day)?.visitors ?? 0,
    views: viewsByDay.get(day)?.views ?? 0,
    signups: signupsByDay.get(day) ?? 0,
  }));
  const sum = (from, key) => daily.filter((d) => d.day >= from).reduce((s, d) => s + d[key], 0);

  const planCounts = Object.fromEntries(Object.keys(PLANS).map((p) => [p, 0]));
  for (const r of db.prepare('SELECT plan, COUNT(*) AS n FROM users GROUP BY plan').all()) planCounts[r.plan] = r.n;
  const typeCounts = { foyer: 0, artisan: 0 };
  for (const r of db.prepare('SELECT account_type, COUNT(*) AS n FROM users GROUP BY account_type').all()) {
    typeCounts[r.account_type] = r.n;
  }
  const totalUsers = Object.values(planCounts).reduce((a, b) => a + b, 0);
  const mrr = round2(planCounts.foyer * PLANS.foyer.price + planCounts.artisan * PLANS.artisan.price);

  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  const month = today().slice(0, 7);
  const visitors30 = sum(from30, 'visitors');
  const signups30 = sum(from30, 'signups');

  return {
    generatedAt: new Date().toISOString(),
    visits: {
      today: sum(today(), 'visitors'),
      last7: sum(daysAgo(6), 'visitors'),
      last30: visitors30,
      views30: sum(from30, 'views'),
      topPages: db
        .prepare(
          'SELECT path, COUNT(*) AS views FROM page_views WHERE day >= ? GROUP BY path ORDER BY views DESC LIMIT 10',
        )
        .all(from30)
        .map((r) => ({ page: PAGE_NAMES[r.path] || r.path, views: r.views })),
      topReferrers: db
        .prepare(
          `SELECT referrer, COUNT(DISTINCT day || visitor) AS visitors FROM page_views
           WHERE day >= ? AND referrer IS NOT NULL GROUP BY referrer ORDER BY visitors DESC LIMIT 10`,
        )
        .all(from30),
    },
    users: {
      total: totalUsers,
      last30: signups30,
      byPlan: planCounts,
      byType: typeCounts,
      conversion: visitors30 ? round2((signups30 / visitors30) * 100) : null,
      recent: db
        .prepare(
          'SELECT name, email, account_type AS accountType, plan, created_at AS createdAt FROM users ORDER BY id DESC LIMIT 20',
        )
        .all(),
    },
    revenue: { mrr, payingUsers: planCounts.foyer + planCounts.artisan },
    usage: {
      aiMessagesThisMonth: count('SELECT COALESCE(SUM(ai_messages), 0) AS n FROM usage WHERE month = ?', month),
      aiActiveUsersThisMonth: count('SELECT COUNT(*) AS n FROM usage WHERE month = ? AND ai_messages > 0', month),
      quotes: count("SELECT COUNT(*) AS n FROM documents WHERE type = 'devis'"),
      invoices: count("SELECT COUNT(*) AS n FROM documents WHERE type = 'facture'"),
      echeances: count('SELECT COUNT(*) AS n FROM echeances'),
      transactions: count('SELECT COUNT(*) AS n FROM transactions'),
    },
    daily,
  };
}

module.exports = { isAdmin, trackPageView, purgeOldViews, adminStats };
