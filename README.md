# Defer — l'IA qui gère l'administratif des artisans et des foyers

Defer est un site web avec un assistant IA (Claude) qui prend en charge la paperasse :
échéances, budget, courriers administratifs, et pour les artisans les clients, devis et factures.
L'utilisateur parle à l'assistant en langage naturel et celui-ci agit directement dans son espace
(création de devis, ajout d'échéances, enregistrement de dépenses…).

## Offres

| Offre | Prix | Contenu |
|---|---|---|
| **Gratuit** | 0 € | Accès très limité : 10 messages IA / mois, 5 échéances |
| **Foyer** | 4,99 € / mois | 300 messages IA / mois, échéances illimitées et récurrentes, budget, courriers |
| **Artisan** | 29,99 € / mois | 2 000 messages IA / mois, devis & factures illimités (PDF), clients, suivi des impayés, budget, courriers |

Les limites sont définies dans `src/plans.js` et appliquées côté serveur (API et outils de l'IA).

## Démarrage

Prérequis : Node.js ≥ 22.13 (la base SQLite intégrée `node:sqlite` est utilisée, aucune dépendance native).

```bash
npm install
cp .env.example .env   # puis renseigner ANTHROPIC_API_KEY
npm start              # http://localhost:3000
npm test               # tests de l'API
```

## Paiements

- **Sans `STRIPE_SECRET_KEY`** : mode démo, le changement d'offre est immédiat et gratuit (pratique pour tester).
  Ne pas mettre en production dans ce mode : n'importe qui pourrait obtenir une offre payante.
- **Avec Stripe** : créer deux prix récurrents mensuels (4,99 € et 29,99 €), renseigner
  `STRIPE_PRICE_FOYER`, `STRIPE_PRICE_ARTISAN`, `STRIPE_WEBHOOK_SECRET` et `PUBLIC_URL`, puis
  déclarer le webhook `POST /api/billing/webhook` (événements `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`).

## Assistant IA

`src/ai.js` utilise le SDK Anthropic avec le modèle `claude-opus-5-5` (modifiable via `CLAUDE_MODEL`).
L'assistant dispose d'outils (ajouter une échéance, créer un devis, enregistrer une dépense…) filtrés
selon l'offre de l'utilisateur. Le repli automatique de modèle en cas de refus (`fallbacks: "default"`)
est activé. Chaque message envoyé compte dans le quota mensuel.

## Structure

```
src/
  server.js    routes Express (API + fichiers statiques)
  plans.js     définition des offres et limites
  services.js  logique métier (échéances, budget, clients, devis/factures)
  ai.js        assistant Claude et ses outils
  billing.js   abonnements Stripe / mode démo
  auth.js      comptes, mots de passe (scrypt), sessions par cookie
  db.js        schéma SQLite
public/
  index.html        page d'accueil et tarifs
  inscription.html, connexion.html
  app.html, app.js  espace client (tableau de bord, assistant, échéances, budget, clients, devis & factures)
  document.html     devis / facture imprimable en PDF
test/api.test.js
```
