// Envoi d'emails transactionnels via l'API Brevo (https://www.brevo.com, offre gratuite : 300 emails/jour).
// Configuration : BREVO_API_KEY et MAIL_FROM (adresse d'expéditeur validée dans Brevo).
const API_URL = process.env.MAIL_API_URL || 'https://api.brevo.com/v3/smtp/email';

const isConfigured = () => Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM);

async function sendEmail({ to, toName, subject, html, text, fromName, replyTo }) {
  if (!isConfigured()) throw new Error("L'envoi d'emails n'est pas configuré.");
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM, name: fromName || 'MDIA' },
      to: [{ email: to, ...(toName ? { name: toName } : {}) }],
      ...(replyTo ? { replyTo: { email: replyTo, ...(fromName ? { name: fromName } : {}) } } : {}),
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Envoi refusé par Brevo (${res.status}) ${body.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

module.exports = { isConfigured, sendEmail };
