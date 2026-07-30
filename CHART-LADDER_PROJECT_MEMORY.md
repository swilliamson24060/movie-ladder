# Chart Ladder / Movie Ladder — project memory

Working notes for two related connection-chain games. Written to be read cold
by a person or by Claude picking this up in a new session.

Last updated: 2026-07-29

---

## 1. What the games are

**Chart Ladder (music)** — the player is shown a song and picks the
*connection type* linking it to the next song in a chain. The player chooses
the **year** themselves, so year is deliberately NOT a connection type
(that would be circular). Status: data pipeline complete, pushed to GitHub.

**Movie Ladder (films)** — same mechanic for movies. Status: enrichment
script written and validated; full data run not yet done.

Possible mobile game, and **may become a paid product** — this single
constraint drove every data-source decision below.

---

## 2. Data sources and licensing (the most important decisions)

Because commercial use is possible, everything must be commercially
licensable. **Wikidata (CC0) is the backbone of both projects.**

### Music
- **Billboard Hot 100 CSV** (user-supplied): 354,500 rows, 1958–2026,
  columns `chart_week, year, month, day, current_week, title, performer,
  last_week, peak_pos, wks_on_chart`. 11,275 unique performers,
  27,009 unique titles, 32,649 unique (performer, title) songs.
- **Wikidata** for genre, label, writer, producer, awards, band membership,
  MusicBrainz ID.

### Films
Verified licensing (July 2026):

| Source | Commercial use |
|---|---|
| **Wikidata** | CC0, unrestricted — **chosen** |
| IMDb datasets | Personal/non-commercial only; terms explicitly prohibit building a movie database |
| OMDb | CC BY-NC 4.0, non-commercial only |
| TMDB | Not permitted under default license; paid licenses via sales@themoviedb.org |
| MovieLens | Needs written permission from U. Minnesota for revenue-bearing use |

Also considered: MusicBrainz (CC0 core data, free non-commercial, paid
commercial tiers), Discogs (monthly dumps are CC0), Wikipedia (CC BY-SA —
share-alike is stickier than CC0, fine for display text). Genius rejected
(prohibits scraping and commercial reuse). Spotify rejected (terms restrict
derived datasets).

Not a lawyer — worth a fresh read of terms before shipping commercially.

---

## 3. Architecture (shared by both games)

Three stages:

1. **Enrich** — pull Wikidata metadata, cache to disk, resumable.
2. **Generate connections** — group items by shared attribute.
3. **Select rounds** — game-side logic picking tiles and next items.

**Connections output shape** (important): NOT pairwise edges (which explode
combinatorially for prolific artists). Instead, each connection type maps an
attribute value → list of item IDs sharing it. The game picks a type, picks a
group with 2+ members, picks two members. Items are stored once in an array;
**array position IS the item ID**, referenced as a small integer everywhere
else.

---

## 4. Files

### Music (`~/chart-ladder`, pushed to GitHub)
- `scripts/wikidata_enrich.py` — batched SPARQL for performers + songs → `enriched_hot100.csv`
- `scripts/connections_generator.py` — CSV → `connections.json` + `.json.gz`
- `scripts/round_selector.py` — `ChartLadder` class: tiles, 1-correct/2-decoy rounds, chain building
- `scripts/README.md`
- `data/connections.json.gz` — the ~1MB file the game ships

### Films (`~/movie-ladder`)
- `scripts/films_enrich.py` — Wikidata → `films.csv`
- `README.md` (from `README_FILMS.md`)
- reuses `connections_generator.py` and `round_selector.py` (need column-name / tile-def edits)

---

## 5. Game design — current tile set (music)

Five tiles; each round shows **3** (1 correct + 2 random decoys):

| Tile | Label | Underlying connection types |
|---|---|---|
| `same_artist` | Same Artist | `same_performer` + `same_artist_identity` |
| `band_collab` | Band / Collab | `collaboration` + `band_membership` |
| `same_genre` | Same Genre | `same_song_genre` |
| `same_peak_pos` | Same Peak Chart Position | `same_peak_position` |
| `same_award` | Same Award | `same_award` |

