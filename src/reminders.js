// Relances automatiques par email des factures impayées.
// Calendrier : 1re relance 3 jours après l'échéance, 2e à 10 jours, 3e à 20 jours (au moins 5 jours entre deux).
const crypto = require('node:crypto');
const db = require('./db');
const mailer = require('./mailer');
const { hasFeature } = require('./plans');
const { AppError, getDocument } = require('./services');

const SCHEDULE = [3, 10, 20];
const MIN_DAYS_BETWEEN = 5;
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const eur = (n) => Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const frDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Lien public (non devinable) vers la facture, pour que le client puisse la consulter et l'imprimer.
function publicToken(docId) {
  const row = db.prepare('SELECT public_token FROM documents WHERE id = ?').get(docId);
  if (row?.public_token) return row.public_token;
  const token = crypto.randomBytes(18).toString('base64url');
  db.prepare('UPDATE documents SET public_token = ? WHERE id = ?').run(token, docId);
  return token;
}

function getPublicDocument(token) {
  const row = token && db.prepare("SELECT * FROM documents WHERE public_token = ? AND type = 'facture'").get(String(token));
  if (!row) throw new AppError('Document introuvable.', 404);
  const issuer = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  const client = row.client_id ? db.prepare('SELECT name, address, email FROM clients WHERE id = ?').get(row.client_id) : null;
  return {
    document: { ...row, items: JSON.parse(row.items), client, user_id: undefined, public_token: undefined },
    issuer: {
      name: issuer.name,
      companyName: issuer.company_name,
      email: issuer.email,
      phone: issuer.phone,
      address: issuer.address,
      siret: issuer.siret,
      showBranding: issuer.show_branding !== 0,
    },
  };
}

function remindersFor(docId) {
  return db.prepare('SELECT level, to_email, manual, sent_at FROM invoice_reminders WHERE document_id = ? ORDER BY id').all(docId);
}

