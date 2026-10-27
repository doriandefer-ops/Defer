// Abonnements : Stripe Checkout si configuré, sinon mode démo (changement immédiat).
const db = require('./db');
const { PLANS } = require('./plans');
const { AppError } = require('./services');

const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const PRICE_IDS = { foyer: process.env.STRIPE_PRICE_FOYER, artisan: process.env.STRIPE_PRICE_ARTISAN };
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
const WEBHOOK_URL = `${PUBLIC_URL}/api/billing/webhook`;
const WEBHOOK_EVENTS = ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted'];
const STRIPE_OFFERS = {
  foyer: { lookupKey: 'STRIPE_PRICE_FOYER', name: 'MDIA — Foyer', amount: 499 },
  artisan: { lookupKey: 'STRIPE_PRICE_ARTISAN', name: 'MDIA — Artisan', amount: 2999 },
};

const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

// Configuration automatique de Stripe au démarrage : prix mensuels, webhook et portail client sont
// créés s'ils n'existent pas, pour qu'il suffise de renseigner STRIPE_SECRET_KEY sur l'hébergeur.
async function findOrCreatePrice({ lookupKey, name, amount }) {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (existing.data[0]) return existing.data[0].id;
  const price = await stripe.prices.create({
    currency: 'eur',
    unit_amount: amount,
    recurring: { interval: 'month' },
    tax_behavior: 'inclusive',
    lookup_key: lookupKey,
    product_data: { name },
  });
  console.log(`Stripe : abonnement « ${name} » créé.`);
  return price.id;
}

async function ensureWebhook() {
  if (process.env.STRIPE_WEBHOOK_SECRET) return;
  if (!PUBLIC_URL.startsWith('https://')) return; // Stripe n'accepte que des adresses publiques en https
  if (getSetting('stripe_webhook_url') === WEBHOOK_URL && getSetting('stripe_webhook_secret')) return;
  // Le secret d'un webhook n'est lisible qu'à sa création : on remplace celui qui pointerait déjà ici.
  // Après un changement d'adresse, l'ancien webhook (enregistré dans la base) est supprimé aussi.
  const previous = getSetting('stripe_webhook_url');
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  for (const ep of endpoints.data.filter((e) => e.url === WEBHOOK_URL || e.url === previous)) {
    await stripe.webhookEndpoints.del(ep.id);
  }
  const endpoint = await stripe.webhookEndpoints.create({ url: WEBHOOK_URL, enabled_events: WEBHOOK_EVENTS });
  setSetting('stripe_webhook_url', WEBHOOK_URL);
  setSetting('stripe_webhook_secret', endpoint.secret);
  console.log(`Stripe : webhook créé vers ${WEBHOOK_URL}.`);
}

async function ensurePortalConfiguration() {
  if (getSetting('stripe_portal_configuration')) return;
  const config = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'MDIA — gérer mon abonnement' },
    features: {
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
    },
  });
  setSetting('stripe_portal_configuration', config.id);
}

// Code promo de lancement : 2 mois offerts, réservé aux 20 premiers clients.
const LAUNCH_PROMO = { code: 'LANCEMENT', months: 2, maxRedemptions: 20 };
async function ensureLaunchPromo() {
  if (getSetting('stripe_launch_promo')) return;
  const existing = await stripe.promotionCodes.list({ code: LAUNCH_PROMO.code, limit: 1 });
  if (!existing.data[0]) {
    const coupon = await stripe.coupons.create({
      name: `Lancement — ${LAUNCH_PROMO.months} mois offerts`,
      percent_off: 100,
      duration: 'repeating',
      duration_in_months: LAUNCH_PROMO.months,
      max_redemptions: LAUNCH_PROMO.maxRedemptions,
    });
    await stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: coupon.id },
      code: LAUNCH_PROMO.code,
      max_redemptions: LAUNCH_PROMO.maxRedemptions,
    });
    console.log(`Stripe : code promo ${LAUNCH_PROMO.code} créé.`);
  }
  setSetting('stripe_launch_promo', LAUNCH_PROMO.code);
}

let setupPromise = null;
function ensureStripeSetup() {
  if (!stripe) return Promise.resolve();
  if (!setupPromise) {
    setupPromise = (async () => {
      for (const [plan, offer] of Object.entries(STRIPE_OFFERS)) {
        if (!PRICE_IDS[plan]) PRICE_IDS[plan] = await findOrCreatePrice(offer);
      }
      await ensureWebhook();
      await ensurePortalConfiguration();
      // Le code promo est un bonus : son échec ne doit pas bloquer les paiements.
      await ensureLaunchPromo().catch((err) => console.error('Stripe : code promo non créé :', err.message));
      console.log('Paiements : Stripe configuré.');
    })().catch((err) => {
      setupPromise = null; // nouvel essai à la prochaine demande
      console.error('Stripe : configuration impossible :', err.message);
      throw err;
    });
  }
  return setupPromise;
}

const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET || getSetting('stripe_webhook_secret');

const isDemo = () => !stripe;
// En production, le mode démo est bloqué (sinon n'importe qui obtiendrait une offre payante gratuitement),
// sauf si ALLOW_DEMO_BILLING=true est défini explicitement.
const demoAllowed = () => process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEMO_BILLING === 'true';

