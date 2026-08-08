#!/usr/bin/env python3
"""
Build movie-ladder's connections dataset from films.csv (produced by
films_enrich.py).

Adapted from chart-ladder's connections_generator.py for the music game --
same output shape, different schema and connection types. See CLAUDE.md
section 6 ("Genre tags may be too broad") for why this version, unlike the
music one, produces NO same_genre (or equivalent) group at all: Wikidata's
film genre tagging is broad enough (Pulp Fiction alone carries 15 tags,
several generic like "drama film") that most substantial films would end up
sharing at least one genre tag, undermining the "a decoy has zero valid
connections" premise movie-ladder's round logic depends on (see
round_selector.py). This is a decided constraint, not a tunable default --
do not add genre back without revisiting that design doc.

Output shape (same as the music generator): each connection type maps an
attribute value -> the list of movie IDs sharing it, not precomputed pairs.
At game-build time: pick a connection type, pick a group with 2+ movies,
pick two. Movies are stored once in an array; array position IS the movie
ID, referenced as a small integer everywhere else.

Connection types produced (see README.md / CLAUDE.md section 5b):
    same_director, shared_cast_member, same_screenwriter, same_composer,
    same_company, same_country, same_award, same_series, same_based_on,
    same_release_year, shared_title_word.

Note on same_country: verified against the real dataset (2026-07-30),
United States alone covers 59.4% of all 17,009 films (France 15.0%, UK
13.1%). That's the same shape of risk documented for genre in CLAUDE.md
section 6 -- two otherwise-unrelated films sharing "United States" is the
common case, not the exception, which could make same_country a
near-always-true connection for the majority-country films and weaken the
"decoy has zero connections" guarantee for them. Left in because the
project's connection-type list (README.md, section 5b) explicitly includes
it and only genre was decided/documented as excluded -- but this is a real
finding, not a null result, and worth the same scrutiny genre got before
this ships. Flagging here and in the punch-list writeup rather than
dropping it unilaterally.

US-relevance filter (decided 2026-07-31): too many non-US films were
obscure to US players. Non-US movies are dropped from the shipped movie
pool entirely unless they have a real (active-connection-type) link to a
US movie or won one of the major awards same_award is restricted to (see
US_RELEVANCE_CONNECTION_TYPES below) -- US movies are always kept. This
runs after every connection group is built but before compact integer IDs
are assigned, so a dropped movie simply never gets an ID and disappears
from every group it would have appeared in.

Usage:
    python3 connections_generator.py --csv films.csv --out connections.json
"""

import argparse
import csv
import gzip
import json
import os
import re
import unicodedata
from collections import defaultdict


def normalize_title(t):
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode("ascii")
    t = t.lower()
    t = re.sub(r"[^a-z0-9 ]+", "", t)
    return t.strip()


def title_words(t):
    stop = {"the", "a", "an", "of", "in", "on", "to", "and", "my", "you", "i", "me"}
    words = re.findall(r"[a-z0-9']+", t.lower())
    return {w for w in words if w not in stop and len(w) > 2}


def split_multi(v):
    """Films.csv's multi-valued fields (directors, cast, etc.) are pipe-separated."""
    if not v:
        return []
    return [x.strip() for x in v.split("|") if x.strip()]


def add(groups, key, value, movie_id):
    groups[key][value].add(movie_id)


# connection_type -> films.csv column it's derived from (all pipe-split, one
# group per distinct value). genres is deliberately absent -- see module
# docstring and CLAUDE.md section 6.
MULTI_VALUE_CONNECTIONS = {
    "same_director": "directors",
    "shared_cast_member": "cast",
    "same_screenwriter": "screenwriters",
    "same_composer": "composers",
    "same_company": "companies",
    "same_country": "countries",
    "same_award": "awards",
    "same_series": "series",
    "same_based_on": "based_on",
}

