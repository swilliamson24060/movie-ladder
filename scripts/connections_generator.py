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

            movies[movie_id] = {
                "title": title,
                "year": int(year) if year else None,
                "wikidata_id": movie_id,
                "imdb_id": row.get("imdb_id") or None,
            }

            for conn_type, column in MULTI_VALUE_CONNECTIONS.items():
                for value in split_multi(row.get(column, "")):
                    add(groups, conn_type, value, movie_id)

            if year:
                add(groups, "same_release_year", year, movie_id)

    # shared title words (only for titles that aren't exact matches)
    word_groups = defaultdict(set)
    for movie_id, m in movies.items():
        for w in title_words(m["title"]):
            word_groups[w].add(movie_id)
    groups["shared_title_word"] = {w: ids for w, ids in word_groups.items() if len(ids) >= 2}

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
        movies_array.append([m["title"], m["year"], m["wikidata_id"], m["imdb_id"]])
    # movies_array columns, in order: [title, year, wikidata_id, imdb_id]

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
        "movie_fields": ["title", "year", "wikidata_id", "imdb_id"],
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
    print(f"\n{len(movies_array)} movies referenced by at least one connection "
          f"(of {len(movies)} total unique movies in the CSV), {len(final)} connection types\n")
    print(f"{'connection_type':<24}{'groups':>8}{'movies covered':>16}{'avg size':>10}{'max size':>10}")
    for conn_type, s in sorted(stats.items(), key=lambda x: -x[1]["total_movies_involved"]):
        print(f"{conn_type:<24}{s['num_groups']:>8}{s['total_movies_involved']:>16}{s['avg_group_size']:>10}{s['largest_group']:>10}")

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
