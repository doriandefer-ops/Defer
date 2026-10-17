// Crée dans Stripe les produits, les prix mensuels et le webhook nécessaires à Defer.
// Usage : STRIPE_SECRET_KEY=sk_... PUBLIC_URL=https://votre-site.fr npm run stripe:setup
const Stripe = require('stripe');

const key = process.env.STRIPE_SECRET_KEY;
const publicUrl = process.env.PUBLIC_URL;
if (!key || !publicUrl || publicUrl.includes('localhost')) {
  console.error('Définissez STRIPE_SECRET_KEY et PUBLIC_URL (adresse publique du site, en https).');
  process.exit(1);
}
const stripe = Stripe(key);

const OFFERS = [
  { env: 'STRIPE_PRICE_FOYER', name: 'Defer — Foyer', amount: 499 },
  { env: 'STRIPE_PRICE_ARTISAN', name: 'Defer — Artisan', amount: 2999 },
];

(async () => {
  const lines = [];
  for (const offer of OFFERS) {
    const existing = await stripe.prices.list({ lookup_keys: [offer.env], limit: 1 });
    let price = existing.data[0];
    if (!price) {
      const product = await stripe.products.create({ name: offer.name });
      price = await stripe.prices.create({
        product: product.id,
        currency: 'eur',
        unit_amount: offer.amount,
        recurring: { interval: 'month' },
        tax_behavior: 'inclusive',
        lookup_key: offer.env,
      });
    }
    lines.push(`${offer.env}=${price.id}`);
  }

  const url = `${publicUrl.replace(/\/$/, '')}/api/billing/webhook`;
  const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
  if (hooks.data.some((h) => h.url === url)) {
    lines.push(`# Webhook déjà existant pour ${url} : reprenez son secret dans le tableau de bord Stripe.`);
  } else {
    const hook = await stripe.webhookEndpoints.create({
      url,
      enabled_events: ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted'],
    });
    lines.push(`STRIPE_WEBHOOK_SECRET=${hook.secret}`);
  }

  console.log('\nAjoutez ces variables à la configuration de votre hébergement :\n');
  console.log(lines.join('\n'));
  console.log('\nPensez aussi à activer le portail client : https://dashboard.stripe.com/settings/billing/portal');
})().catch((err) => {
  console.error('Erreur Stripe :', err.message);
  process.exit(1);
});