# same_award is restricted to these 10 major bodies (decided 2026-07-31) --
# Wikidata's raw awards column carries 700+ distinct values, most of them
# single-digit-movie regional/trade awards (AVN, AACTA International, a
# Danish screenplay guild, etc.) that are too obscure to read as "these two
# movies are meaningfully connected." Prefixes/substrings below, checked
# against the exact raw award string (see films_enrich.py):
#   - startswith("Academy Award") or endswith("Academy Award") -- the
#     endswith half catches "Special Achievement Academy Award", which
#     doesn't start with the phrase. Deliberately does NOT match on
#     "Academy Award" as a bare substring, which would also catch e.g.
#     "Polish Academy Award for Best Editing" (a different, national body).
#   - "cannes" as a case-insensitive substring, not just an exact-name
#     prefix, since two legitimate Cannes-associated prizes (the FIPRESCI
#     critics' prize and the Ecumenical Jury prize) aren't named
#     "Cannes Film Festival Award for ..." -- they still are Cannes prizes.
#   - Golden Globe is startswith("Golden Globe Award") specifically, not
#     "Golden Globe" -- "Golden Globe (Portugal) for Best Film" is an
#     unrelated Portuguese award that happens to share the English name.
#   - Writers Guild is startswith("Writers Guild of America") specifically,
#     not "Writers Guild" -- excludes "Danish Writers Guild Best Screenplay
#     Award," a different national guild, not the WGA the ask meant.
# Verified against the real shipped connections.json.gz (2026-07-31): 129
# of 712 raw award values survive this filter.
MAJOR_AWARD_PREFIXES = (
    "American Film Institute",
    "BAFTA",
    "British Academy Film Awards",
    "Golden Raspberry",
    "Palme d'Or",
    "Screen Actors Guild",
    "Sundance",
    "Writers Guild of America",
)


def is_major_award(name):
    if name.startswith("Academy Award") or name.endswith("Academy Award"):
        return True
    if "cannes" in name.lower():
        return True
    if name.startswith("Golden Globe Award"):
        return True
    return name.startswith(MAJOR_AWARD_PREFIXES)


