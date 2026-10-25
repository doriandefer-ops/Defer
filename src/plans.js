// Définition des offres. Toute la logique de limitation passe par ce fichier.
const PLANS = {
  gratuit: {
    id: 'gratuit',
    name: 'Gratuit',
    price: 0,
    priceLabel: '0 €',
    tagline: 'Pour découvrir, accès très limité',
    limits: {
      aiMessagesPerMonth: 10,
      echeances: 5,
      transactions: 20,
      clients: 0,
      documents: 0,
    },
    features: ['assistant', 'echeances'],
  },
  foyer: {
    id: 'foyer',
    name: 'Foyer',
    price: 4.99,
    priceLabel: '4,99 € / mois',
    tagline: "Toute l'administration de la maison",
    limits: {
      aiMessagesPerMonth: 300,
      echeances: Infinity,
      transactions: Infinity,
      clients: 0,
      documents: 0,
    },
    features: ['assistant', 'echeances', 'budget', 'courriers', 'abonnements'],
  },
  artisan: {
    id: 'artisan',
    name: 'Artisan',
    price: 29.99,
    priceLabel: '29,99 € / mois',
    tagline: 'Devis, factures, clients et déclarations',
    limits: {
      aiMessagesPerMonth: 2000,
      echeances: Infinity,
      transactions: Infinity,
      clients: Infinity,
      documents: Infinity,
    },
    features: ['assistant', 'echeances', 'budget', 'courriers', 'abonnements', 'clients', 'documents'],
  },
};

function getPlan(id) {
  return PLANS[id] || PLANS.gratuit;
}

function hasFeature(user, feature) {
  return getPlan(user.plan).features.includes(feature);
}

// Version sérialisable (Infinity n'existe pas en JSON)
function publicPlans() {
  return Object.values(PLANS).map((p) => ({
    ...p,
    limits: Object.fromEntries(
      Object.entries(p.limits).map(([k, v]) => [k, Number.isFinite(v) ? v : null]),
    ),
  }));
}

module.exports = { PLANS, getPlan, hasFeature, publicPlans };