function setPlan(userId, plan, extra = {}) {
  const accountType = plan === 'artisan' ? 'artisan' : null;
  db.prepare(
    `UPDATE users SET plan = ?,
       account_type = COALESCE(?, account_type),
       stripe_customer_id = COALESCE(?, stripe_customer_id),
       stripe_subscription_id = ?
     WHERE id = ?`,
  ).run(plan, accountType, extra.customerId ?? null, extra.subscriptionId ?? null, userId);
}

// Codes « Artisan gratuit à vie » : définis dans la variable LIFETIME_CODES (séparés par des virgules),
// jamais dans le code source. Chaque code ne peut être utilisé qu'une seule fois.
const lifetimeCodes = () =>
  (process.env.LIFETIME_CODES || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);

async function redeemLifetimeCode(user, raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!code || !lifetimeCodes().includes(code)) throw new AppError('Ce code n’est pas valable.');
  const used = db.prepare('SELECT user_id FROM lifetime_redemptions WHERE code = ?').get(code);
  if (used && used.user_id !== user.id) throw new AppError('Ce code a déjà été utilisé.');
  db.prepare('INSERT OR IGNORE INTO lifetime_redemptions (code, user_id) VALUES (?, ?)').run(code, user.id);
  await cancelSubscription(user); // plus rien à payer : on arrête un éventuel abonnement en cours
  db.prepare("UPDATE users SET plan = 'artisan', account_type = 'artisan', lifetime_plan = 1, stripe_subscription_id = NULL WHERE id = ?").run(user.id);
  return { plan: 'artisan', lifetime: true };
}

async function startCheckout(user, plan) {
  if (!PLANS[plan] || plan === 'gratuit') throw new AppError('Offre inconnue.');
  if (user.lifetime_plan) throw new AppError('Vous avez déjà l’offre Artisan à vie : rien à payer.');
  if (isDemo()) {
    if (!demoAllowed()) throw new AppError('Le paiement en ligne n’est pas encore disponible. Réessayez bientôt.', 503);
    setPlan(user.id, plan);
    return { demo: true };
  }
  try {
    await ensureStripeSetup();
  } catch {
    throw new AppError('Le paiement en ligne est momentanément indisponible. Réessayez dans un instant.', 503);
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
    customer: user.stripe_customer_id || undefined,
    customer_email: user.stripe_customer_id ? undefined : user.email,
    client_reference_id: String(user.id),
    metadata: { plan, userId: String(user.id) },
    subscription_data: { metadata: { plan, userId: String(user.id) } },
    locale: 'fr',
    allow_promotion_codes: true,
    success_url: `${PUBLIC_URL}/app.html#abonnement?paiement=ok`,
    cancel_url: `${PUBLIC_URL}/app.html#abonnement`,
  });
  return { url: session.url };
}

async function openPortal(user) {
  if (user.lifetime_plan) throw new AppError('Votre offre Artisan est gratuite à vie : aucun abonnement à gérer.');
  if (isDemo()) {
    setPlan(user.id, 'gratuit');
    return { demo: true };
  }
  if (!user.stripe_customer_id) throw new AppError('Aucun abonnement payant actif.');
  await ensureStripeSetup().catch(() => {});
  const portal = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    configuration: getSetting('stripe_portal_configuration'),
    return_url: `${PUBLIC_URL}/app.html#abonnement`,
  });
  return { url: portal.url };
}

// Résilie l'abonnement Stripe en cours (utilisé à la suppression du compte).
async function cancelSubscription(user) {
  if (!stripe || !user.stripe_subscription_id) return;
  try {
    await stripe.subscriptions.cancel(user.stripe_subscription_id);
  } catch (err) {
    if (err.code !== 'resource_missing') throw err;
  }
}

// Webhook Stripe : le corps doit être brut (express.raw) pour vérifier la signature.
function handleWebhook(req, res) {
  if (!stripe) return res.status(404).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret());
  } catch (err) {
    return res.status(400).send(`Signature invalide : ${err.message}`);
  }
  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = Number(obj.client_reference_id || obj.metadata?.userId);
      const plan = obj.metadata?.plan;
      if (userId && PLANS[plan]) setPlan(userId, plan, { customerId: obj.customer, subscriptionId: obj.subscription });
      break;
    }
    case 'customer.subscription.updated': {
      const user = db.prepare('SELECT id, lifetime_plan FROM users WHERE stripe_customer_id = ?').get(obj.customer);
      const priceId = obj.items?.data?.[0]?.price?.id;
      const plan = Object.keys(PRICE_IDS).find((p) => PRICE_IDS[p] === priceId);
      if (user && plan && ['active', 'trialing'].includes(obj.status) && !user.lifetime_plan) {
        setPlan(user.id, plan, { subscriptionId: obj.id });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const user = db.prepare('SELECT id, lifetime_plan FROM users WHERE stripe_customer_id = ?').get(obj.customer);
      if (user && !user.lifetime_plan) setPlan(user.id, 'gratuit');
      break;
    }
    default:
      break;
  }
  res.json({ received: true });
}

module.exports = { redeemLifetimeCode, isDemo, demoAllowed, ensureStripeSetup, startCheckout, openPortal, cancelSubscription, handleWebhook };