function buildEmail(user, doc, client, level) {
  const company = user.company_name || user.name;
  const late = daysBetween(doc.due_date, todayIso());
  const link = `${PUBLIC_URL}/facture/${publicToken(doc.id)}`;
  const intro = [
    `Sauf erreur de notre part, la facture ${doc.number} d'un montant de ${eur(doc.total_ttc)}, arrivée à échéance le ${frDate(doc.due_date)}, n'a pas encore été réglée.`,
    `Nous revenons vers vous au sujet de la facture ${doc.number} d'un montant de ${eur(doc.total_ttc)}, arrivée à échéance le ${frDate(doc.due_date)}, qui reste impayée à ce jour malgré notre précédent rappel.`,
    `Malgré nos précédents rappels, la facture ${doc.number} d'un montant de ${eur(doc.total_ttc)}, arrivée à échéance le ${frDate(doc.due_date)}, reste impayée (${late} jours de retard).`,
  ][level - 1];
  const ask = [
    'Pourriez-vous procéder à son règlement dès que possible ? Si le paiement a été effectué entre-temps, merci de ne pas tenir compte de ce message.',
    'Nous vous remercions de bien vouloir procéder à son règlement sous 8 jours. Si vous rencontrez une difficulté, n\'hésitez pas à nous contacter en répondant à cet email.',
    'Nous vous demandons de régulariser cette situation sous 8 jours. Sans règlement ou nouvelle de votre part, nous serons contraints d\'engager les démarches de recouvrement prévues par la loi.',
  ][level - 1];
  const subject = [
    `Rappel : facture ${doc.number} en attente de règlement`,
    `Relance : facture ${doc.number} impayée`,
    `Dernière relance : facture ${doc.number} impayée`,
  ][level - 1];
  const greeting = client.name ? `Bonjour ${client.name},` : 'Bonjour,';
  const signature = [company, user.phone, user.email].filter(Boolean);
  const text = [greeting, '', intro, '', ask, '', `Consulter la facture : ${link}`, '', 'Cordialement,', ...signature].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d1d1b;max-width:560px">
    <p>${esc(greeting)}</p><p>${esc(intro)}</p><p>${esc(ask)}</p>
    <p><a href="${esc(link)}" style="display:inline-block;background:#2f5d50;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Consulter la facture ${esc(doc.number)}</a></p>
    <p>Cordialement,<br>${signature.map(esc).join('<br>')}</p>
    <p style="font-size:12px;color:#9a998f">Message envoyé pour ${esc(company)} avec MDIA. Répondez directement à cet email pour contacter ${esc(company)}.</p>
  </div>`;
  return { subject, text, html };
}

async function sendReminder(user, doc, level, { manual = false } = {}) {
  const client = doc.client_id ? db.prepare('SELECT * FROM clients WHERE id = ?').get(doc.client_id) : null;
  if (!client?.email) throw new AppError("Ajoutez l'email du client dans la page Clients pour pouvoir le relancer.");
  const { subject, text, html } = buildEmail(user, doc, client, level);
  await mailer.sendEmail({
    to: client.email,
    toName: client.name,
    subject,
    text,
    html,
    fromName: user.company_name || user.name,
    replyTo: user.email,
  });
  db.prepare('INSERT INTO invoice_reminders (document_id, level, to_email, manual) VALUES (?, ?, ?, ?)').run(
    doc.id,
    level,
    client.email,
    manual ? 1 : 0,
  );
  if (doc.status === 'envoyee') db.prepare("UPDATE documents SET status = 'en_retard' WHERE id = ?").run(doc.id);
}

// Relance manuelle depuis la liste des factures
async function remindNow(user, docId) {
  if (!mailer.isConfigured()) throw new AppError("L'envoi d'emails n'est pas encore activé sur MDIA.", 503);
  const doc = getDocument(user, docId);
  if (doc.type !== 'facture' || !['envoyee', 'en_retard'].includes(doc.status)) {
    throw new AppError('Seule une facture envoyée et non payée peut être relancée.');
  }
  const sent = remindersFor(doc.id);
  const last = sent[sent.length - 1];
  if (last && Date.now() - Date.parse(`${last.sent_at.replace(' ', 'T')}Z`) < 24 * 3600 * 1000) {
    throw new AppError('Ce client a déjà été relancé il y a moins de 24 heures.');
  }
  await sendReminder(user, doc, Math.min(sent.length + 1, SCHEDULE.length), { manual: true });
  return { reminders: remindersFor(doc.id) };
}

// Passage automatique : à lancer régulièrement (toutes les heures).
async function runAutomaticReminders() {
  if (!mailer.isConfigured()) return { sent: 0 };
  const today = todayIso();
  // Les factures envoyées dont l'échéance est dépassée passent « en retard », pour tout le monde.
  db.prepare("UPDATE documents SET status = 'en_retard' WHERE type = 'facture' AND status = 'envoyee' AND due_date < ?").run(today);

  const candidates = db
    .prepare(
      `SELECT d.* FROM documents d JOIN users u ON u.id = d.user_id
       WHERE d.type = 'facture' AND d.status = 'en_retard' AND d.due_date IS NOT NULL AND u.auto_reminders = 1`,
    )
    .all();
  let sent = 0;
  for (const doc of candidates) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(doc.user_id);
    if (!hasFeature(user, 'documents')) continue;
    const history = remindersFor(doc.id);
    const level = history.length + 1;
    if (level > SCHEDULE.length) continue;
    if (daysBetween(doc.due_date, today) < SCHEDULE[level - 1]) continue;
    const last = history[history.length - 1];
    if (last && daysBetween(last.sent_at.slice(0, 10), today) < MIN_DAYS_BETWEEN) continue;
    const client = doc.client_id ? db.prepare('SELECT email FROM clients WHERE id = ?').get(doc.client_id) : null;
    if (!client?.email) continue;
    try {
      await sendReminder(user, doc, level);
      sent++;
    } catch (err) {
      console.error(`Relance de la facture ${doc.number} impossible :`, err.message);
    }
  }
  if (sent) console.log(`Relances automatiques : ${sent} email(s) envoyé(s).`);
  return { sent };
}

function startScheduler() {
  const run = () => runAutomaticReminders().catch((err) => console.error('Relances automatiques :', err.message));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}

module.exports = {
  SCHEDULE,
  remindersFor,
  remindNow,
  runAutomaticReminders,
  startScheduler,
  getPublicDocument,
};