Design history: a standalone "Collab" tile was **removed** and folded into
Band/Collab; "Same Artist" was added. A `same_year` tile was **considered and
rejected** — the player picks the year, so it can't also be a connection.

### All connection types the generator produces
CSV-only: `same_performer`, `collaboration`, `same_title`,
`same_peak_position`, `chart_longevity`, `shared_title_word`,
`one_hit_wonder_flag`.
Wikidata-dependent: `same_artist_genre`, `same_song_genre`, `same_label`,
`same_writer`, `same_producer`, `same_award`, `band_membership`,
`same_artist_identity`.

Films will support: same director, shared cast member, same screenwriter,
composer, production company, genre, country, award, franchise/series,
source material, release year, shared title word.

---

## 6. Hard-won technical findings — READ BEFORE CHANGING THINGS

**The sandbox has no general internet access.** Cowork's Linux sandbox can
reach only package registries (pypi, npm). Wikidata, MusicBrainz, Discogs are
all blocked by proxy allowlist. `web_fetch` can't render Wikidata entity pages
(JS) or parse JSON APIs. **Workaround used:** Claude-in-Chrome browser tools
run SPARQL through the user's real browser — fine for validating queries,
far too slow for bulk runs. **Bulk enrichment must run on the user's own
machine.**

**Wikidata times out on wide queries.** A single-year film query with 11
OPTIONAL blocks returns `upstream request timeout`. Each OPTIONAL multiplies
intermediate rows. **Fix:** light seed query per year, then fetch properties
in small groups against explicit QIDs in a `VALUES` clause — those return
instantly. Same lesson applies to music: avoid genre × label cartesian
products; use `GROUP_CONCAT(DISTINCT ...)` with `SAMPLE()` for scalars.

**Raw cast lists are unusable.** Wikidata P161 includes uncredited extras —
Forrest Gump has 120+ cast members. **Fix:** filter cast members by their own
sitelink count (15+) → 20 recognizable names. Residual quirk: archive-footage
appearances survive (Forrest Gump lists John Lennon and Gerald Ford). Optional
further fix: require `P106 = Q33999` (actor), at the cost of dropping actors
with incomplete occupation data.

**Collaboration false-positive bug (fixed).** The collaboration group
originally added every performer's own name, so solo artists "collaborated"
with themselves across their own songs. Inflated to 4,430 groups / 29,251
songs; correct figure is **1,660 groups / 5,997 songs**. Fix: only add
collaborators when the credit splits into 2+ names. This was briefly
mistaken for non-determinism — it isn't, it's deterministic.

**File size: integer IDs matter enormously.** Music connections.json went
14.7MB (string keys) → 2.7MB (int IDs) → **1.06MB gzipped**, a 13.9x
reduction. Ship the `.gz`. Considered and deferred: splitting by category,
bundling a popular core + streaming the tail, SQLite, backend API.

**Notability filtering is not optional for films.** Wikidata has ~295,800
films with release dates but only ~14,800 clear 15+ sitelinks. Without the
filter the game asks players to connect obscure regional titles.

**Coverage is modern-skewed (films).** 2000s + 2010s are ~40% of recognizable
films. Pre-1950 is too thin for per-decade play — start at 1950 or bucket
earlier years as one "Classic Era."

**Top-artist shortcuts don't work (music).** The top 1,000 most-charted
performers cover only ~51% of unique songs, so "just enrich the famous ones"
doesn't get far.

---

## 7. Repo state

`chart-ladder`: pushed to `main`, commit `887369f`.

Known issue: `data/enriched_hot100.csv` (65MB, confirmed: 68,374,447 bytes)
exceeded GitHub's 50MB recommendation. It pushed (under the 100MB hard limit)
but should be handled. A `.gitignore` was written to untrack
`data/enriched_hot100.csv` and `data/connections.json`, keeping only
`connections.json.gz`. **Correction (verified from the repo, 2026-07-29):**
`cache/` was never added to `.gitignore` here and no `cache/` directory
exists in chart-ladder — that detail doesn't apply to this repo (may be true
for movie-ladder, not checked). **Note:** untracking stops future growth but
the 65MB blob remains in commit history — a `git filter-repo` / BFG rewrite
would be needed to purge it, only worth doing if repo size becomes a real
problem.

