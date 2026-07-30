#!/usr/bin/env python3
"""
Build a film dataset from Wikidata (CC0) for the movie version of the
chart-ladder game.

WHY THIS RUNS LOCALLY, NOT IN A SANDBOX:
This makes real HTTP requests to query.wikidata.org. Run it on a machine
with normal internet access.

Usage:
    pip install requests
    python3 films_enrich.py                       # full run, 1950-2026
    python3 films_enrich.py --test-year 1994      # single year, to eyeball output
    python3 films_enrich.py --dry-run             # print queries, make no requests
    python3 films_enrich.py --from 1970 --to 1979 --min-sitelinks 15

Output: films.csv -- one row per film, pipe-separated multi-value columns,
in the same shape connections_generator.py already expects.

-------------------------------------------------------------------------
KEY DESIGN CONSTRAINT (learned the hard way)
-------------------------------------------------------------------------
Wikidata's query service TIMES OUT if you ask for all film properties in
one query -- a single-year query with 11 OPTIONAL blocks returns
"upstream request timeout". Each OPTIONAL multiplies intermediate result
rows before GROUP BY collapses them, and cast members alone (P161) can be
30+ per film.

So this script works in two phases:

  Phase 1 (seed): one light query per year returns the film list for that
  year -- QID, English label, year, sitelink count, IMDb ID. Cheap and
  reliable.

  Phase 2 (enrich): for batches of ~80 film QIDs at a time, query ONE
  small group of related properties per request. Cast gets its own query
  because it's the heaviest. Roughly 5 property-group queries per batch.

That's more requests than a single mega-query, but each one actually
completes. Everything is cached to ./cache_films/ so the run is resumable.

-------------------------------------------------------------------------
KNOWN DATA CAVEAT: archive-footage "cast members"
-------------------------------------------------------------------------
Wikidata's P161 (cast member) includes people who appear only as archive
footage. Forrest Gump, for example, lists John Lennon and Gerald Ford
alongside Tom Hanks. The sitelink filter won't catch these -- they're very
notable people, just not actors in the film.

If this produces confusing game connections, add an occupation filter to
the cast group: require the cast member to have P106 (occupation) =
Q33999 (actor), i.e. insert into the cast OPTIONAL block:

    ?castmember wdt:P106 wd:Q33999.

Trade-off: that also drops legitimate actors whose Wikidata occupation
field is incomplete, so verify coverage before enabling it globally.
-------------------------------------------------------------------------
"""

import argparse
import csv
import json
import os
import time
from collections import defaultdict

import requests

SPARQL_URL = "https://query.wikidata.org/sparql"
USER_AGENT = "ChartLadderFilmGame/1.0 (research project; contact: essar21@gmail.com)"
CACHE_DIR = "cache_films"

BATCH_SIZE = 50  # was 80; lowered for headroom against the confirmed ~96KB
                 # response-truncation wall (see sparql_query/SEED_PAGE_SIZE
                 # comments) -- cast/production groups can get verbose per
                 # film, so a smaller batch keeps worst-case responses safer.
SLEEP_BETWEEN_REQUESTS = 1.2

# Populated as the run goes; reported at the end so failures are visible
# instead of silently missing from films.csv. See sparql_query's docstring
# for the truncated-JSON failure mode these are guarding against.
failed_seed_years = []
failed_enrich_batches = []  # list of (group_name, [qids]) tuples

# Property groups, deliberately kept small so each query completes.
# name -> list of (sparql_var, property_path, output_column, min_target_sitelinks)
#
# min_target_sitelinks filters the LINKED ENTITY by its own notability, not
# the film. This matters enormously for cast: Wikidata lists every credited
# and uncredited extra, so Forrest Gump returns 120+ names including bit
# players and archive-footage cameos. A "shared cast member" game connection
# hinging on an unknown extra is unplayable, so we keep only actors who are
# themselves reasonably well known. 0 = no filter.
PROPERTY_GROUPS = {
    "crew": [
        ("director", "wdt:P57", "directors", 0),
        ("screenwriter", "wdt:P58", "screenwriters", 0),
    ],
    "cast": [
        # on its own -- P161 has the highest cardinality by far
        ("castmember", "wdt:P161", "cast", 15),
    ],
    "classification": [
        ("genre", "wdt:P136", "genres", 0),
        ("country", "wdt:P495", "countries", 0),
    ],
    "production": [
        ("company", "wdt:P272", "companies", 0),
        ("composer", "wdt:P86", "composers", 0),
    ],
    "recognition": [
        ("award", "wdt:P166", "awards", 0),
        ("series", "wdt:P179", "series", 0),
        ("basedon", "wdt:P144", "based_on", 0),
    ],
}

