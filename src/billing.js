// Abonnements : Stripe Checkout si configuré, sinon mode démo (changement immédiat).
const db = require('./db');
const { PLANS } = require('./plans');
const { AppError } = require('./services');

const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const PRICE_IDS = { foyer: process.env.STRIPE_PRICE_FOYER, artisan: process.env.STRIPE_PRICE_ARTISAN };
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3000';

const isDemo = () => !stripe;

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

async function startCheckout(user, plan) {
  if (!PLANS[plan] || plan === 'gratuit') throw new AppError('Offre inconnue.');
  if (isDemo()) {
    setPlan(user.id, plan);
    return { demo: true };
  }
  if (!PRICE_IDS[plan]) throw new AppError(`Prix Stripe non configuré pour l'offre ${plan}.`, 500);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
    customer: user.stripe_customer_id || undefined,
    customer_email: user.stripe_customer_id ? undefined : user.email,
    client_reference_id: String(user.id),
    metadata: { plan, userId: String(user.id) },
    subscription_data: { metadata: { plan, userId: String(user.id) } },
    locale: 'fr',
    success_url: `${PUBLIC_URL}/app.html#abonnement?paiement=ok`,
    cancel_url: `${PUBLIC_URL}/app.html#abonnement`,
  });
  return { url: session.url };
}

async function openPortal(user) {
  if (isDemo()) {
    setPlan(user.id, 'gratuit');
    return { demo: true };
  }
  if (!user.stripe_customer_id) throw new AppError('Aucun abonnement payant actif.');
  const portal = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${PUBLIC_URL}/app.html#abonnement`,
  });
  return { url: portal.url };
}

// Webhook Stripe : le corps doit être brut (express.raw) pour vérifier la signature.
function handleWebhook(req, res) {
  if (!stripe) return res.status(404).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
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
      const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(obj.customer);
      const priceId = obj.items?.data?.[0]?.price?.id;
      const plan = Object.keys(PRICE_IDS).find((p) => PRICE_IDS[p] === priceId);
      if (user && plan && ['active', 'trialing'].includes(obj.status)) {
        setPlan(user.id, plan, { subscriptionId: obj.id });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(obj.customer);
      if (user) setPlan(user.id, 'gratuit');
      break;
    }
    default:
      break;
  }
  res.json({ received: true });
}

module.exports = { isDemo, startCheckout, openPortal, handleWebhook };
