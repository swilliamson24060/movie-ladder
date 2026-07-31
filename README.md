# Movie chart-ladder: data pipeline

Same architecture as the music version, sourced entirely from **Wikidata (CC0)**
so there's no commercial-use restriction if this becomes a paid product.

## Why Wikidata and not IMDb/TMDB/OMDb

| Source | Commercial use |
|---|---|
| **Wikidata** | CC0 — unrestricted. **Use this.** |
| IMDb datasets | Personal/non-commercial only; terms specifically prohibit building a movie database |
| OMDb | CC BY-NC 4.0 — non-commercial only |
| TMDB | No commercial use under default license (paid licenses available: sales@themoviedb.org) |
| MovieLens | Requires written permission from U. Minnesota for revenue-bearing use |

## Scope

Wikidata holds ~295,800 films with release dates (1900–2026), but the vast
majority are obscure regional and direct-to-video titles. Filtering by
Wikipedia sitelink count (how many language editions have an article) as a
recognizability proxy:

| Decade | All films | 15+ sitelinks |
|---|---|---|
| 1950s | 16,058 | 747 |
| 1960s | 20,340 | 951 |
| 1970s | 25,063 | 1,049 |
| 1980s | 28,083 | 1,497 |
| 1990s | 27,143 | 1,920 |
| 2000s | 42,070 | 2,900 |
| 2010s | 61,413 | 3,167 |
| 2020s (partial) | 26,134 | 1,307 |

Default scope is **1950–2026 at 12+ sitelinks** → roughly 15,000 films
(the music game has 32,649 songs for comparison). Raise `--min-sitelinks`
for a smaller, more famous set; lower it for more coverage.

Note the modern skew: the 2000s and 2010s are ~40% of recognizable films.
If players pick a decade, pre-1950 coverage is too thin to support it —
either start at 1950 or bucket everything earlier as a single "Classic Era."

## Usage

```
pip install requests

python3 films_enrich.py --dry-run            # print the queries, no requests
python3 films_enrich.py --test-year 1994     # one year end-to-end, prints samples
python3 films_enrich.py                      # full run, 1950-2026
```

Writes `films.csv`. Resumable — cached in `cache_films/`, so re-running
picks up where it left off. Prints a per-column coverage report at the end
so you can see which connection types will actually be usable.

## Why the queries are split up

Wikidata's query service **times out** if you request all film properties in
one query — a single-year query with 11 OPTIONAL blocks returns "upstream
request timeout" (verified). Each OPTIONAL multiplies intermediate rows, and
cast alone can be 120+ people per film.

So: one light seed query per year gets the film list, then properties are
fetched in small groups (~5 queries per 80-film batch) using explicit QIDs
in a VALUES clause. Those return instantly.

## Cast notability filtering

Wikidata lists every credited and uncredited extra. Raw P161 for Forrest
Gump returns 120+ names including bit players nobody has heard of — a
"shared cast member" connection built on those is unplayable. The script
filters cast members by their *own* sitelink count (default 15+), which cuts
Forrest Gump to 20 recognizable names.

Remaining caveat: archive-footage appearances survive the filter (Forrest
Gump still lists John Lennon and Gerald Ford). See the script docstring for
the optional occupation filter that removes them, and its trade-off.

## Connection types this supports

Directly from `films.csv`: same director, shared cast member, same
screenwriter, same composer, same production company, same country, same
award, same franchise/series, same source material (`based_on`), same
release year, shared title word.

**Same award is restricted to 10 major bodies** (decided 2026-07-31):
Academy Awards, American Film Institute, BAFTA/British Academy Film
Awards, Cannes, Golden Globe, Golden Raspberry, Palme d'Or, Screen Actors
Guild, Sundance, and Writers Guild of America. Wikidata's raw awards field
carries 700+ distinct values, most single-digit-movie regional or trade
awards (AVN, AACTA International, a Danish screenwriting guild, etc.) too
obscure to read as a meaningful "these movies connect" moment. See
`connections_generator.py`'s `is_major_award()` for the exact matching
rules (a few name collisions with unrelated same-named regional awards —
e.g. a Portuguese "Golden Globe" and a Polish "Academy Award" — are
explicitly excluded).

Genre was considered and **dropped** — Wikidata's genre tagging is too
broad to reliably build decoys against (see the "Genre tags may be too
broad" finding in `CLAUDE.md` section 6). Films routinely carry a dozen-plus
genre tags including generic catch-alls like `drama film` and `comedy
film`, so two otherwise-unrelated substantial films frequently share at
least one anyway, undermining the "a decoy has zero valid connections"
premise the game depends on.

The cast graph is the movie equivalent of the music game's collaboration
graph — richest and least repetitive, and it chains naturally (actor A was
in a film with actor B, who was in a film with C). Essentially Six Degrees
of Kevin Bacon, which is a proven mechanic.

## Reusing the rest of the pipeline

`connections_generator.py` from the music game is close to domain-agnostic —
point it at `films.csv` and update the column names it reads (the grouping,
integer-ID compaction, and gzip output all carry over unchanged).
`round_selector.py` needs only new tile definitions in `TILE_DEFS`.

No box-office-based connection is included: Wikidata's P2142 coverage is
patchy, and comprehensive box office data lives behind Box Office Mojo
(IMDb-owned, restricted).