ALL_OUTPUT_COLUMNS = [col for grp in PROPERTY_GROUPS.values() for (_, _, col, _) in grp]


# ---------------------------------------------------------------------------
# HTTP / cache plumbing
# ---------------------------------------------------------------------------

def sparql_query(query, retries=8, dry_run=False):
    """Raises RuntimeError after exhausting retries -- callers should treat
    that as "this one query is unrecoverable right now" and skip/continue
    rather than letting it kill an hours-long run.

    Known failure mode (seen in practice): responses truncated mid-string at
    a consistent byte offset across every retry -- e.g. "Unterminated string
    starting at: line N column M (char K)" from resp.json(). This is a
    transport-layer truncation, most likely caused by macOS system Python's
    old LibreSSL (urllib3 v2 needs OpenSSL 1.1.1+; LibreSSL 2.8.3 is known
    to mishandle larger HTTPS response bodies). If you see this repeatedly,
    run `python3 -m pip install --user "urllib3<2"` (or use a Python built
    against real OpenSSL, e.g. via Homebrew/pyenv) before re-running -- that
    fixes the root cause. This function's job is just to not take the whole
    run down when it happens anyway.
    """
    if dry_run:
        print("\n--- QUERY ---\n" + query + "\n-------------")
        return {"results": {"bindings": []}}
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.get(
                SPARQL_URL,
                params={"query": query, "format": "json"},
                headers={"User-Agent": USER_AGENT,
                         "Accept": "application/sparql-results+json",
                         "Connection": "close"},
                timeout=90,
            )
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 15))
                print(f"    rate limited, waiting {wait}s")
                time.sleep(wait)
                continue
            if resp.status_code >= 500 or "timeout" in resp.text[:200].lower():
                wait = min(60, 10 * (attempt + 1))
                print(f"    server/timeout error, retrying in {wait}s")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            try:
                return resp.json()
            except (json.JSONDecodeError, ValueError) as e:
                last_err = e
                wait = min(60, 5 * (attempt + 1))
                print(f"    malformed/truncated JSON response "
                      f"({len(resp.content)} bytes, {e}), retrying in {wait}s")
                time.sleep(wait)
                continue
        except requests.RequestException as e:
            last_err = e
            wait = min(60, 5 * (attempt + 1))
            print(f"    request error ({e}), retrying in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"SPARQL query failed after {retries} retries: {last_err}")


def cache_path(name):
    return os.path.join(CACHE_DIR, name)


def load_cache(name):
    p = cache_path(name)
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return {}


def save_cache(name, data):
    os.makedirs(CACHE_DIR, exist_ok=True)
    p = cache_path(name)
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, p)


