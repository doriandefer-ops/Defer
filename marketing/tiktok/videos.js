// Scénarios des vidéos TikTok / Reels / Shorts (1080×1920). Temps en secondes.
// Légendes : **texte** = surligné en jaune.
const devisDoc = `
  <h3>DEVIS</h3><div class="muted">N° D-2026-0014 · Mme Martin</div>
  <table>
    <tr><td>Pose carrelage · 12 m² × 45 €</td><td class="n">540,00 €</td></tr>
    <tr><td>Préparation · 2 h × 40 €</td><td class="n">80,00 €</td></tr>
    <tr><td class="muted">TVA 20 %</td><td class="n muted">124,00 €</td></tr>
  </table>
  <div class="total"><span>Total TTC</span><span>744,00 €</span></div>
  <p><span class="badge">PDF prêt à envoyer</span></p>`;

const factureDoc = `
  <h3>FACTURE</h3><div class="muted">N° F-2026-0031 · d'après le devis D-2026-0014</div>
  <table>
    <tr><td>Pose carrelage · 12 m² × 45 €</td><td class="n">540,00 €</td></tr>
    <tr><td>Préparation · 2 h × 40 €</td><td class="n">80,00 €</td></tr>
  </table>
  <div class="total"><span>Total TTC</span><span>744,00 €</span></div>
  <p class="muted">À régler sous 30 jours</p>`;

const relanceDoc = `
  <h3 style="font-size:32px">Objet : relance — facture F-2026-0031</h3>
  <p>Bonjour Monsieur Durand,</p>
  <p>Sauf erreur de notre part, la facture F-2026-0031 de 850,00 € arrivée à échéance le 5 octobre reste impayée.</p>
  <p>Pourriez-vous procéder à son règlement sous 8 jours ? Si le paiement a été fait entre-temps, merci de ne pas tenir compte de ce message.</p>
  <p class="muted">Cordialement, …</p>`;

const resiliationDoc = `
  <h3 style="font-size:32px">Objet : résiliation de mon abonnement internet</h3>
  <p>Madame, Monsieur,</p>
  <p>Par la présente, je vous informe de ma décision de résilier mon abonnement n° [numéro de contrat], à compter de la date de réception de ce courrier.</p>
  <p>Merci de m'indiquer les modalités de restitution du matériel…</p>
  <p><span class="badge">Lettre prête · à compléter et signer</span></p>`;

