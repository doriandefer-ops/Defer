# MDIA — l'IA qui gère l'administratif des artisans et des foyers

MDIA est un site web avec un assistant IA (Claude) qui prend en charge la paperasse :
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

## Mise en ligne (pas à pas)

1. **Clé Anthropic** : créez une clé sur https://console.anthropic.com (rubrique API Keys) et prévoyez du crédit.
2. **Hébergement sur Render** (le plus simple) : sur https://render.com, *New → Blueprint*, choisissez ce dépôt.
   Le fichier `render.yaml` configure tout (Docker, disque persistant pour la base, vérification `/healthz`).
   Renseignez `ANTHROPIC_API_KEY` et `PUBLIC_URL` (l'adresse du site, ex. `https://defer.onrender.com`).
   Tout autre hébergeur acceptant Docker convient (`Dockerfile` fourni) : montez un volume sur `/data`.
3. **Stripe** : créez un compte sur https://stripe.com, récupérez la clé secrète, puis lancez une fois
   `STRIPE_SECRET_KEY=sk_... PUBLIC_URL=https://votre-site npm run stripe:setup`.
   Le script crée les deux abonnements (4,99 € et 29,99 € par mois) et le webhook, et affiche les variables
   `STRIPE_PRICE_FOYER`, `STRIPE_PRICE_ARTISAN` et `STRIPE_WEBHOOK_SECRET` à ajouter sur l'hébergeur.
   Activez aussi le portail client Stripe (le script donne le lien).
4. **Pages légales** : complétez les éléments entre crochets dans `public/mentions-legales.html`,
   `public/cgv.html` et `public/confidentialite.html` (raison sociale, SIRET, hébergeur, médiateur…).
5. **Nom de domaine** (facultatif) : ajoutez-le dans Render puis mettez `PUBLIC_URL` à jour
   (et relancez `npm run stripe:setup` pour le webhook).

## Paiements

- **En local sans `STRIPE_SECRET_KEY`** : mode démo, le changement d'offre est immédiat et gratuit (pratique pour tester).
- **En production (`NODE_ENV=production`) sans Stripe** : les offres payantes sont désactivées, pour que personne
  ne les obtienne gratuitement (`ALLOW_DEMO_BILLING=true` force le mode démo, par exemple pour une préproduction).
- **Avec Stripe** : paiement par Stripe Checkout, gestion de l'abonnement par le portail client Stripe, mise à jour
  de l'offre par webhook (`POST /api/billing/webhook`).

## Données personnelles (RGPD)

Dans *Paramètres*, chaque utilisateur peut télécharger toutes ses données (JSON) et supprimer son compte
(l'abonnement Stripe est alors résilié). L'inscription demande l'acceptation des CGV et de la politique de confidentialité.

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
  mentions-legales.html, cgv.html, confidentialite.html
scripts/stripe-setup.js   création des abonnements et du webhook Stripe
test/api.test.js
Dockerfile, render.yaml, .github/workflows/ci.yml
```
