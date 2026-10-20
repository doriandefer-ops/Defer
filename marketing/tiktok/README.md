# Vidéos TikTok / Reels / Shorts — MDIA

Les vidéos sont dans `marketing/tiktok/out/` (MP4 vertical 1080×1920, 30 i/s), avec une image de couverture pour chacune.
Elles n’ont **pas de musique** : ajoutez un **son tendance** directement dans TikTok (bouton « Ajouter un son »), c’est ce qui aide le plus l’algorithme.

## Comment poster pour maximiser les vues

- **1 vidéo par jour**, pas toutes le même jour. Ordre conseillé : 1 → 5 → 2 → 3 → 4.
- **Heures** : 12 h–13 h ou 19 h–21 h (pauses et soirées des artisans).
- **Son** : choisissez un son tendance à volume bas (onglet « Sons » → « Tendances »).
- **Couverture** : sélectionnez l’image de couverture fournie (ou la 1re seconde).
- **Lien** : mettez `mdia.onrender.com/?utm=tiktok` dans la bio (les liens dans les légendes ne sont pas cliquables).
- **Les 30 premières minutes** : répondez à chaque commentaire — l’algorithme pousse les vidéos qui font parler.
- **Commentaire épinglé** : « Lien dans la bio, 2 mois offerts avec le code LANCEMENT 🎁 ».
- Publiez aussi les mêmes vidéos en **Instagram Reels** et **YouTube Shorts** : 3 fois plus de chances.
- Si une vidéo marche mieux que les autres, refaites-en une variante (même accroche, autre métier : plombier, électricien…).

Aucune vidéo ne peut garantir 100 000 vues : ça dépend de l’algorithme. Mais ces formats (accroche en 1 seconde, démonstration concrète, moins de 20 s, question qui fait commenter) sont ceux qui marchent le mieux. Publiez régulièrement : c’est souvent la 5e ou la 10e vidéo qui décolle.

## 1. `01-devis-22h.mp4` (17 s)

**Légende à copier :**

> Les artisans qui font encore leurs devis à 22h… 👀 Lien en bio pour tester gratuitement
>
> #artisan #btp #devis #autoentrepreneur #carreleur #plombier #electricien #entrepreneur #astuce

**Accroche :** POV : il est 22h et t’as encore 6 devis à faire 😩

## 2. `02-client-paie-pas.mp4` (17 s)

**Légende à copier :**

> Tout artisan a déjà eu CE client 😅 Comment vous faites vous ? Lien en bio
>
> #artisan #impayés #facture #btp #autoentrepreneur #entrepreneur #chantier #relou

**Accroche :** Le client qui paie toujours pas sa facture 🙄

## 3. `03-devis-en-facture.mp4` (15 s)

**Légende à copier :**

> Le jour où j’ai arrêté de retaper mes devis en factures 🙌 Lien en bio
>
> #artisan #facture #devis #gaindetemps #btp #autoentrepreneur #organisation

**Accroche :** Elle a accepté le devis ✅

## 4. `04-resilier-box.mp4` (16 s)

**Légende à copier :**

> Astuce paperasse que personne ne m’avait dite 😮‍💨 Lien en bio
>
> #astuce #administratif #paperasse #lifehack #budget #maison #resiliation #organisation

**Accroche :** Résilier sa box internet sans y passer 1h 📦

## 5. `05-chrono-devis.mp4` (13 s)

**Légende à copier :**

> Dites en commentaire combien de temps vous passez sur vos devis 👇
>
> #artisan #devis #btp #gaindetemps #autoentrepreneur #entrepreneur #productivite

**Accroche :** Un devis à la main :

## Refaire ou modifier les vidéos

Les scénarios sont dans `marketing/tiktok/videos.js` (textes, timings). Pour régénérer :

```bash
npm i -D playwright && npx playwright install chromium
node marketing/tiktok/make-videos.js            # toutes les vidéos
node marketing/tiktok/make-videos.js 01-devis-22h  # une seule
```