# US-relevance filter (decided 2026-07-31): too many non-US films were
# obscure to US players. A non-US movie is dropped from the shipped game
# entirely unless it has a real connection to a US movie or won a major
# award on its own merits -- US movies are always kept.
#
# "Real connection" means via one of these types specifically, mirroring
# round_selector.py's/movieLadder.ts's ACTIVE_CONNECTION_TYPES (duplicated
# here rather than imported -- this script doesn't otherwise depend on
# those modules and shouldn't start to just for this). same_country itself
# deliberately does NOT count: it isn't an active gameplay connection type
# (see the module docstring's same_country finding), so a shared-country
# link couldn't actually surface as a decoy-beating connection in a real
# round anyway -- it wouldn't be a genuine rescue from obscurity.
US_RELEVANCE_CONNECTION_TYPES = {
    "same_director",
    "shared_cast_member",
    "same_screenwriter",
    "same_composer",
    "same_award",
    "same_series",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", default="connections.json")
    ap.add_argument("--min-group-size", type=int, default=2)
    ap.add_argument("--max-group-size", type=int, default=400,
                     help="Groups larger than this (e.g. same_country=United States) are "
                          "capped by sampling, so one mega-category doesn't dominate every round.")
    ap.add_argument("--no-gzip", action="store_true", help="Skip writing the .gz companion file")
    ap.add_argument("--pretty", action="store_true", help="Indent the JSON (bigger file, for debugging only)")
    args = ap.parse_args()

    movies = {}  # movie_id (string, internal only = wikidata_id) -> metadata
    groups = defaultdict(lambda: defaultdict(set))

    with open(args.csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            movie_id = row["wikidata_id"]
            title = row["title"]
            year = row.get("year", "")

            sitelinks = row.get("sitelinks", "")
            movies[movie_id] = {
                "title": title,
                "year": int(year) if year else None,
                "wikidata_id": movie_id,
                "imdb_id": row.get("imdb_id") or None,
                # Wikipedia sitelink count, carried through from films_enrich.py
                # as a recognizability/popularity proxy. Shipped so the game can
                # offer a difficulty mode that restricts the pool to
                # better-known films (CLAUDE.md section 5c) -- the dataset's
                # median is ~20, so roughly half of it is genuinely obscure and
                # unplayable-by-reasoning for a typical player. Not a connection
                # type and never groups anything; purely a per-movie attribute.
                "sitelinks": int(sitelinks) if sitelinks else 0,
            }

            for conn_type, column in MULTI_VALUE_CONNECTIONS.items():
                for value in split_multi(row.get(column, "")):
                    if conn_type == "same_award" and not is_major_award(value):
                        continue
                    add(groups, conn_type, value, movie_id)

            if year:
                add(groups, "same_release_year", year, movie_id)

    # shared title words (only for titles that aren't exact matches)
    word_groups = defaultdict(set)
    for movie_id, m in movies.items():
        for w in title_words(m["title"]):
            word_groups[w].add(movie_id)
    groups["shared_title_word"] = {w: ids for w, ids in word_groups.items() if len(ids) >= 2}

    # --- US-relevance filter ----------------------------------------------
    # See US_RELEVANCE_CONNECTION_TYPES above for the rule. same_country's
    # "United States" group (built normally above, same as any other
    # country) is reused directly as the US-movie set rather than
    # re-deriving it from the raw CSV a second time.
    us_ids = set(groups.get("same_country", {}).get("United States", set()))
    connects_to_us = set()
    for conn_type in US_RELEVANCE_CONNECTION_TYPES:
        for id_set in groups.get(conn_type, {}).values():
            if id_set & us_ids:
                connects_to_us |= id_set
    # same_award's groups were already restricted to major-award values
    # when built above, so membership in any of them -- regardless of that
    # group's size -- means "won a major award," independent of whether the
    # connection itself survives min-group-size later.
    award_winner_ids = set()
    for id_set in groups.get("same_award", {}).values():
        award_winner_ids |= id_set

    keep_ids = us_ids | connects_to_us | award_winner_ids
    dropped_ids = set(movies.keys()) - keep_ids
    for valmap in groups.values():
        for value, id_set in valmap.items():
            valmap[value] = id_set & keep_ids

    # --- assign compact integer IDs -------------------------------------
    # Position in this list IS the movie's ID everywhere else in the file.
    # Only movies that appear in at least one surviving connection group are
    # worth keeping -- anything with zero shared traits can't be used as a
    # ladder rung anyway.
    referenced = set()
    for valmap in groups.values():
        for id_set in valmap.values():
            if len(id_set) >= args.min_group_size:
                referenced |= id_set

    ordered_movie_ids = sorted(referenced)  # stable order -> stable IDs across runs
    id_index = {mid: i for i, mid in enumerate(ordered_movie_ids)}

    movies_array = []
    for mid in ordered_movie_ids:
        m = movies[mid]
        movies_array.append([m["title"], m["year"], m["wikidata_id"], m["imdb_id"],
                             m["sitelinks"]])
    # movies_array columns, in order: [title, year, wikidata_id, imdb_id, sitelinks]
    # NOTE: sitelinks was appended LAST deliberately (2026-08-08) so existing
    # positional readers of the first four fields keep working unchanged, and
    # so adding it doesn't renumber any movie -- IDs are positions in this
    # array, and the array's membership/order is decided by ordered_movie_ids
    # above, which this column has no effect on. That matters because a saved
    # game stores movie IDs (see App.tsx's SAVE_KEY): appending a field is
    # save-compatible, whereas inserting one mid-tuple or changing which
    # movies are referenced would not be.

    # finalize: drop groups below min size, cap oversized groups, remap to int IDs
    final = {}
    stats = {}
    import random
    random.seed(42)
    for conn_type, valmap in groups.items():
        out = {}
        largest_pre_cap = 0
        for key, id_set in valmap.items():
            if len(id_set) < args.min_group_size:
                continue
            largest_pre_cap = max(largest_pre_cap, len(id_set))
            ids = sorted(id_set)
            if len(ids) > args.max_group_size:
                ids = random.sample(ids, args.max_group_size)
            out[key] = [id_index[mid] for mid in ids]
        if out:
            final[conn_type] = out
            group_sizes = [len(v) for v in out.values()]
            stats[conn_type] = {
                "num_groups": len(out),
                "total_movies_involved": len(set().union(*[set(v) for v in out.values()])),
                "avg_group_size": round(sum(group_sizes) / len(group_sizes), 1),
                "largest_group": max(group_sizes),
                "largest_group_pre_cap": largest_pre_cap,
            }

    result = {
        "movie_fields": ["title", "year", "wikidata_id", "imdb_id", "sitelinks"],
        "movies": movies_array,
        "connections": final,
    }

    dump_kwargs = {"indent": 1} if args.pretty else {"separators": (",", ":")}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, **dump_kwargs)

    plain_size = os.path.getsize(args.out)
    gz_size = None
    if not args.no_gzip:
        gz_path = args.out + ".gz"
        with open(args.out, "rb") as fin, gzip.open(gz_path, "wb", compresslevel=9) as fout:
            fout.write(fin.read())
        gz_size = os.path.getsize(gz_path)

    print(f"Wrote {args.out}  ({plain_size/1e6:.2f} MB)")
    if gz_size:
        print(f"Wrote {gz_path}  ({gz_size/1e6:.2f} MB gzipped, {plain_size/max(gz_size,1):.1f}x smaller) <- serve this one")
    print(f"\nUS-relevance filter: dropped {len(dropped_ids)} non-US movies with no "
          f"connection to a US movie and no major award "
          f"({len(keep_ids)}/{len(movies)} kept, {len(keep_ids)/len(movies):.1%})")
    print(f"\n{len(movies_array)} movies referenced by at least one connection "
          f"(of {len(movies)} total unique movies in the CSV), {len(final)} connection types\n")
    print(f"{'connection_type':<24}{'groups':>8}{'movies covered':>16}{'avg size':>10}{'max size':>10}")
    for conn_type, s in sorted(stats.items(), key=lambda x: -x[1]["total_movies_involved"]):
        print(f"{conn_type:<24}{s['num_groups']:>8}{s['total_movies_involved']:>16}{s['avg_group_size']:>10}{s['largest_group']:>10}")

    # Sitelink (recognizability) distribution of the shipped pool, so the
    # difficulty-mode thresholds can be picked/sanity-checked at build time
    # rather than needing a separate ad-hoc script. See CLAUDE.md section 5c.
    shipped_sitelinks = sorted(m[4] for m in movies_array)
    n_shipped = len(shipped_sitelinks)
    if n_shipped:
        print(f"\nsitelinks (recognizability proxy) across the {n_shipped} shipped movies:")
        pct_line = "  " + "  ".join(
            f"p{p}={shipped_sitelinks[min(int(n_shipped * p / 100), n_shipped - 1)]}"
            for p in (10, 25, 50, 75, 90, 99))
        print(pct_line + f"  max={shipped_sitelinks[-1]}")
        for t in (25, 30, 40):
            c = sum(1 for v in shipped_sitelinks if v >= t)
            print(f"  >= {t} sitelinks: {c} movies ({c / n_shipped:.1%}) "
                  f"-- candidate 'easy mode' pool")

    # Flag any connection type whose largest single group covers a huge slice
    # of the dataset -- same class of risk documented for genre in CLAUDE.md
    # section 6 (a group so common it's true for most film pairs undermines
    # the "decoy has zero connections" guarantee). Not auto-excluded, just
    # surfaced -- same_country is the known case (see module docstring).
    n_movies = len(movies_array)
    for conn_type, s in stats.items():
        pre_cap = s["largest_group_pre_cap"]
        if pre_cap / n_movies > 0.10:
            print(f"\nWARNING: {conn_type}'s largest group covers "
                  f"{pre_cap}/{n_movies} movies ({pre_cap/n_movies:.1%}) "
                  f"before the --max-group-size cap (capped to {min(pre_cap, args.max_group_size)} "
                  f"in the shipped file, but the cap doesn't change how many movies REGISTER as "
                  f"sharing this trait, only how many are sampled into one group's edge list). "
                  f"Any two films with this value will 'connect', which weakens the decoy "
                  f"guarantee for them -- the same risk class documented for genre in CLAUDE.md "
                  f"section 6. Worth deciding whether to keep, cap harder, or drop, same as genre was.")


if __name__ == "__main__":
    main()
