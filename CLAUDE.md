# Chart Ladder / Movie Ladder — project memory

Working notes for two related connection-chain games. Written to be read cold
by a person or by Claude picking this up in a new session.

Last updated: 2026-07-31

---

## 1. What the games are

**Chart Ladder (music)** — the player is shown a song and picks the
*connection type* linking it to the next song in a chain. The player chooses
the **year** themselves, so year is deliberately NOT a connection type
(that would be circular). Status: data pipeline complete, pushed to GitHub.

**Movie Ladder (films)** — a deliberately different mechanic from chart-
ladder, not a straight reskin: the player is shown 3 candidate movies and
picks the one that connects to the movie on top of their stack *somehow* —
they never pick or name a connection type, they just need to spot that a
connection exists. See section 5b for the full design (strikes, scoring,
betting). Status: data pipeline complete (`films.csv`, 17,009 films,
1950–2026, verified). Game design fully decided. Not yet implemented —
`connections_generator.py`/`round_selector.py` haven't been adapted for
films, and there's no app scaffold yet (decided 2026-07-30: movie-ladder
gets its own separate app project, not a package inside chart-ladder's
monorepo — no shared engine code between the two games).

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
composer, production company, country, award, franchise/series, source
material, release year, shared title word. Genre was **dropped** — see the
"Genre tags may be too broad" finding in section 6.

---

## 5b. Game design — Movie Ladder (strikes/scoring rework)

Decided across a Cowork design conversation, 2026-07-29 to 2026-07-30, not
yet implemented. This is the authoritative spec — if `TUTORIAL_FLOW.md` or
anything else disagrees, this section wins (they should already agree as of
2026-07-30).

**Core loop.** Player starts on one random movie already placed. Each round
shows 3 candidate movies: exactly one has a valid connection to the movie
on top of the stack (via *any* connection type — director, cast, award,
etc.), the other two have *zero* connections to it by any type. **The
player is never asked to pick or name a connection type** — correctness is
just "does a connection exist," full stop. This is a deliberate departure
from chart-ladder, which does have a separate connection-naming bonus step
(see `TutorialModal.tsx`/`HowToPlayModal.tsx`) — movie-ladder drops that
entirely.

**Every pick shows a modal, minimum 5 seconds, dismiss by tap only after
that** (not a hard auto-dismiss, not instantly skippable — chart-ladder's
modals have no minimum-display precedent, this is new UX for this game).
- Correct → modal lists **every** connection type that applies between the
  two movies, not just one, even if several match (e.g. same director AND
  same cast member both showing at once).