`movie-ladder`: local repo created; scripts being copied in.

---

## 8. Commands

Music:
```
python3 scripts/wikidata_enrich.py --csv "Billboard Hot 100 History - hot-100-current.csv"
python3 scripts/connections_generator.py --csv enriched_hot100.csv --out data/connections.json
python3 scripts/round_selector.py data/connections.json.gz --demo 10
```

Films:
```
python3 scripts/films_enrich.py --dry-run          # print queries, no requests
python3 scripts/films_enrich.py --test-year 1994   # validate one year
python3 scripts/films_enrich.py                    # full run, 1950-2026
```

Both enrichment scripts are rate-limited (~1 req/sec) and resumable via
on-disk caches (`cache/`, `cache_films/`). Full music run takes a few hours.

---

## 9. Open items / next steps

- Run full `films_enrich.py`; check the coverage report for which film
  connection types are actually viable.
- Adapt `connections_generator.py` column names for `films.csv`, and
  `round_selector.py` `TILE_DEFS` for movie tiles.
- Wire `ChartLadder` into the actual music game code (or port the logic if
  the game isn't Python).
- Tune tile selection weights using the generator's stats table —
  down-weight high-volume categories (`same_peak_position`) relative to
  small distinctive ones (`same_award`, `band_membership`).
- Decide on mobile data delivery beyond gzip (core bundle + streamed tail
  was the recommendation).
- Consider whether to purge the 65MB CSV from chart-ladder git history.

---

## 10. Note on scope of this memory

This captures the Cowork conversation where the data pipeline was designed
and built. Work also happened in a **Claude Code terminal session** on the
same repos (file copying, commits, the push of `887369f`). That session's
details aren't fully reflected here — worth having Claude Code append its own
notes, or keeping this file in the repo so both sessions share it.

---

## 11. Claude Code terminal session notes (chart-ladder)

Added 2026-07-29 by a Claude Code terminal session working directly in
`~/chart-ladder`, in response to this file being placed in the repo. Verified
against `git log`/`git show`/the working tree rather than recalled from
context, since this session picked up after a context compaction.

### Taking delivery of the Cowork pipeline output

This session's job was to take what section 1-9 describe (scripts +
generated data produced elsewhere) and get it into the game. Two commits,
three minutes apart, on 2026-07-28:

- **`887369f`** (20:44) — copied `wikidata_enrich.py`,
  `connections_generator.py`, `round_selector.py`, `scripts/README.md`,
  and the generated `data/enriched_hot100.csv` (65MB) +
  `data/connections.json` (uncompressed) + `data/connections.json.gz` into
  the repo and committed/pushed all of it, including the 65MB CSV, to
  `origin/main`.
- **`7531d53`** (20:47) — immediately walked that back: added
  `data/enriched_hot100.csv` and `data/connections.json` to `.gitignore` and
  `git rm --cached` them, leaving only `connections.json.gz` tracked. See the
  correction on section 7 above for the exact scope of that gitignore change.

Both are on `origin/main` (confirmed via `git branch -r --contains 887369f`).
The 65MB blob is still in history per section 7's existing note - that part
was accurate and is unchanged.

### Everything after that, same session lineage, same day/next day

Continuing from `7531d53` (`git log --reverse 887369f..HEAD` is the exact
list), still 2026-07-28/29:

- `d8f6b72` Renamed the game from "Chartcross"/"Chart Cross" to **Chart
  Ladder** (header text + `app.json`, which drives the browser tab title).
