# Prospection des artisans — MDIA

## 1. Fichier des entreprises du bâtiment

Le programme `scripts/artisans-btp.js` crée un tableau (CSV, s'ouvre dans Excel) des entreprises du bâtiment
**en activité**, à partir du registre officiel des entreprises : nom, SIRET, métier, adresse, ville, date de création.
Il ne contient **aucun email** : il sert au courrier, au téléphone et aux visites.

Sur votre ordinateur (Node.js installé), dans le dossier du projet :

```bash
node scripts/artisans-btp.js                                   # Tarn, tous les métiers du bâtiment
node scripts/artisans-btp.js --departements 81,31,12,34        # plusieurs départements
node scripts/artisans-btp.js --metiers 43.22A,43.21A,43.33Z    # plombiers, électriciens, carreleurs
node scripts/artisans-btp.js --sortie artisans-tarn.csv        # nom du fichier créé
```

Codes métiers utiles : `43.22A` plomberie · `43.22B` chauffage/clim · `43.21A` électricité · `43.32A` menuiserie ·
`43.33Z` carrelage · `43.34Z` peinture · `43.31Z` plâtrerie · `43.91A` charpente · `43.91B` couverture ·
`43.99C` maçonnerie · `43.29A` isolation · `41.20A` construction de maisons (liste complète dans le script).

---

## 2. Règles à respecter (CNIL)

- Écrire à un **professionnel** sans accord préalable est autorisé **si le message concerne son métier** (c'est le cas : gestion de son entreprise).
- Chaque email doit **indiquer qui vous êtes** et permettre de **se désinscrire simplement** (lien ou réponse « STOP »).
- Tenez une **liste des personnes désinscrites** et ne leur écrivez plus jamais.
- N'envoyez qu'à des adresses obtenues **légalement** : contacts rencontrés, cartes de visite, salons, fichier acheté auprès d'un fournisseur conforme (Kompass, Corporama…), ou personnes qui vous ont écrit.
- Envoyez **peu à la fois** (quelques dizaines par jour) et **personnalisez** : c'est la meilleure protection contre le spam.

---

## 3. Email de premier contact

**Objet** (au choix) :
- Vos devis et factures en une phrase, {Prénom}
- {Prénom}, combien d'heures par semaine sur la paperasse ?
- Un assistant administratif pour {Nom de l'entreprise}

> Bonjour {Prénom},
>
> Je m'appelle Dorian Defer, je suis entrepreneur à Castres et j'ai créé **MDIA**, un assistant qui s'occupe de l'administratif des artisans.
>
> Le principe est simple : vous écrivez comme à un collègue, par exemple
> *« Fais un devis pour Mme Martin : pose de 12 m² de carrelage à 45 € le m² »*,
> et le devis est prêt, avec la TVA calculée et le PDF à envoyer. Un clic de plus et il devient une facture.
>
> MDIA vous aide aussi à :
> - suivre vos factures impayées et préparer les relances ;
> - ne plus oublier vos échéances (URSSAF, TVA, assurances, fournisseurs) ;
> - rédiger vos courriers administratifs en quelques secondes.
>
> Vous pouvez l'essayer **gratuitement, sans carte bancaire** : https://mdia-eu.onrender.com
> L'offre Artisan complète est ensuite à 29,99 € par mois, sans engagement.
>
> Si vous voulez, je peux aussi vous le montrer en 10 minutes, par téléphone ou directement sur un de vos chantiers du coin.
>
> Bonne journée,
>
> Dorian Defer — MDIA
> 06 31 89 06 96 · doriandefer@icloud.com
>
> *Vous recevez ce message car votre entreprise exerce dans le bâtiment. Pour ne plus recevoir d'email de ma part, répondez simplement « STOP ».*

---

## 4. Relance (une seule, 7 à 10 jours après, sans réponse)

**Objet :** Re: Vos devis et factures en une phrase, {Prénom}

> Bonjour {Prénom},
>
> Je me permets une petite relance : beaucoup d'artisans me disent passer leurs soirées sur les devis et les factures.
> Avec MDIA, un devis prend une phrase et 30 secondes.
>
> L'essai est gratuit : https://mdia-eu.onrender.com — et je reste disponible si vous voulez une démonstration rapide.
>
> Bonne fin de semaine,
> Dorian — 06 31 89 06 96
>
> *Pour ne plus recevoir d'email de ma part, répondez « STOP ».*

---

## 5. Version courrier (pour le fichier des entreprises, qui contient les adresses)

> **Dorian Defer — MDIA**
> 53 avenue Émilie de Villeneuve, 81100 Castres
> 06 31 89 06 96 · doriandefer@icloud.com
>
> {Nom de l'entreprise}
> {Adresse}
> {Code postal} {Ville}
>
> Castres, le {date}
>
> **Objet : vos devis, factures et papiers, gérés en quelques secondes**
>
> Madame, Monsieur,
>
> Artisan, vous passez sans doute plusieurs heures par semaine sur vos devis, vos factures, vos relances et vos échéances.
> J'ai créé **MDIA**, un assistant en ligne qui s'en charge : il suffit de lui écrire, comme à un collègue,
> « fais un devis pour M. Durand, remplacement d'un chauffe-eau 850 € », et le devis est prêt, TVA comprise, en PDF.
>
> MDIA suit aussi vos factures impayées, vous rappelle vos échéances (URSSAF, TVA, assurances)
> et rédige vos courriers administratifs.
>
> Vous pouvez l'essayer gratuitement, sans carte bancaire, sur **mdia-eu.onrender.com**.
> Je serais également heureux de vous le présenter en 10 minutes : appelez-moi au 06 31 89 06 96.
>
> Je vous prie d'agréer, Madame, Monsieur, mes salutations distinguées.
>
> Dorian Defer

---

## 6. Conseils

- **Commencez près de chez vous** (Castres, Albi, Mazamet…) : proposer une démonstration en personne convertit beaucoup mieux qu'un email.
- **Visez un métier à la fois** (ex. les plombiers du Tarn) et adaptez l'exemple de devis au métier.
- Notez dans le fichier qui vous avez contacté, quand, et la réponse — et retirez immédiatement ceux qui disent « STOP ».