- Wrong → **the correct candidate is placed on the ladder regardless** —
  the chain always advances, right or wrong. Strikes are a fully separate
  life total, decoupled from progression; a strikeout only ends the run, it
  never blocks mid-run progress. (Chart-ladder's `MissedTileModal` already
  works this way — "It has been placed on the path automatically" — so
  this part isn't new, just confirmed.) The wrong-pick modal states the
  miss, the strike count, and the correct answer with all its matching
  connections.

**Run structure: open-ended, not a bounded path.** Unlike chart-ladder's
actual shipped structure (a fixed-length START→ANCHOR path per round,
chainable into a multi-path "session"), movie-ladder has no fixed endpoint
— the player just keeps stacking movies until they run out of strikes.
Confirmed deliberately, twice, in conversation — not an oversight to
reconcile with chart-ladder later.

**Strikes: 5, not 3.** (Changed 2026-07-30 from an initial 3 — matches
chart-ladder's own limit, "Five wrong tiles ends a real session.") 5
strikes ends the run: hard game over (no continue/ad-based resume) → check
score against the leaderboard → offer "view full connection chain" (reuse
chart-ladder's `ConnectionChainModal` pattern) → offer "start new game."

**Milestone scroll-off, every 5 correct tiles.** Land 5 correct picks in a
row *without a strike breaking the group* and the stack scrolls off-screen,
leaving only the top tile to keep building from. Scoring:
- +1 point per correct tile (always, strike or no strike in that group)
- **+5 points** for completing a group of 5
- **+10 points more** if that specific group of 5 had zero strikes in it

A strike inside a group doesn't block finishing the group, it just forfeits
that group's +10.

**Betting, decided 2026-07-30.** Offered once per group of 5, right at the
checkpoint after a group scrolls off — not available every round, not
unlimited. It's a bet on the player's very next pick, staked against a
strike:
- **Win** → bonus payout = **10x that round's normal point value** (i.e.
  the tile that would've earned +1 point earns +10 instead). Picked as a
  concrete default so this is implementable, not because it's playtested —
  revisit if it feels off in practice.
- **Lose** → that miss costs **2 strikes instead of 1**.
- Betting is allowed even at 2 strikes already (where a loss guarantees
  game over) — decided as an intentional high-drama all-in moment, not
  blocked. No special-case code needed for that scenario.

**Betting — implemented 2026-07-30/31.** The spec above was decided but
unbuilt; the following implementation-level questions weren't covered by
it and were resolved via an `AskUserQuestion` interview immediately before
building (`app/App.tsx`, commit `77c6c5a`):
- **Frequency:** skip the bet offer after the very first floor
  (`FLOORS_BEFORE_BETTING = 1` — offer starts from floor 2 onward), so a
  new player gets one clean, stakes-free floor before betting shows up.
  Not a number the original spec fixed either way.
- **Presentation:** the offer is its own screen — a separate `betOffer`
  state, shown *after* the milestone banner's slide-down finishes and
  *before* the next round builds — rather than folding BET/NO THANKS
  buttons into the milestone banner itself or the first candidate round.
- **Visual marking:** a bet round is visibly distinct while in progress —
  gold cell borders on all 3 candidates (`MovieCell`'s new `'bet'`
  `CellState`, `colors.yellow`) plus a `💰 BET ROUND` banner above the
  candidates — so the raised stakes are never a surprise at result time.
- **High-strikes confirmation:** no extra confirmation step for accepting
  a bet at 2+ strikes, even though a loss there guarantees game over —
  matches the original spec's "no special-case code" call, reconfirmed
  rather than revisited.

Scoring/strikes mechanics as shipped: win pays `BET_WIN_MULTIPLIER = 10`
points on that one pick (instead of the usual +1); loss costs
`BET_LOSE_STRIKES = 2` strikes (instead of the usual 1), clamped to
`MAX_STRIKES` so the strike counter never displays past 5/5. The result
modal calls out both outcomes explicitly ("— bet won!" / "(bet lost — 2
strikes)"), and `isBetRound` resets the instant that one staked pick
resolves, win or lose — a bet never carries over to a second pick.

**Bug found and fixed during verification:** `continueAfterMilestone()`
originally decided whether to offer a bet by reading `floorsCompleted`
from React state *inside* `Animated.timing(...).start(callback)`'s
completion handler. On web, `useNativeDriver: true` silently falls back
to a JS/rAF-driven animation, and state updates made from within that
callback were observed to not reliably take effect (confirmed via a
temporary `window.__continueAfterMilestone`/`__state` debug hook: the
callback demonstrably ran, but `setBetOffer(true)`/`setMilestone(false)`
calls inside it didn't change subsequent renders). Fix: the
`floorsCompleted > FLOORS_BEFORE_BETTING` decision is now computed
synchronously, in direct response to the tap, *before*
`Animated.timing(...).start(...)` is even called, and captured in a
plain local (`offerBet`) that the callback just reads — sidesteps the
unreliable-setState-in-callback issue rather than root-causing it
further. Worth remembering if another delayed `Animated` callback in this
app ever needs to make a state-dependent decision.

**Decoy-selection requirement (the actual engineering delta from chart-
ladder).** `round_selector.py`'s current `ChartLadder.build_round()` picks
3 *tile-type* labels and lets the engine silently choose the next song —
that model doesn't fit movie-ladder. The new logic needs to pick 3
*candidate movies* where the correct one has ≥1 connection (any type) to
the current movie, and both decoys have connections checked against **all**
connection types the current movie participates in — not just the type
"being tested," since there is no single type being tested anymore. This is
new logic, not a config change.

**Genre is not a connection type for films** — see section 6's "Genre tags
may be too broad" finding. Doesn't apply to music.

**Active vs. schema-only connection types (decided 2026-07-30, revised
2026-07-30):** `connections_generator.py` produces 11 connection types
from `films.csv` (see section 9), but the game only uses 6 of them to
build chains/decoys: `same_director`, `shared_cast_member`,
`same_screenwriter`, `same_composer`, `same_award`, `same_series`.
`same_company`, `same_country`, `same_based_on`, `shared_title_word`, and
**`same_release_year`** stay in `connections.json`'s schema (still
generated, still shipped) but are excluded from `round_selector.py`'s
`ACTIVE_CONNECTION_TYPES` / `movieLadder.ts`'s equivalent set, so they
never count toward "these two movies are connected" and never appear in
the "explain" modal. `same_country` was already flagged as a broadness
risk (section 9); `same_company`/`same_based_on`/`shared_title_word` were
judged too weak a signal for a satisfying "aha, they connect" moment.
**`same_release_year` was removed later** (not part of the original
2026-07-30 decision) because the year is printed directly on every
candidate tile (`MovieCell`'s `year` prop) — an active connection type the
UI already displays isn't a hidden connection for the player to spot, it's
just reading a number off the screen, the same class of problem chart-
ladder already solved once by removing performer names from its own
selection tiles (section 11, commit `572d3ae`). Verified impact: movies
with zero remaining active connection to anything else go from 4 (0.02%)
to 275 (1.6%) of the 17,009-film dataset — those become unreachable as a
chain node. Small but real; not addressed since nothing was asked beyond
removing the type. Re-verified against `TUTORIAL_FLOW.md`'s scripted
example after both changes: Pulp Fiction → Kill Bill Vol. 1 still connects
via director/cast/screenwriter, Kill Bill Vol. 1 → Vol. 2 still connects
via director/cast/screenwriter/series, and both decoy pairs remain at zero
connections — no tutorial changes were needed either time.

**Tutorial:** full phase-by-phase script (with real, hand-verified example
movies) is in `TUTORIAL_FLOW.md`. Implemented (see section 9's punch
list) and since extended twice, 2026-07-31: the 5-second minimum delay on
the explain modals was removed (pure friction, no upside), and the
`betting` phase — originally a static explainer, since betting depended
on a real checkpoint the scripted 2-round tutorial didn't reach — was
replaced with a 4-phase live demo (`betting-intro`/`betting-offer`/
`betting-round`/`betting-win`) continuing the scripted Tarantino chain
past Kill Bill Vol. 2 into a real, verified bet-round win against Jackie
Brown. `TUTORIAL_FLOW.md` was updated to match both changes.

**App architecture, decided 2026-07-30:** movie-ladder gets its own
separate app project inside this repo, not a new package in chart-ladder's
monorepo. No shared engine/leaderboard/theme code between the two games —
anything reused will need to be ported/duplicated, not imported.

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

**A middlebox on at least one user's network hard-truncates HTTPS responses
at exactly 98,304 bytes (96×1024).** Discovered running the full
`films_enrich.py` 1950–2026 run: seed-query responses for some years failed
with `json.JSONDecodeError` ("Unterminated string...") at the identical byte
offset on every retry, across different years/content. Ruled out the
obvious suspect (the machine's old LibreSSL + urllib3 v2, flagged by a
`NotOpenSSLWarning`) by downgrading `urllib3<2` — the exact same truncation
persisted, which points to something on the network path (TLS-inspecting
security software or a proxy) capping response bodies, not a library bug.
**Fix:** don't fight it, stay under it — `build_seed_query` now takes
`limit`/`offset` and `seed_films` pages each year in chunks of
`SEED_PAGE_SIZE = 120` (with `ORDER BY ?film` for stable pagination), and
`BATCH_SIZE` for property-group queries was lowered from 80 to 50. Also
made `sparql_query`/`seed_films`/`enrich_group` resilient generally: a
year or batch that still fails after retries is skipped (not fatal) and
reported in a summary at the end with the exact command to backfill it,
instead of taking down an hours-long run.

**Films with multiple qualifying release dates can land in the wrong year
if you're not careful merging per-year caches.** Some films have more than
one Wikidata P577 date (e.g. a festival premiere and a separate wide
release, sometimes straddling a calendar year boundary) — Wikidata will
return that film under *every* year whose query it satisfies. Confirmed on
the real dataset: 169 of the 329 films originally seeded under 1994 also
matched 1993 or 1995. The original merge (`dict.update()` over
`cache.items()`) let whichever year happened to be iterated last silently
win, which depended on cache insertion order across runs — arbitrary and
not reproducible. **Fix:** `seed_films`'s merge now explicitly keeps the
**earliest** qualifying year per film, deterministically, regardless of
cache/run history. No films were lost either way (unique QID count was
unchanged, 17,009 rows) — this was strictly a mislabeling bug, but it would
have made per-year/per-decade game logic subtly wrong.

**Genre tags may be too broad to build clean decoys against.** Discovered
while hand-drafting `TUTORIAL_FLOW.md`'s example: Pulp Fiction alone carries
15 Wikidata genre tags, several generic (`drama film`, `comedy film`,
`action film`, `crime film`). Three straightforward decoy candidates —
The Shawshank Redemption, Home Alone, The Sound of Music — all failed
because they turned out to share at least one broad genre tag with Pulp
Fiction; it took filtering all ~17,000 films programmatically to find two
that shared nothing (Harry Potter and the Philosopher's Stone, Guardians of
the Galaxy). For any well-tagged, prestige, or multi-genre film,
`same_genre` may end up almost always true against other substantial
films — a real risk to the "decoy must have zero valid connections"
design (see project memory `movie-ladder-strikes-design`). **Resolved
2026-07-30: genre dropped entirely as a film connection type**, rather than
down-weighted — simpler, and avoids having to define/maintain a "how common
is too common" threshold. `connections_generator.py` should not produce a
`same_genre` (or equivalent) bucket for films when it's adapted. Contrast
with music, where `same_song_genre`/`same_artist_genre` are shipped and
working fine — song genre tagging didn't show this problem, so this
decision is films-only, not a reason to revisit the music side.

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

**Movie Ladder — updated 2026-07-30, this is the current punch list:**
- [x] Run full `films_enrich.py` 1950–2026 — done, 17,009 films, verified,
  two data bugs found and fixed (see section 6).
- [x] Game design (strikes, scoring, betting, tutorial flow, run
  structure, decoy rules) — fully decided, see section 5b and
  `TUTORIAL_FLOW.md`.
- [x] Adapt `connections_generator.py` for `films.csv`: remapped to the
  films schema, produces `same_director`, `shared_cast_member`,
  `same_screenwriter`, `same_composer`, `same_company`, `same_country`,
  `same_award`, `same_series`, `same_based_on`, `same_release_year`,
  `shared_title_word`. Genre excluded entirely, per the decided constraint.
  Output: `data/connections.json` (2.68MB) / `.gz` (1.17MB), 17,009 movies,
  11 connection types. **New finding, not yet resolved:** `same_country`'s
  largest pre-cap group ("United States") covers 59.4% of all films — the
  same risk class as the genre finding below. The existing `--max-group-size`
  cap (400, inherited from the music generator) happens to blunt this in
  practice: oversized groups are randomly sampled down to 400 members before
  shipping, so only ~400 of the 10,106 US films actually retain a
  `same_country` edge to each other in the shipped file (verified: Kill Bill
  Vol. 1 and Home Alone are both tagged `United States` in the raw CSV but
  neither ended up in the sampled group, so `same_country` correctly reports
  zero connection between them). Net effect: the *practical* same-pair match
  rate is much lower than the raw 59.4% share suggests, but it's an
  accidental mitigation via sampling, not a designed one — worth deciding
  explicitly (keep as-is, cap harder, or drop like genre) rather than
  relying on the coincidence. The generator prints this as a WARNING at
  build time (see its "Flag any connection type..." block) for any type
  whose pre-cap largest group exceeds 10% of the dataset — currently only
  `same_country` trips it.
- [x] Write the new decoy-selection logic described in section 5b —
  `scripts/round_selector.py` was fully rewritten (not tile-based): given a
  movie, `connected_ids()` unions every movie sharing any connection
  type/value with it; `build_round()` picks 1 correct (in that set) + 2
  decoys (verified absent from it); `connections_between()` returns every
  matching type for the "explain" modal. Verified against the real dataset
  against `TUTORIAL_FLOW.md`'s scripted example (see below).
- [x] Scaffold the actual app — `app/` is a standalone Expo (SDK 57,
  TypeScript) project, own `package.json`, no workspace/monorepo tie to
  chart-ladder, no shared engine code (`app/src/movieLadder.ts` is a
  from-scratch TS port of `round_selector.py`, not an import). Verified
  running in-browser: loads `data/connections.json`, builds real rounds,
  both correct and wrong picks advance the ladder correctly.
- [x] Implement the tutorial from `TUTORIAL_FLOW.md` as a real component —
  `app/src/TutorialScreen.tsx` + `app/src/tutorial.ts`, all 9 phases,
  5-second-minimum explain modals (disabled button until elapsed), SKIP,
  scripted Pulp Fiction → Kill Bill Vol. 1 → Kill Bill Vol. 2 walkthrough,
  dynamic connection-match text (queries the real engine rather than
  hardcoding the modal copy, so it can't drift from the shipped data).
  Verified phase-by-phase in-browser, including the 5s modal timing and the
  final chain-review + handoff to the post-tutorial screen.
  **Data bug found and fixed while verifying:** `TUTORIAL_FLOW.md`'s
  original `pick-wrong` decoy pair (Kill Bill Vol. 1 vs. The Lord of the
  Rings: The Return of the King) is invalid now that `same_release_year` is
  a real connection type — both released in 2003, verified against the
  live dataset (`connections_between` returns `{same_release_year:
  ['2003']}`). That table was only checked against
  director/cast/screenwriter/composer/company/award when it was written,
  before release-year/series/based_on/country existed as types. Substituted
  **Home Alone (1990)**, verified zero connections against Kill Bill Vol. 1
  across every implemented type in the shipped data. `TUTORIAL_FLOW.md`'s
  table should be updated to match (not yet done — flagging here so it
  doesn't get missed).
- [x] Scoring and strikes are now real session state in `App.tsx`
  (previously only the tutorial's static explainer copy existed): +1 point
  per correct pick, +5 for completing a 5-tile floor, +10 more on top of
  that if the floor had zero strikes, 5 strikes ends the run. A persistent
  status bar above the board shows `SCORE:` and `STRIKES: n/5` (red once
  >0) at all times; the per-pick result modal shows that pick's own point
  value plus a running strike tally on a miss; the floor-complete banner
  shows that floor's own point total, with the no-strike bonus called out
  separately when earned. Run-ending game over (5 strikes) shows final
  score and a PLAY AGAIN that fully resets state -- added as the minimum
  needed for the strike counter to be coherent (tracking a countdown with
  no consequence at zero would look broken), not full scope: no
  leaderboard, no "view connection chain," no betting. Verified every
  branch deliberately (see below), including the edge case where the 5th
  strike lands on the same pick that completes a floor -- the floor bonus
  still applies to the score, but the milestone banner is skipped in favor
  of going straight to game over, since there's no next round to pause
  before anyway.
  **Verification note:** correctness is genuinely random per round (no
  visual tell), so hitting both outcomes on demand needed a temporary
  `window.__round`/`window.__state` debug hook to read the live
  `correctId` and confirm state transitions precisely, rather than
  clicking blind and hoping. Removed before shipping.
- [x] Betting implemented — bet-offer screen (BET / NO THANKS) shown as
  its own step after a completed floor's slide-down (skipped for floor 1),
  gold-marked bet-round candidates, win/loss scoring and strike-clamping,
  result-modal callouts. See section 5b's "Betting — implemented" entry
  for the full implementation-level decisions (frequency, presentation,
  visual marking) and the `Animated.timing` state-update bug found and
  fixed along the way. Verified end-to-end in-browser via a temporary
  `window.__pick`/`__confirmPick`/`__state` debug hook (same pattern as
  the scoring/strikes verification above, removed before shipping):
  floor 1 → no bet offer; floor 2 and 3 → bet offer appears; NO THANKS →
  normal round; BET+win → +10 points; BET+lose → +0 points, 2 strikes;
  strikes clamp at 5/5 with no overflow; a bet loss landing on the same
  pick that completes a floor still shows the floor's bonus before going
  straight to game over. Committed as `77c6c5a`, deployed and confirmed
  live.
- [ ] The two numbers below are still not playtested with real users —
  they're implementable and testable now that betting exists (they
  weren't before), but "feels right" hasn't been evaluated against actual
  play: bet payout is 10x that round's point value; bet timing/frequency
  is once per completed 5-tile floor (skipping floor 1).

**Chart Ladder (music) — still open, not touched by the movie-ladder work:**
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