- `c5b0cc6`, `c43c8fb`, `349103f`, `0b29627` — iterative game-balance tuning
  on connection-type frequency: first a hard once-per-round cap on
  `same_year`/`same_genre`, then replaced with a probabilistic per-round
  usage cap (1 use 55% / 2 uses 30% / 3 uses 15%), then (`0b29627`, this
  session's last-but-one commit) extended that cap to **every** tile key
  instead of just three of them, after the user reported 8/8 connections in
  two rounds being Band/Collab. Verified via a 500-seed-per-category stress
  script (not committed - throwaway, deleted after use) that no round now
  exceeds 3 uses of any single connection type and route-building never
  fails.
- `3c5d580` **This is the big one**: replaced the old free-play/COLLAB-
  ARTIST-SAME_YEAR guided engine (`guidedGame.ts`) with a full rewrite
  (`ladder.ts`) consuming the Wikidata connections data - this is where
  section 5's tile table (`same_artist`, `band_collab`, `same_genre`,
  `same_peak_pos`, `same_award`) actually got wired into the shipping game,
  fulfilling section 9's "Wire ChartLadder into the actual music game code"
  open item. `2ecd10c` (2026-07-28) later added a sixth tile, `weeks_on_chart`
  (backed by the `chart_longevity` connection type from section 5's "All
  connection types" list, which had been generated but unused), and excluded
  `same_peak_pos` from the "We're Number 1!" category since every song there
  already peaks at #1, making that connection trivial/meaningless.
- `fd01fdd` Fixed a CI break caused by `7531d53`'s untracking: GitHub Actions'
  `expo export` couldn't resolve `data/connections.json` since only the `.gz`
  is tracked. Added `scripts/decompress-connections.mjs` (gunzip, idempotent)
  wired into both `package.json`'s `postinstall` and an explicit step in
  `.github/workflows/deploy-pages.yml`.
- `572d3ae` Removed performer names from selection tiles (player could
  otherwise win by string-matching against the previous tile without
  understanding the connection) and added a "tap a placed tile for details"
  hint in its place.
- `8e1377d` Fixed toast messages that were interpolating the raw
  `LadderTileKey` (e.g. "weeks_on_chart") instead of the human-readable
  label.
- `493904f` Removed the Hint mechanic entirely (reveal-early-forfeit-bonus)
  since a wrong connection guess already reveals the right answer, making it
  redundant. Replaced the header's hint button with a "🔗 VIEW CONNECTION
  CHAIN" button on the round-complete screen that opens a new
  `ConnectionChainModal` reviewing the whole path on demand.
- `97768c2` Fixed two-line connection labels (e.g. "SAME PEAK POSITION")
  rendering left-aligned instead of centered in their chip.
- `6366a10` Added `ladderConnectionDetail()` to `ladder.ts` (mirrors the
  existing `ladderConnectionReason()` pattern) so the chain-review modal
  shows *what* a connection actually is - e.g. "BAND / COLLAB (Lil Tecca &
  Gunna; Lil Baby Featuring Gunna & Lil Uzi Vert)" - not just the type name.
  For `same_genre`/`same_award` this reads the dataset's group key directly
  (clean text, e.g. "pop rock", "Grammy Award for Record of the Year"); for
  the others it derives from the tiles' own fields (performer credits, peak
  position, weeks-on-chart), since those two connection types' raw group
  keys are numeric ids/UUIDs that don't read as text (see section 6's
  `same_artist_identity` note for the same underlying data shape).

### For the next session

- Section 9's "Wire `ChartLadder` into the actual music game code" is done
  (`ladder.ts` is a from-scratch TypeScript port, not a call into the Python
  `ChartLadder` class - the game isn't Python, so this followed the "or port
  the logic" branch of that open item).
- Section 9's "Tune tile selection weights ... down-weight high-volume
  categories" is substantially done via the per-round usage-cap mechanism
  above, though that's a play-time cap rather than a generation-time weight
  adjustment - worth reconciling language if both docs are read together.
- Still open, not touched by this session: the films side (section 2/9),
  purging the 65MB blob from history, and mobile data-delivery-beyond-gzip.
- `scripts/build_dataset.py` also exists in this repo (from the original
  pre-Wikidata Chartcross engine, initial commit) - unrelated to the
  Wikidata pipeline in sections 1-9, not touched by this session, mentioned
  here only so it isn't mistaken for dead weight from this work.
