const crypto = require('node:crypto');
const db = require('./db');
const { isAdmin } = require('./stats');

const SESSION_COOKIE = 'defer_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    Date.now() + SESSION_TTL_MS,
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  req.user = null;
  if (token) {
    const row = db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ?`,
      )
      .get(token, Date.now());
    if (row) req.user = row;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Vous devez être connecté.' });
  next();
}

// Petit limiteur en mémoire pour freiner les attaques par force brute sur la connexion.
const attempts = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    if (process.env.RATE_LIMIT_DISABLED === 'true') return next();
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = attempts.get(key) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) Object.assign(entry, { count: 0, reset: now + windowMs });
    entry.count += 1;
    attempts.set(key, entry);
    if (entry.count > max) {
      return res.status(429).json({ error: 'Trop de tentatives, réessayez dans quelques minutes.' });
    }
    next();
  };
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    accountType: u.account_type,
    plan: u.plan,
    companyName: u.company_name,
    siret: u.siret,
    address: u.address,
    phone: u.phone,
    vatRate: u.vat_rate,
    showBranding: u.show_branding !== 0,
    autoReminders: u.auto_reminders === 1,
    isAdmin: isAdmin(u),
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  loadUser,
  requireAuth,
  rateLimit,
  publicUser,
};