def batched(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ---------------------------------------------------------------------------
# Phase 1: seed the film list, one light query per year
# ---------------------------------------------------------------------------

# Confirmed in practice: something on the network path between this script
# and query.wikidata.org truncates HTTP response bodies at EXACTLY 98304
# bytes (96*1024) -- reproduced identically across multiple different years
# and after ruling out the LibreSSL/urllib3 theory (persisted after
# downgrading urllib3). That's a hard external cap (likely TLS-inspecting
# security software or a proxy on this network), not query-content-dependent,
# so the fix is to keep every response well under it rather than to keep
# retrying. Seed queries are paginated below for exactly this reason.
SEED_PAGE_SIZE = 120


def build_seed_query(year, min_sitelinks, limit=None, offset=0):
    limit_clause = f"ORDER BY ?film\nLIMIT {limit}\nOFFSET {offset}" if limit else ""
    return f"""
SELECT ?film ?filmLabel ?sitelinks ?imdb WHERE {{
  ?film wdt:P31 wd:Q11424;
        wdt:P577 ?date;
        wikibase:sitelinks ?sitelinks.
  FILTER(?sitelinks >= {min_sitelinks})
  FILTER(YEAR(?date) = {year})
  ?film rdfs:label ?filmLabel. FILTER(lang(?filmLabel) = "en")
  OPTIONAL {{ ?film wdt:P345 ?imdb. }}
}}
{limit_clause}
"""


def seed_films(years, min_sitelinks, dry_run=False):
    """Returns {qid: {title, year, sitelinks, imdb}}.

    Paginates each year's seed query in pages of SEED_PAGE_SIZE (ORDER BY
    ?film + LIMIT/OFFSET) to stay well under the ~96KB response-truncation
    wall described above -- a page keeps stopping once it comes back with
    fewer than SEED_PAGE_SIZE rows.

    A page that still fails after all sparql_query retries is skipped, not
    fatal -- it's logged and the year is added to the module-level
    `failed_seed_years` list so main() can report it and you can backfill
    later with `--from YEAR --to YEAR`, instead of losing an hours-long run
    to one bad response. Note a partially-seeded year (some pages ok, one
    page failed) is NOT cached as complete, so a rerun will redo the whole
    year -- cheap now that pages are small.
    """
    cache = load_cache("seed.json")
    for year in years:
        key = f"{year}:{min_sitelinks}"
        if key in cache:
            continue
        print(f"  seeding {year}")
        year_films = {}
        offset = 0
        year_ok = True
        while True:
            try:
                data = sparql_query(
                    build_seed_query(year, min_sitelinks, limit=SEED_PAGE_SIZE, offset=offset),
                    dry_run=dry_run)
            except RuntimeError as e:
                print(f"  WARNING: giving up on {year} (offset {offset}) for now ({e}). "
                      f"Skipping -- rerun later with --from {year} --to {year} to backfill.")
                failed_seed_years.append(year)
                year_ok = False
                break
            bindings = data["results"]["bindings"]
            for row in bindings:
                qid = row["film"]["value"].rsplit("/", 1)[-1]
                year_films[qid] = {
                    "title": row["filmLabel"]["value"],
                    "year": year,
                    "sitelinks": int(row["sitelinks"]["value"]),
                    "imdb": row.get("imdb", {}).get("value", ""),
                }
            if not dry_run:
                time.sleep(SLEEP_BETWEEN_REQUESTS)
            if dry_run or len(bindings) < SEED_PAGE_SIZE:
                # dry_run never returns real bindings, so always stop after
                # one page; otherwise a short page means we've reached the
                # end of this year's results.
                break
            offset += SEED_PAGE_SIZE

        if year_ok:
            cache[key] = year_films
            save_cache("seed.json", cache)
        if dry_run:
            break

    # Some films have more than one qualifying wdt:P577 date (a festival
    # premiere and a separate wide-release date are common, and they can
    # straddle a calendar year, e.g. Dec 1993 premiere / Jan 1994 wide
    # release). Because each year is seeded independently, such a film gets
    # returned once per matching year and ends up in more than one of the
    # per-year cache buckets under the SAME qid but a DIFFERENT 'year'
    # value. Confirmed in this dataset: 169 of 329 films originally seeded
    # under 1994 also appeared under 1993 or 1995.
    #
    # A plain dict.update() here would let whichever cache key happens to
    # be iterated last silently win -- which for a persisted, incrementally-
    # grown cache.json depends on insertion order across possibly many
    # separate runs, i.e. is effectively arbitrary and non-reproducible.
    # Instead, deterministically keep the EARLIEST qualifying year per film
    # (its first release/premiere), so the result doesn't depend on cache
    # history or run order.
    films = {}
    for key, year_films in cache.items():
        if key.endswith(f":{min_sitelinks}"):
            y = int(key.split(":")[0])
            if y in years:
                for qid, info in year_films.items():
                    if qid not in films or info["year"] < films[qid]["year"]:
                        films[qid] = info
    return films


# ---------------------------------------------------------------------------
# Phase 2: enrich in small property groups
# ---------------------------------------------------------------------------

def build_property_query(qids, group_name):
    props = PROPERTY_GROUPS[group_name]
    values = " ".join(f"wd:{q}" for q in qids)

    select_parts, where_parts, group_by = [], [], ["?film"]
    for var, path, _col, min_sl in props:
        select_parts.append(
            f'(GROUP_CONCAT(DISTINCT ?{var}Label; separator="|") AS ?{var}s)')
        notability = ""
        if min_sl:
            notability = (f' ?{var} wikibase:sitelinks ?{var}SL. '
                          f'FILTER(?{var}SL >= {min_sl}).')
        where_parts.append(
            f'  OPTIONAL {{ ?film {path} ?{var}.{notability} '
            f'?{var} rdfs:label ?{var}Label. FILTER(lang(?{var}Label) = "en") }}')

    return f"""
SELECT ?film
{chr(10).join('  ' + s for s in select_parts)}
WHERE {{
  VALUES ?film {{ {values} }}
{chr(10).join(where_parts)}
}}
GROUP BY {' '.join(group_by)}
"""


def enrich_group(qids, group_name, dry_run=False):
    cache_name = f"{group_name}.json"
    cache = load_cache(cache_name)
    todo = [q for q in qids if q not in cache]
    if not todo:
        return cache

    total_batches = (len(todo) - 1) // BATCH_SIZE + 1
    for i, batch in enumerate(batched(todo, BATCH_SIZE)):
        print(f"  {group_name}: batch {i+1}/{total_batches} ({len(batch)} films)")
        try:
            data = sparql_query(build_property_query(batch, group_name), dry_run=dry_run)
        except RuntimeError as e:
            print(f"  WARNING: giving up on {group_name} batch {i+1}/{total_batches} "
                  f"for now ({e}). Those films will have empty '{group_name}' fields "
                  f"until you rerun (cache lets you pick this back up).")
            failed_enrich_batches.append((group_name, list(batch)))
            if not dry_run:
                time.sleep(SLEEP_BETWEEN_REQUESTS)
            continue
        got = {}
        for row in data["results"]["bindings"]:
            qid = row["film"]["value"].rsplit("/", 1)[-1]
            rec = {}
            for var, _path, col, _min_sl in PROPERTY_GROUPS[group_name]:
                raw = row.get(f"{var}s", {}).get("value", "")
                rec[col] = [v for v in raw.split("|") if v]
            got[qid] = rec
        for q in batch:
            cache[q] = got.get(q, {col: [] for (_, _, col, _) in PROPERTY_GROUPS[group_name]})
        save_cache(cache_name, cache)
        if not dry_run:
            time.sleep(SLEEP_BETWEEN_REQUESTS)
        if dry_run:
            break
    return cache


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="year_from", type=int, default=1950)
    ap.add_argument("--to", dest="year_to", type=int, default=2026)
    ap.add_argument("--min-sitelinks", type=int, default=12,
                    help="Recognizability filter. 12 keeps ~15k films across "
                         "1950-2026; raise for a smaller/more famous set.")
    ap.add_argument("--test-year", type=int, default=None,
                    help="Run a single year end-to-end and print a sample")
    ap.add_argument("--out", default="films.csv")
    ap.add_argument("--dry-run", action="store_true",
                    help="Print one query per phase and exit, no HTTP")
    args = ap.parse_args()

    if args.test_year:
        years = [args.test_year]
    else:
        years = list(range(args.year_from, args.year_to + 1))

    print(f"Seeding films for {len(years)} year(s), min sitelinks {args.min_sitelinks}")
    films = seed_films(years, args.min_sitelinks, dry_run=args.dry_run)
    print(f"  -> {len(films)} films\n")

    if args.dry_run:
        for g in PROPERTY_GROUPS:
            print(build_property_query(["Q23780", "Q109607"], g))
        print("Dry run complete -- no requests were made.")
        return

    qids = sorted(films)
    group_caches = {}
    for group_name in PROPERTY_GROUPS:
        print(f"Enriching: {group_name}")
        group_caches[group_name] = enrich_group(qids, group_name)
    print()

    fieldnames = ["wikidata_id", "title", "year", "sitelinks", "imdb_id"] + ALL_OUTPUT_COLUMNS
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for qid in qids:
            info = films[qid]
            row = {
                "wikidata_id": qid,
                "title": info["title"],
                "year": info["year"],
                "sitelinks": info["sitelinks"],
                "imdb_id": info["imdb"],
            }
            for group_name, cache in group_caches.items():
                rec = cache.get(qid, {})
                for _var, _path, col, _min_sl in PROPERTY_GROUPS[group_name]:
                    row[col] = "|".join(rec.get(col, []))
            w.writerow(row)

    # coverage report -- tells you which connection types will actually be usable
    print(f"Wrote {args.out} ({len(qids)} films)\n")
    print(f"{'column':<16}{'films with data':>16}{'coverage':>11}")
    for col in ALL_OUTPUT_COLUMNS:
        n = 0
        for group_name, cache in group_caches.items():
            if any(c == col for (_, _, c, _) in PROPERTY_GROUPS[group_name]):
                n = sum(1 for q in qids if cache.get(q, {}).get(col))
        print(f"{col:<16}{n:>16}{n/max(1,len(qids))*100:>10.1f}%")

    if args.test_year:
        print("\nSample rows:")
        for qid in qids[:5]:
            info = films[qid]
            crew = group_caches["crew"].get(qid, {})
            cast = group_caches["cast"].get(qid, {})
            print(f"  {info['title']} ({info['year']}) "
                  f"dir={crew.get('directors')} cast={(cast.get('cast') or [])[:3]}")

    if failed_seed_years or failed_enrich_batches:
        print("\n--- Incomplete: some requests failed after retries ---")
        if failed_seed_years:
            print(f"  Years never seeded: {sorted(set(failed_seed_years))}")
            print(f"  Backfill with, e.g.: python3 {os.path.basename(__file__)} "
                  f"--from {min(failed_seed_years)} --to {max(failed_seed_years)}")
        if failed_enrich_batches:
            n_films_missing = sum(len(qids_) for _, qids_ in failed_enrich_batches)
            groups_hit = sorted({g for g, _ in failed_enrich_batches})
            print(f"  {len(failed_enrich_batches)} batch(es) across {groups_hit} "
                  f"never enriched ({n_films_missing} film-group pairs affected).")
        print("  Just rerun the same command -- cached years/batches are "
              "skipped automatically, only the gaps above get retried.")


if __name__ == "__main__":
    main()
