#!/usr/bin/env python3
"""Exporte les coordonnées publiques des entreprises du BTP certifiées RGE.

Source : jeu de données open data de l'ADEME « Liste des entreprises RGE »
(Licence Ouverte Etalab). Ces entreprises publient elles-mêmes leurs
coordonnées dans l'annuaire France Rénov' pour être contactées.

Usage :
    python3 scripts/export_rge.py                     # toute la France
    python3 scripts/export_rge.py --departement 69    # un département
    python3 scripts/export_rge.py --domaine isolation # filtre sur le domaine

Sortie : data/entreprises_rge.csv (une ligne par entreprise, domaines agrégés).

Rappel RGPD : une adresse e-mail nominative d'un artisan reste une donnée
personnelle. La prospection B2B est permise si le message concerne son
activité professionnelle, avec à chaque envoi l'identité de l'expéditeur et
un lien de désinscription respecté. Tenez une liste d'opposition.
"""

import argparse
import csv
import json
import os
import sys
import urllib.parse
import urllib.request

API = "https://data.ademe.fr/data-fair/api/v1/datasets/{dataset}/lines"
DEFAULT_DATASET = "liste-des-entreprises-rge-2"
PAGE_SIZE = 10000


def fetch_lines(dataset, query):
    params = {"size": PAGE_SIZE, **query}
    url = API.format(dataset=dataset) + "?" + urllib.parse.urlencode(params)
    while url:
        with urllib.request.urlopen(url, timeout=120) as resp:
            page = json.load(resp)
        yield from page.get("results", [])
        print(f"  {page.get('total', '?')} lignes au total…", file=sys.stderr)
        url = page.get("next")


def find_column(row, *candidates):
    keys = {k.lower(): k for k in row}
    for cand in candidates:
        for low, key in keys.items():
            if cand in low:
                return key
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dataset", default=DEFAULT_DATASET)
    parser.add_argument("--departement", help="ex. 75, 69, 2A")
    parser.add_argument("--domaine", help="texte libre recherché (ex. pompe à chaleur)")
    parser.add_argument("--output", default="data/entreprises_rge.csv")
    args = parser.parse_args()

    query = {}
    if args.departement:
        query["qs"] = f"code_postal:{args.departement}*"
    if args.domaine:
        query["q"] = args.domaine

    companies = {}
    cols = None
    for row in fetch_lines(args.dataset, query):
        if cols is None:
            cols = {
                "siret": find_column(row, "siret"),
                "nom": find_column(row, "nom_entreprise", "raison", "nom"),
                "adresse": find_column(row, "adresse"),
                "code_postal": find_column(row, "code_postal", "postal"),
                "commune": find_column(row, "commune", "ville"),
                "telephone": find_column(row, "telephone", "tel"),
                "email": find_column(row, "email", "mail", "courriel"),
                "site_internet": find_column(row, "site_internet", "site", "web"),
                "domaine": find_column(row, "domaine"),
            }
            missing = [k for k, v in cols.items() if v is None]
            if missing:
                print(f"Colonnes introuvables : {missing}", file=sys.stderr)

        def get(field):
            key = cols[field]
            return str(row.get(key) or "").strip() if key else ""

        email = get("email").lower()
        if not email:
            continue
        key = (get("siret") or get("nom"), email)
        entry = companies.setdefault(key, {f: get(f) for f in cols if f != "domaine"} | {
            "email": email, "domaines": set()})
        if get("domaine"):
            entry["domaines"].add(get("domaine"))

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    fields = ["siret", "nom", "adresse", "code_postal", "commune",
              "telephone", "email", "site_internet", "domaines"]
    with open(args.output, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, delimiter=";")
        writer.writeheader()
        for entry in companies.values():
            entry["domaines"] = " | ".join(sorted(entry["domaines"]))
            writer.writerow({k: entry.get(k, "") for k in fields})

    print(f"{len(companies)} entreprises avec e-mail -> {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