module.exports = [
  {
    file: '01-devis-22h',
    // Voix off (orthographe phonétique pour la synthèse : « èm dé i a » = MDIA)
    voice: [
      { t: 0.3, text: "Il est vingt-deux heures, et t'as encore six devis à faire ?" },
      { t: 3.3, text: "Avec èm dé i a, tu écris juste ce que tu veux." },
      { t: 7.0, text: "Et ton devis est prêt. Té vé a comprise. En trente secondes." },
      { t: 14.3, text: "Essai gratuit. Le lien est dans la bio." },
    ],
    duration: 17,
    captions: [
      { t0: 0, t1: 3, text: 'POV : il est 22h et t’as encore **6 devis** à faire 😩' },
      { t0: 3, t1: 10.5, text: 'Moi depuis que j’ai **MDIA** :' },
      { t0: 10.5, t1: 14, text: '**30 secondes.** TVA comprise. PDF prêt.' },
    ],
    phone: { t0: 2.6, t1: 14 },
    messages: [
      { t: 3.1, role: 'user', dur: 3.2, text: 'Devis pour Mme Martin : 12 m² de carrelage à 45 € le m² + 2 h de préparation à 40 €' },
      { t: 6.6, role: 'bot', html: '✅ Devis <b>D-2026-0014</b> créé : 620 € HT · <b>744 € TTC</b>' },
      { t: 8.2, role: 'doc', html: devisDoc },
    ],
    end: { t0: 14, tagline: 'Tes devis et factures en une phrase', promo: '🎁 Code LANCEMENT : 2 mois offerts' },
    post: {
      caption: 'Les artisans qui font encore leurs devis à 22h… 👀 Lien en bio pour tester gratuitement',
      hashtags: '#artisan #btp #devis #autoentrepreneur #carreleur #plombier #electricien #entrepreneur #astuce',
    },
  },
  {
    file: '02-client-paie-pas',
    // Voix off (orthographe phonétique pour la synthèse : « èm dé i a » = MDIA)
    voice: [
      { t: 0.3, text: "Le client qui paie toujours pas sa facture ?" },
      { t: 3.2, text: "Demande à èm dé i a d'écrire la relance." },
      { t: 6.8, text: "Polie, ferme, et prête à envoyer." },
      { t: 14.3, text: "Fini de courir après les impayés. Lien en bio." },
    ],
    duration: 17,
    captions: [
      { t0: 0, t1: 3, text: 'Le client qui paie **toujours pas** sa facture 🙄' },
      { t0: 3, t1: 10.5, text: 'Au lieu de m’énerver, je demande à **MDIA** :' },
      { t0: 10.5, t1: 14, text: 'Relance **polie mais ferme.** Prête à envoyer.' },
    ],
    phone: { t0: 2.6, t1: 14 },
    messages: [
      { t: 3.1, role: 'user', dur: 3, text: 'Rédige une relance pour M. Durand, facture F-2026-0031 de 850 €, en retard de 15 jours' },
      { t: 6.4, role: 'doc', html: relanceDoc },
    ],
    end: { t0: 14, tagline: 'Fini de courir après les impayés', promo: '🎁 Code LANCEMENT : 2 mois offerts' },
    post: {
      caption: 'Tout artisan a déjà eu CE client 😅 Comment vous faites vous ? Lien en bio',
      hashtags: '#artisan #impayés #facture #btp #autoentrepreneur #entrepreneur #chantier #relou',
    },
  },
  {
    file: '03-devis-en-facture',
    // Voix off (orthographe phonétique pour la synthèse : « èm dé i a » = MDIA)
    voice: [
      { t: 0.3, text: "Ta cliente a accepté le devis ?" },
      { t: 3.2, text: "Une phrase, et èm dé i a le transforme en facture." },
      { t: 9.2, text: "Sans rien retaper." },
      { t: 12.8, text: "Essaie gratuitement. Lien en bio." },
    ],
    duration: 15,
    captions: [
      { t0: 0, t1: 3, text: 'Elle a **accepté le devis** ✅' },
      { t0: 3, t1: 9, text: 'Avant : je retapais tout pour faire la facture…' },
      { t0: 9, t1: 12.5, text: 'Maintenant : **1 phrase.** Zéro ressaisie.' },
    ],
    phone: { t0: 2.6, t1: 12.5 },
    messages: [
      { t: 3.2, role: 'user', dur: 2, text: 'Transforme le devis D-2026-0014 en facture' },
      { t: 5.4, role: 'bot', html: '✅ Facture <b>F-2026-0031</b> créée, à régler sous 30 jours' },
      { t: 6.9, role: 'doc', html: factureDoc },
    ],
    end: { t0: 12.5, tagline: 'Du devis à la facture en 1 phrase', promo: '🎁 Code LANCEMENT : 2 mois offerts' },
    post: {
      caption: 'Le jour où j’ai arrêté de retaper mes devis en factures 🙌 Lien en bio',
      hashtags: '#artisan #facture #devis #gaindetemps #btp #autoentrepreneur #organisation',
    },
  },
  {
    file: '04-resilier-box',
    // Voix off (orthographe phonétique pour la synthèse : « èm dé i a » = MDIA)
    voice: [
      { t: 0.3, text: "Résilier sa box internet sans y passer une heure ?" },
      { t: 3.2, text: "Demande simplement la lettre à èm dé i a." },
      { t: 10.1, text: "Elle est prête. Tu n'as plus qu'à signer." },
      { t: 13.1, text: "Tes papiers, enfin simples. Lien en bio." },
    ],
    duration: 16,
    captions: [
      { t0: 0, t1: 3, text: 'Résilier sa box internet **sans y passer 1h** 📦' },
      { t0: 3, t1: 10, text: 'J’ai juste écrit ça :' },
      { t0: 10, t1: 13, text: 'Lettre prête. **Plus qu’à signer.** ✍️' },
    ],
    phone: { t0: 2.6, t1: 13 },
    messages: [
      { t: 3.1, role: 'user', dur: 2.4, text: 'Écris une lettre de résiliation pour ma box internet' },
      { t: 5.8, role: 'doc', html: resiliationDoc },
    ],
    end: { t0: 13, tagline: 'Les papiers de la maison, enfin simples', promo: 'Offre Foyer : 4,99 € / mois', small: 'Version gratuite pour essayer' },
    post: {
      caption: 'Astuce paperasse que personne ne m’avait dite 😮‍💨 Lien en bio',
      hashtags: '#astuce #administratif #paperasse #lifehack #budget #maison #resiliation #organisation',
    },
  },
  {
    file: '05-chrono-devis',
    // Voix off (orthographe phonétique pour la synthèse : « èm dé i a » = MDIA)
    voice: [
      { t: 0.3, text: "Un devis à la main ? Vingt-cinq minutes." },
      { t: 3.9, text: "Le même avec èm dé i a ? Trente secondes." },
      { t: 7.7, text: "Et toi, tu perds combien d'heures par semaine ?" },
      { t: 10.2, text: "Récupère tes soirées. Lien en bio." },
    ],
    duration: 13,
    captions: [
      { t0: 0, t1: 3.6, text: 'Un devis **à la main** :' },
      { t0: 3.6, t1: 7.6, text: 'Le même devis **avec MDIA** :' },
      { t0: 7.6, t1: 10, text: 'Et toi, tu perds **combien d’heures** par semaine ? 👇' },
    ],
    phone: null,
    messages: [],
    timers: [
      { t0: 0.3, t1: 3.6, label: '⏱️ Temps passé', from: 0, to: 25, format: '{v} min', countDur: 2.5, color: '#ffb4a8' },
      { t0: 3.9, t1: 7.6, label: '⚡ Temps passé', from: 0, to: 30, format: '{v} s', countDur: 1.2, color: '#b8f2c9' },
    ],
    end: { t0: 10, tagline: 'Récupère tes soirées', promo: '🎁 Code LANCEMENT : 2 mois offerts' },
    post: {
      caption: 'Dites en commentaire combien de temps vous passez sur vos devis 👇',
      hashtags: '#artisan #devis #btp #gaindetemps #autoentrepreneur #entrepreneur #productivite',
    },
  },
];
