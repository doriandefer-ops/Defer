// Génère un fichier CSV (ouvrable dans Excel) des entreprises du bâtiment en activité,
// à partir du registre officiel des entreprises (API Recherche d'entreprises, data.gouv.fr).
// Aucune adresse email : uniquement les informations publiques du registre.
//
// Usage :
//   node scripts/artisans-btp.js                          → Tarn (81), tous les métiers du bâtiment
//   node scripts/artisans-btp.js --departements 81,31,12  → plusieurs départements
//   node scripts/artisans-btp.js --metiers 43.22A,43.21A  → seulement plombiers et électriciens
//   node scripts/artisans-btp.js --sortie mes-artisans.csv
const fs = require('node:fs');

const API = process.env.RECHERCHE_ENTREPRISES_URL || 'https://recherche-entreprises.api.gouv.fr/search';
const PER_PAGE = 25; // maximum autorisé par l'API
const MAX_RESULTS = 10000; // l'API ne renvoie pas au-delà pour une même recherche
const PAUSE_MS = 200; // l'API limite à environ 7 requêtes par seconde

const METIERS = {
  '41.20A': 'Construction de maisons individuelles',
  '41.20B': "Construction d'autres bâtiments",
  '43.11Z': 'Travaux de démolition',
  '43.12A': 'Terrassement courant et travaux préparatoires',
  '43.12B': 'Terrassement spécialisé ou de grande masse',
  '43.13Z': 'Forages et sondages',
  '43.21A': "Travaux d'installation électrique",
  '43.21B': "Travaux d'installation électrique sur la voie publique",
  '43.22A': "Travaux d'installation d'eau et de gaz (plomberie)",
  '43.22B': "Travaux d'installation d'équipements thermiques et de climatisation",
  '43.29A': "Travaux d'isolation",
  '43.29B': "Autres travaux d'installation",
  '43.31Z': 'Travaux de plâtrerie',
  '43.32A': 'Travaux de menuiserie bois et PVC',
  '43.32B': 'Travaux de menuiserie métallique et serrurerie',
  '43.32C': "Agencement de lieux de vente",
  '43.33Z': 'Travaux de revêtement des sols et des murs (carrelage)',
  '43.34Z': 'Travaux de peinture et vitrerie',
  '43.39Z': 'Autres travaux de finition',
  '43.91A': 'Travaux de charpente',
  '43.91B': 'Travaux de couverture par éléments',
  '43.99A': "Travaux d'étanchéité",
  '43.99B': 'Travaux de montage de structures métalliques',
  '43.99C': 'Travaux de maçonnerie générale et gros œuvre',
  '43.99D': 'Autres travaux spécialisés de construction',
  '43.99E': 'Location avec opérateur de matériel de construction',
};

function parseArgs(argv) {
  const opts = { departements: ['81'], metiers: Object.keys(METIERS), sortie: 'artisans-btp.csv' };
  for (let i = 0; i < argv.length; i++) {
    const [key, value] = [argv[i], argv[i + 1]];
    if (key === '--departements') opts.departements = value.split(',').map((s) => s.trim());
    else if (key === '--metiers') opts.metiers = value.split(',').map((s) => s.trim().toUpperCase());
    else if (key === '--sortie') opts.sortie = value;
    else continue;
    i++;
  }
  const inconnus = opts.metiers.filter((m) => !METIERS[m]);
  if (inconnus.length) throw new Error(`Code(s) métier inconnu(s) : ${inconnus.join(', ')}`);
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(params, attempt = 1) {
  const res = await fetch(`${API}?${new URLSearchParams(params)}`, { headers: { Accept: 'application/json' } });
  if (res.status === 429 && attempt <= 5) {
    await sleep(1000 * attempt);
    return fetchPage(params, attempt + 1);
  }
  if (!res.ok) throw new Error(`Erreur ${res.status} de l'API pour ${JSON.stringify(params)}`);
  return res.json();
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const seen = new Set();
  const rows = [];

  for (const departement of opts.departements) {
    for (const code of opts.metiers) {
      let page = 1;
      let total = 0;
      do {
        const data = await fetchPage({
          activite_principale: code,
          departement,
          etat_administratif: 'A',
          per_page: PER_PAGE,
          page,
        });
        total = Math.min(data.total_results || 0, MAX_RESULTS);
        for (const e of data.results || []) {
          if (seen.has(e.siren)) continue;
          seen.add(e.siren);
          const s = e.siege || {};
          rows.push([
            e.nom_complet,
            e.siren,
            s.siret,
            METIERS[code],
            s.adresse,
            s.code_postal,
            s.libelle_commune,
            departement,
            e.date_creation || s.date_creation,
            e.nature_juridique,
            e.tranche_effectif_salarie,
          ]);
        }
        process.stdout.write(`\rDépartement ${departement} — ${METIERS[code]} : ${Math.min(page * PER_PAGE, total)}/${total}      `);
        page++;
        await sleep(PAUSE_MS);
      } while ((page - 1) * PER_PAGE < total);
      process.stdout.write('\n');
    }
  }

  const header = ['Nom', 'SIREN', 'SIRET du siège', 'Métier', 'Adresse', 'Code postal', 'Ville', 'Département',
    'Date de création', 'Nature juridique (code)', 'Tranche effectif (code)'];
  // Séparateur « ; » et BOM UTF-8 pour une ouverture directe dans Excel en français.
  const csv = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
  fs.writeFileSync(opts.sortie, csv);
  console.log(`\n${rows.length} entreprises enregistrées dans ${opts.sortie}`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
