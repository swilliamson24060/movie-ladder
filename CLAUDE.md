# Chart Ladder / Movie Ladder — project memory

Working notes for two related connection-chain games. Written to be read cold
by a person or by Claude picking this up in a new session.

Last updated: 2026-08-08

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

**No movie repeats within a run (bug fixed 2026-07-31).** `MovieLadder.
buildRound()` in `movieLadder.ts` always took an `exclude` set, but
`App.tsx` never passed one — every round only excluded its own current
movie, not the run's history, so the "correct" connection could
legitimately loop back to a movie already placed earlier on the ladder
(a real player report: Jonah Hex → Pathology → Jonah Hex — Pathology's
actual connections back to Jonah Hex are valid, so nothing was
malfunctioning at the connections-data level, only at the round-building
level). Fixed by threading a `history: Set<number>` through every
`buildRound()` call in `App.tsx`, growing on each correct pick and
surviving milestone clears (only `restart()` resets it) — this also
stops a repeat from ever appearing as a *decoy*, not just as the correct
pick, since `buildRound`'s exclude set already governs both. Verified via
a temporary debug hook driving 40+ rounds: zero repeats, and the live
round's candidates never overlapped the accumulated history.

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

**Scoring and betting reworked, decided 2026-08-01.** Supersedes the flat
+1/+5/+10 scoring and the single-pick 10x/2-strike betting above — both of
those numbers and the betting mechanism they described are gone from the
shipped app; this entry is the current authoritative spec. Decided via a
quick `AskUserQuestion` interview before building (same pattern as the
original betting implementation):
- **Per-tile points now escalate by floor:** floor N (1-indexed) pays
  `5*N` points per correct tile — Floor 1 = 5, Floor 2 = 10, Floor 3 = 15,
  etc. (`TILE_POINTS_PER_FLOOR = 5` in `app/App.tsx`.)
- **Floor completion bonus now escalates too:** `10*N` — Floor 1 = 10,
  Floor 2 = 20, Floor 3 = 30, etc. (`FLOOR_BONUS_PER_FLOOR = 10`.) The
  existing flat **+10 more if the floor had zero strikes** is unchanged,
  still a flat add-on on top of the escalating base (`FLOOR_NO_STRIKE_BONUS`,
  still 10).
- **Betting now stakes an entire floor, not one pick.** Win requires
  finishing that floor with **zero strikes** (the stricter of the two
  options offered in the interview — the looser option was "just complete
  the floor, strikes allowed"). Payout is that floor's completion bonus
  **doubled** — not the old 10x-single-pick multiplier. A strike
  immediately and permanently forfeits the bet for the rest of that floor
  (`isBetFloor` flips off the instant a miss happens, not just at floor
  end) so the gold "bet floor" marking never keeps advertising a bet that
  can no longer be won. **No separate strike penalty for losing anymore**
  — strikes always cost their normal 1, bet or no bet; the old "2 strikes
  instead of 1" is gone entirely, a deliberate simplification since the
  bet's downside is now just "no doubled bonus," not an added strike cost.
- Renamed `isBetRound` → `isBetFloor` throughout (state, `SavedGame`,
  `PendingResult`) to match the new scope. Added `floorHadNoStrikes`/
  `floorBetWon` state, persisted in `SavedGame`, so the milestone banner's
  message ("no strikes this floor!" / "bet won, completion bonus
  doubled!") survives a reload mid-milestone-screen.
- Updated the tutorial's copy throughout (milestone phase, betting-offer,
  betting-round banner, betting-win explanation, the explain-correct
  demo's point value) to teach the new numbers accurately. The
  betting-win demo modal no longer claims its one scripted pick "won" a
  bet, since winning now requires completing a whole floor — the tutorial
  only demos a single pick, so the copy explains the mechanic
  conceptually instead of claiming the demo fulfilled it.
- Verified in-browser via a temporary debug hook driving real picks
  across floors 1–4: every tile value (5/10/15/20) and completion bonus
  (10/20/30/40, +10 no-strike) matched the formulas exactly; a won bet
  correctly doubled Floor 3's bonus (40 → 80); a lost bet (deliberate
  miss) correctly paid no bonus, no doubling, and only the normal 1
  strike, with the gold marking turning off immediately after the miss.

**Losing a bet now costs points, decided 2026-08-08.** Supersedes the "No
separate strike penalty for losing anymore" clause in the 2026-08-01 rework
above — that made a bet nearly free upside (the only cost was a bonus you'd
already forfeited by striking), so there was rarely a reason to decline one.
A lost bet floor now takes two hits:
- **Every wrong answer on the floor subtracts double that floor's per-tile
  value** (`BET_LOSS_PENALTY_MULTIPLIER = 2`, so `2 * 5 * N` per miss).
  Every wrong answer, not just the one that broke the bet.
- **The completion bonus is forfeited outright** — not just the doubling
  and not just the flat +10, the whole `2*N*correct` too.

So a lost bet floor scores exactly `(5*N*correct) - (2*5*N*wrong)`. The two
worked examples this was specified with: floor 2 with 3 of 4 correct =
`(5*2*3) - (2*5*2)` = **10**; floor 3 with 3 of 4 = `(5*3*3) - (2*5*3)` =
**15**. Both verified against the shipped constants. Strikes still cost
their normal 1 — this is a points penalty, not a strike penalty, so the
`MIN_STRIKES_LEFT_TO_BET` gate below is unaffected.

**Implementation note worth not re-deriving:** `isBetFloor` previously
flipped to false on the first miss (to switch off the gold marking). It now
stays true for the whole floor, because a second miss still has to be
penalised and the completion bonus still has to know a bet was placed.
"Still winnable" is derived instead (`betStillWinnable = isBetFloor &&
!groupHadStrike`) and is what drives the gold marking; once the bet is lost
the board shows a red "BET LOST — WRONG ANSWERS STILL COST DOUBLE THIS
FLOOR" banner, since the player is still exposed to a cost they opted into.
No `SAVE_VERSION` bump was needed: the only new persisted field
(`floorBetLost`) is optional and cosmetic, and the changed `isBetFloor`
semantics only affect a save written mid-lost-bet-floor by the previous
build.

**Score is clamped at 0** (`Math.max(0, s - penalty)`) — not specified in
the ask, chosen because the leaderboard already rejects scores of 0 or
less, so there's nothing below zero to represent. A bad bet floor can
otherwise subtract more than the run has earned (floor 3, 0 of 4 correct,
would be −120).

**Franchise hops capped at 2 per floor (decided 2026-08-08).** Long-running
franchises are big enough to chain through end to end — the dataset's
`same_series` groups include Marvel Cinematic Universe (38 films), James
Bond (27, plus a 25-film "Eon James Bond series" subgroup), Scooby-Doo (24),
The Infinity Saga (22), DC Extended Universe (15), X-Men (14), Star Trek
(13), Batman in film (12) and Harry Potter — so a floor could in principle
become a walk through one franchise, which reads as repetitive rather than
clever. `MAX_SERIES_LINKS_PER_FLOOR = 2` in `App.tsx` caps how many of a
floor's connections may be franchise links; `groupSeriesLinks` counts them
and resets with the floor.

Implemented as a **preference, not a hard constraint**: `buildRound`'s new
`blockSeriesLinks` option filters franchise-mates out of the correct-answer
pool, but falls back to the unfiltered pool if that would leave nothing,
since refusing to build a round would end the run outright. Counted on
every resolved round regardless of whether the player was right, because
the correct movie joins the ladder either way and it's the placed chain
that would look like a marathon. All round-building now goes through one
`nextRound()` helper so the cap can't be missed at one of the five call
sites. Mirrored in `round_selector.py` (`series_mates()` +
`block_series_links`).

**Measurement correction, 2026-08-08 — the global average badly understated
this.** A first pass simulating random chains found only 0.10% (easy) /
0.07% (regular) of floors exceeding 2 franchise links, which suggested a
rare-case guardrail. That average is misleading, and a player report of
**four James Bond films on one easy-mode floor** prompted a closer look.
The real behaviour is conditional: chains rarely *enter* a franchise, but
once inside one they stick hard. In easy mode Dr. No has just 58
connections in the pool and **26 of them are other Bond films** — so each
hop out of a Bond film has a ~45% chance of landing on another Bond film
(26% averaged across the 27 Bond films in the easy pool). Easy makes this
much worse than regular: the ≥30-sitelink floor keeps all 27 Bond films
(they're all famous) while cutting the surrounding pool, and easy's
three-type list means the dense Bond cast overlap dominates. So the cap
matters far more than the global number implied. **Don't re-derive
franchise risk from a whole-dataset average — measure conditionally, from
inside a franchise.**

Verified on the regenerated data: 10,000 rounds per mode with zero
invariant failures and zero floors over the cap, and a chain starting from
a Bond film now reaches at most **3 Bond films in a floor** (the 2 allowed
connections joining them), down from the 4+ that was possible before. Note
the cap resets per floor, so a franchise can still resume on the next one.

**Curated lists and studio filmographies excluded from `same_series`
(2026-08-08).** Wikidata's P179 ("part of the series") is also used for
things that aren't franchises at all, and they were shipping as real
franchise connections: **"BBC's 100 Greatest Films of the 21st Century"**
(26 films — flagged by the user), plus studio filmographies "list of Sony
Pictures Animation productions" (13), "list of Illumination films" (6),
"list of Pixar films" and "list of Pixar shorts". Two films appearing on
the same critics' list, or coming from the same animation studio, is not a
connection a player can spot. `is_real_series()` in
`connections_generator.py` now excludes them (`NON_SERIES_PATTERNS` +
`NON_SERIES_EXACT`).

**The filter is deliberately NOT a blanket "list of" rule**, which was the
first attempt and was wrong: Wikidata expresses several *real* franchises
as list items — "list of Alien (franchise) films and television series",
"list of The Flintstones films", "list of Tom and Jerry feature films",
"list of Barbie films". Dropping those would be actively counterproductive,
because the per-floor franchise cap above relies on `same_series` to notice
a franchise chain; strip a real franchise's series link and it chains
unchecked through shared cast instead, which is exactly the failure being
fixed. So studio/critics lists are excluded and franchise lists are kept.
The generator now prints both the dropped values *and* any surviving
"list of ..." values at build time, so a future regeneration surfaces new
cases for triage rather than silently shipping a best-of list as a
franchise.

Result: 352 → 348 series groups, all real franchises intact (Bond, MCU,
Harry Potter, Alien, X-Men, Star Wars, Barbie). **This regeneration shifted
movie IDs** — one movie lost its only connection and dropped out, which
renumbered 2,085 array positions after it. Existing saved games are
therefore invalidated, but safely: `titleCheck` detects the mismatch on
load and discards the save rather than showing wrong movies (see section
9's save-game entry). Leaderboard scores are unaffected — they store names
and scores, not movie IDs.

**Betting blocked at 4 strikes, bug fix 2026-08-01.** A bet floor's miss
still costs its normal 1 strike (see the rework above -- there's no
separate bet-loss penalty anymore), which meant accepting a bet at
`MAX_STRIKES - 1` (4/5) strikes let a single miss simultaneously lose the
bet *and* end the run, in the same tap -- a player with one strike of
margin left had no way to see that coming from the bet-offer screen,
since its copy only describes the bet's own win/lose outcome, not the
run-ending strike underneath it. Fixed by gating the bet offer itself:
`continueAfterMilestone` now checks `MAX_STRIKES - strikes >=
MIN_STRIKES_LEFT_TO_BET` (2) before showing `betOffer`; when a floor
would otherwise offer a bet but the player doesn't have 2 strikes of
margin left, a new `betBlocked` screen renders instead ("CAN'T BET RIGHT
NOW" + explanation + CONTINUE), then proceeds straight into the next
floor with no bet, same as declining. New `betBlocked` state/`SavedGame`
field follows the exact same persistence pattern as `betOffer` (reset in
`restart()`, included in the autosave snapshot) so a reload mid-notice
shows the same screen rather than silently skipping it. Verified
in-browser via temporary debug hooks driving `continueAfterMilestone`
directly at the boundary: 4 strikes (1 remaining) correctly blocks with
the notice, CONTINUE from that notice correctly clears it and builds a
normal (non-bet) round; 3 strikes (2 remaining) correctly still offers
the bet normally. No changes to the win/lose resolution itself, the
per-floor scoring formulas, or `isBetFloor`'s mid-floor forfeit-on-strike
logic -- this only gates whether the offer appears at all.

**High-score submission moved to a dedicated modal, decided 2026-08-01.**
Previously the initials-entry form was inline inside the RUN OVER banner
(`milestoneBanner`). Now it's a proper `<Modal transparent
animationType="fade">` overlay (`ScoreSubmitModal` in `app/App.tsx`),
matching the existing `ResultModal`/`LeaderboardModal` pattern instead of
being a one-off inline form. Pure presentation move — no changes to
`scoreQualifies`/`wouldQualify`, the save-game persistence, or
`leaderboard.ts`'s Firestore calls. Since a blocking modal needs an
explicit dismiss path that the old inline form didn't (it just sat there
until the player scrolled past it), added a **SKIP** button
(`handleSkipScoreSubmit`) alongside SUBMIT — skipping sets the same
`scoreSubmitted` flag a real submission would, so the modal doesn't
reappear later in the run; the leaderboard itself only ever reflects a
real `submitScore()` call either way, so reusing the flag for both is
safe. The shared `modalCard`/`modalTitle`/etc. styles are left-aligned by
design (for `ResultModal`/`LeaderboardModal`'s prose); this modal's
content is short status lines plus a centered input, so it opts into
centering via new `scoreSubmitCard`/`centeredText` styles rather than
changing the shared defaults. Verified in-browser: SKIP path, SUBMIT path
(confirmed with a real Firestore write, checked against the leaderboard),
and reload-mid-modal (confirming the save-game mechanic still round-trips
correctly through the new modal architecture) all passed with no rework
needed. Deployed and reconfirmed live with a clean console on
`swilliamson24060.github.io/movie-ladder`.

**Connection-chain viewer added, 2026-08-01.** `TUTORIAL_FLOW.md`'s
closing copy and this section's original spec (line 190 above) both
described a "🔗 VIEW CONNECTION CHAIN" button (reusing chart-ladder's
`ConnectionChainModal` pattern), and the tutorial script's `done` phase
copy already said "Tap 🔗 VIEW CONNECTION CHAIN any time during a real
run" -- but no such button actually existed in `app/App.tsx`, tutorial
copy for a feature that shipped nowhere. Fixed by porting chart-ladder's
`ConnectionChainModal` (`packages/mobile/src/components/
ConnectionChainModal.tsx` in the Chartcross repo) to movie-ladder's own
data model: a new `🔗 CHAIN` header button, next to `🏆 SCORES`, opens a
`ConnectionChainModal` listing every movie placed this run, in order,
with the connection reason between each consecutive pair. Movie-ladder's
`history` state (a `Set<number>`, insertion-ordered in JS) already holds
exactly this — every movie ever placed across the *whole* run, not just
the current visible stack (which collapses to one tile at each milestone
clear) — so the modal reads `[...history]` directly rather than needing
new state. Connection reasons reuse `game.connectionsBetween()` +
`formatMatches()`, the same helpers `ResultModal` and the tutorial
already use, so a chain link's text matches the wrong-pick modal's
wording exactly. Being a header button, it's reachable during a live
run AND on the RUN OVER screen alike (same header renders in both
states) — no separate button was needed for the "review before you
restart" framing; it completes the already-documented restart flow
(RUN OVER → `PLAY AGAIN` restart, `ScoreSubmitModal` for a qualifying
score, now `🔗 CHAIN` to review the path) all being available at once,
non-blocking. Verified in-browser: opened mid-run over a live round,
closed cleanly back into it; opened on a forced RUN OVER screen
alongside a qualifying-score modal and the restart button, all three
coexisting without blocking each other; the rendered chain for a real
wrong-pick auto-advance matched the `ResultModal`'s own connection text
exactly ("Same director — Fruit Chan"). No changes to `history`,
`stack`, save-game persistence, or scoring — purely additive UI reading
existing state.

**Floor-completion bonus reworked again, decided 2026-08-01.** Supersedes
the "Floor completion bonus now escalates too: `10*N`" bullet in the
scoring/betting rework entry above — that flat `FLOOR_BONUS_PER_FLOOR`
formula is gone, replaced with `FLOOR_BONUS_PER_CORRECT_PER_FLOOR = 2`
points per correct answer that floor, still scaled by floor number:
floor N's completion bonus is `2*N` points **times how many of that
floor's picks were actually correct**, not a flat per-floor number.
Three real ambiguities resolved via `AskUserQuestion` before building
(same pattern as every prior scoring change this session):
- **Still scales by floor**, not flat everywhere — floor 2 pays 4/correct,
  floor 3 pays 6/correct, etc., preserving the "later floors pay more"
  shape from the original rework.
- **"Correct answer" means the player's own correct picks only**, not a
  flat 5 (or 4, see below) regardless of misses. A miss still gets the
  correct movie auto-placed for the player (per CLAUDE.md section 5b),
  but that auto-placed tile does NOT earn its `2*N` share — only picks
  the player got right themselves count toward the bonus.
- **The flat +10 zero-strike bonus stays**, unchanged, stacking on top of
  the new per-correct-answer bonus exactly as it did on top of the old
  flat one.
- Betting's 2x doubling (`completionBonus * 2` on a won bet) needed no
  changes — it doubles whatever `completionBonus` computes to, and that
  expression was the only thing that changed.
- New `groupCorrectCount` state (persisted in `SavedGame`, reset on floor
  completion or `restart()`) tracks correct picks in the floor currently
  being built, following the exact same lifecycle as the existing
  `groupHadStrike` boolean it sits next to. **Correction to a subtlety
  easy to get backwards:** each floor is `MAX_STACK_TILES = 5` tiles
  *total on the board*, but the first of those 5 is always the anchor
  tile already standing from before the floor started — so a floor is
  only **4 new picks**, and `groupCorrectCount` maxes out at 4 on a clean
  floor, not 5. Verified in-browser via temporary debug hooks driving
  real picks: a floor with 1 pre-existing strike and 3 correct picks paid
  a bonus of exactly 6 (`2*1*3`, floor 1, no zero-strike bonus since the
  floor had a strike); the next floor, all 4 picks correct with zero
  strikes, paid exactly 26 (`2*2*4 + 10`, floor 2) — both matched the
  formula exactly, confirming `groupCorrectCount` counts only this
  floor's own correct picks and resets correctly across floor and bet
  boundaries. Tutorial's `milestone` phase copy updated to describe the
  new per-correct-answer formula instead of the old flat `10*N` numbers.

**Quit button added, 2026-08-01.** Previously the only way to end a run
was losing (5 strikes) — there was no way to voluntarily stop and still
get the same "check the leaderboard / review the chain" send-off
CLAUDE.md's original spec (line 190) describes for a real game over.
Added a `🚪 QUIT` header button, next to `🔗 CHAIN`/`🏆 SCORES`, visible
only while `!gameOver` (no reason to offer it once the run's already
over). `quit()` clears every in-progress overlay (`pendingResult`,
`milestone`, `betOffer`, `betBlocked`, `isBetFloor`, `round`) before
setting `gameOver = true`, so quitting mid-pick or mid-milestone can't
leave a stray overlay stacked underneath the new modal — verified
in-browser by quitting with a `ResultModal` actively open. Setting
`gameOver` reuses the exact same underlying state a strikeout triggers
(the `wouldQualify` effect, the RUN OVER banner, `PLAY AGAIN` restart),
just reached through a new `QuitModal` instead of the automatic
`ScoreSubmitModal` — a new `showQuitModal` flag suppresses that
automatic modal (`gameOver && scoreQualifies && !scoreSubmitted &&
!showQuitModal`) so the two never show at once. `QuitModal` itself: a
"👋 Thanks for playing!" header, the same inline initials-entry UI as
`ScoreSubmitModal` when `scoreQualifies && !scoreSubmitted` (reuses
`handleSubmitScore`/`handleSkipScoreSubmit` directly, no duplicated
logic), a persistent "🔗 VIEW FULL CHAIN" button that opens
`ConnectionChainModal` on top without closing the quit modal (same
nested-modal pattern already verified for the chain viewer earlier this
session), and a single "SEE HIGH SCORES ▶" button that closes
`QuitModal` and calls `openLeaderboard()` — satisfying "once the dialog
is closed, the player is taken to a high scores screen" as one action
regardless of whether a score was actually submitted. Verified
in-browser end to end: quit with a qualifying score → submitted via the
inline form (confirmed against a real Firestore write, visible in the
leaderboard immediately after) → viewed the chain mid-modal without
losing quit-modal state → closed into the leaderboard → closed that into
a normal RUN OVER screen with `PLAY AGAIN` intact; separately, quit with
a non-qualifying score showed no initials form, just the chain button
and SEE HIGH SCORES, confirming the conditional. No console errors in
either path.

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

**`same_award` restricted to 10 major bodies (decided 2026-07-31).** The
raw `awards` column carries 700+ distinct Wikidata award values; most are
single-digit-movie regional or trade awards (AVN, AACTA International, a
Danish screenwriting guild, etc.) too obscure to read as a meaningful "these
movies connect" moment — a real risk in the same family as `same_country`'s
broadness problem above, just in the opposite direction (too narrow/obscure
per value, rather than too broad). Restricted in `connections_generator.py`
(`is_major_award()`) to only: Academy Awards, American Film Institute,
BAFTA/British Academy Film Awards, Cannes, Golden Globe, Golden Raspberry,
Palme d'Or, Screen Actors Guild, Sundance, and Writers Guild of America.
Matching is prefix/substring-based per body, not a simple keyword search,
because several raw values are name collisions with unrelated same-named
regional awards that must NOT match: "Golden Globe (Portugal) for Best
Film" (a Portuguese award, not the Hollywood Foreign Press one — matched
only by `startswith("Golden Globe Award")`, not "Golden Globe"), "Polish
Academy Award for Best Editing" (a different national academy — Academy
Award matching requires the phrase at the start or end of the string, not
as a bare substring), and "Danish Writers Guild Best Screenplay Award"
(matched only by `startswith("Writers Guild of America")`, deliberately
narrower than the literal ask's "Writers Guild" wording, since every other
item in that list was a specific major/international body, not "any
national guild" — flagged as a judgment call in the response, not silently
assumed). Verified against the real dataset: 129 of 712 raw award values
survive the filter. Regenerated `data/connections.json(.gz)` and copied to
`app/assets/data/connections.json` (the file the shipped app actually
imports — this is the one that must stay in sync, not just the `data/`
copies). Impact on graph connectivity: movies with zero remaining active
connection go from 275 (1.6%, after the `same_release_year` removal above)
to 317 (1.86%) of the 17,009-film dataset — same small-but-real tradeoff
class as every other connection-type narrowing decision in this section.

**Non-US movies filtered for US-player relevance (decided 2026-07-31).**
Player feedback: too many non-US films were obscure to US players. A
non-US movie is now dropped from the shipped movie pool entirely unless
it has a real connection to a US movie or won a major award on its own
merits — US movies are always kept. "Real connection" means via one of
`US_RELEVANCE_CONNECTION_TYPES` in `connections_generator.py` (mirrors
`ACTIVE_CONNECTION_TYPES`: director, cast, screenwriter, composer, the
already-restricted `same_award`, series) — deliberately **not**
`same_country` itself, since that type isn't active in gameplay (see the
`same_country` finding above); a shared-country link can't actually
surface as a decoy-beating connection in a real round, so it wouldn't be
a genuine rescue from obscurity. "Major award" reuses the same
`is_major_award()` restriction from the `same_award` entry above, checked
independently of connection-group size (a movie counts as an award
winner even if no other film in the dataset shares that exact award
value). Runs after every connection group is built but before compact
integer IDs are assigned, so a dropped movie simply never gets an ID.
Verified against the real dataset: drops 1,335 of 17,009 movies (7.8%),
keeping 15,674 (92.2%). Spot-checked both directions — dropped examples
were genuinely obscure regional titles with no major-award recognition
(a Yugoslav drama, a Russian crime film, an unawarded Chilean
documentary); kept examples included non-US award winners with no US
connection at all (*Decision to Leave* via a Cannes directing prize,
*Departures* via Best International Feature) — the exception clause is
doing real work, not a no-op. All of `TUTORIAL_FLOW.md`'s scripted movies
(Pulp Fiction through Jackie Brown/Titanic/The Sound of Music) verified
still present after filtering. Side effect: graph connectivity actually
*improved* — movies with zero active connections dropped from 317/17,009
(1.86%) to 62/15,674 (0.40%), since the filter disproportionately removes
poorly-connected titles by construction. Regenerated
`data/connections.json(.gz)` and copied to `app/assets/data/
connections.json` per the usual regeneration workflow.

**Tutorial:** full phase-by-phase script (with real, hand-verified example
movies) is in `TUTORIAL_FLOW.md`. Implemented (see section 9's punch
list) and since extended three times, 2026-07-31:
- The 5-second minimum delay on the explain modals was removed (pure
  friction, no upside).
- The `betting` phase — originally a static explainer, since betting
  depended on a real checkpoint the scripted 2-round tutorial didn't
  reach — was replaced with a 4-phase live demo (`betting-intro`/
  `betting-offer`/`betting-round`/`betting-win`) continuing the scripted
  Tarantino chain past Kill Bill Vol. 2 into a real, verified bet-round
  win against Jackie Brown.
- The standalone `strikes` phase (one sentence on an empty board) was
  folded into `done`'s copy instead of getting its own tap, once it was
  the only remaining phase with nothing to show.

`TUTORIAL_FLOW.md` was updated to match all three changes.

**App architecture, decided 2026-07-30:** movie-ladder gets its own
separate app project inside this repo, not a new package in chart-ladder's
monorepo. No shared engine/leaderboard/theme code between the two games —
anything reused will need to be ported/duplicated, not imported.

---

## 5c. Difficulty modes — Easy vs. Regular (built 2026-08-08)

Goal: an Easy mode and a Regular mode. Three levers were chosen out of five
options discussed. **All three plus the shared plumbing are now implemented**
— see "What shipped" at the end of this section for the file-by-file
summary and what's verified vs. still unverified.

Easy = a pool restricted to well-known movies (≥30 sitelinks, 3,765 of
15,674), only the three most recognizable connection types, and the
connection category named up front. Regular = the whole pool, all six
types, no hint. **The modes deliberately change only which rounds get
built** — scoring, strikes, floors and betting are identical in both, so
none of section 5b's economy needed touching.

**The recognizability tell — an earlier measurement here was WRONG, and the
correction is the useful part.** This section used to state that picking
whichever candidate you've heard of doesn't help, citing 400 simulated
rounds where the correct answer was the most recognizable of the three 34%
of the time against a 33% chance baseline. At 4,000 rounds the real figure
is **41–44% strictly most-famous vs 21–23% strictly least** — a substantial,
exploitable tell that existed in regular mode all along. The 400-round
sample was simply too small; the effect is ~3 standard errors out, so it
read as noise.

The cause is structural, not a bug in round-building: a movie's connections
skew towards well-documented (hence well-known) films, while decoys drawn
uniformly come from a pool whose median is far lower. Anything that makes
the correct answer *more* selective — easy's director bias, for instance —
widens the gap further (it hit 40% in easy the moment the bias landed).

**Fixed by `matchDecoyRecognizability`**, on in both modes: decoys are drawn
from the correct answer's sitelink-**rank** neighbourhood
(`DECOY_RANK_WINDOW = 200`) rather than uniformly. Matching by rank rather
than by sitelink *value* is essential and was got wrong first time — the
pool is right-skewed, so a value band like 0.6x–1.7x around a famous film
still contains mostly less-famous films and left the tell at 41%. Rank
neighbourhoods are symmetric by construction. After the fix: easy 23%/16%,
regular 7%/6%, both effectively unexploitable.

Two side effects worth knowing. Matched decoys are similarly well known, so
a player can no longer eliminate a candidate purely for being unheard-of —
that makes regular slightly harder as well as fairer, and it's a one-line
revert (`matchDecoyRecognizability: false`). And it delivers option 4 from
the earlier difficulty list ("make the decoys eliminable") as a by-product,
since all three candidates now sit at a comparable level.

### Option 1 — recognizability filter on the movie pool (data side DONE)

Restrict Easy mode's pool by Wikipedia sitelink count (`sitelinks`, carried
through from `films.csv`, the same notability proxy `films_enrich.py`
already uses for cast filtering). The shipped pool's median is 20, so
roughly half of it is obscure enough that a typical player is guessing
blind rather than reasoning — that's the thing Easy mode fixes.

Feasibility, recomputed against the regenerated shipped file (2026-08-08).
The concern was that filtering to well-known films would fragment the
connection graph; it doesn't, dead-end rate is essentially flat:

| Threshold | Pool | % of pool | Dead ends | Median degree |
|---|---|---|---|---|
| all (Regular) | 15,674 | 100% | 62 (0.4%) | 142 |
| ≥ 20 | 8,039 | 51.3% | 32 (0.4%) | 136 |
| ≥ 25 | 5,480 | 35.0% | 19 (0.3%) | 128 |
| ≥ 30 | 3,765 | 24.0% | 12 (0.3%) | 115 |
| ≥ 40 | 1,784 | 11.4% | 5 (0.3%) | 84 |

**Raised to ≥40 on 2026-08-08 after testers reported easy was too hard**
(was ≥30). The generator prints this distribution at build time so it can
be re-checked whenever the dataset is regenerated.

**What the measurement said before changing it, because it reframes the
problem:** at ≥30, easy candidates already had a median of 39 sitelinks and
the person connecting two films appeared in a median of 33 pool films —
i.e. famous films joined by prolific people. So the difficulty was never
obscure *movies*. It's that spotting a shared **cast member** requires
recalling a cast list, which is a far deeper kind of knowledge than
recognising a title, and 93% of easy hints say "a cast member" (see option
4). Raising the floor to 40 lifts median candidate recognisability 39 → 49
and makes it likelier the player knows all three candidates well enough to
*eliminate* the decoys, which is what turns a round from a guess into a
deduction. Verified at the new floor: 1,784-movie pool, 6,000 rounds with
zero invariant failures, 7 dead-end restarts, all 10 scripted tutorial
movies still in pool.

**The trade-off is repetition** — this is under half the old pool, so films
recur across runs sooner. If that becomes the complaint, the better lever is
biasing rounds toward director/franchise links rather than lowering the
floor again: **80% of easy-pool movies have a director link available but
only ~7% of rounds currently use one**, because the correct answer is drawn
uniformly from all connected movies and cast connections swamp the rest.
That would need a per-floor same-director cap (the franchise cap gives the
pattern) to avoid walking one filmography; median 4 director choices per
movie, so there's room.

**What shipped for this (2026-08-08):** `connections_generator.py` now
carries `sitelinks` as a 5th per-movie field; `movie_fields` is
`["title","year","wikidata_id","imdb_id","sitelinks"]`. Regenerated
`data/connections.json(.gz)` and copied to `app/assets/data/
connections.json` per the usual workflow. `movieLadder.ts`'s `MovieRow`
tuple, `Movie` interface and `movie()` updated, plus a `sitelinks(id)`
accessor. `round_selector.py` needed **no** change — it reads rows via
`dict(zip(movie_fields, row))`, so it picked the new field up for free.

**Critical property, verified rather than assumed:** the new field was
appended *last*, so movie IDs (= array positions) are unchanged. Diffed the
regenerated file against the previous one: 15,674 movies both before and
after, **0** rows whose first four fields changed, and **0** connection
groups changed anywhere — the only difference in the entire file is the
appended column. This means **existing saved games stay valid** (they store
movie IDs — see `App.tsx`'s `SAVE_KEY`, and the save-invalidation warning
in section 9's save-game entry). Also verified all 15,674 sitelink values
match `films.csv` exactly, with none missing or zero. File grew 2.48MB →
2.53MB plain, 1.086MB → 1.109MB gzipped (+2%).

**Runtime side, built 2026-08-08:** the filter lives in `ModeEngine`, which
applies it in `connectedIds()` (so the correct answer is always in-pool) and
in `randomMovie()` (so decoys are too) — i.e. the whole round, per the
warning above, not just the correct answer.

**New failure mode the filter introduces, and its fix:** restricting the
pool creates dead ends that don't exist in the full dataset — a movie whose
only connections are to movies below the floor has zero *playable*
connections (1.4% of easy's pool vs 0.4% of regular's). These can only ever
be hit as a **starting** movie: any movie reached as a correct answer
necessarily connects to the movie it came from, which is in-pool by
construction. So the fix is scoped to starts — `randomStartMovie()` retries
until it finds a movie with at least one in-pool connection. Verified over
800 rounds per mode: zero dead-end restarts in either.

### Option 2 — connection-type tiering (built 2026-08-08)

Easy counts only "loud" connection types, Regular keeps all six. Per-type
reach in the shipped data, which shows Easy stays rich on the loud ones:

| Type | Movies with ≥1 usable link | Groups |
|---|---|---|
| `shared_cast_member` | 15,077 (96.2%) | 13,109 |
| `same_director` | 12,959 (82.7%) | 2,737 |
| `same_composer` | 12,224 (78.0%) | 1,523 |
| `same_screenwriter` | 11,752 (75.0%) | 3,909 |
| `same_series` | 1,321 (8.4%) | 352 |
| `same_award` | 1,157 (7.4%) | 129 |

Easy set as built: `same_series`, `same_director`, `shared_cast_member` —
the ones a player can plausibly know. Regular keeps all six, including
`same_composer`/`same_screenwriter`, which are much harder to spot.
**Don't** try to build a mode on `same_award`/`same_series` alone: at
7–8% reach they're far too thin to chain on. `ACTIVE_CONNECTION_TYPES` is
now per-mode (`MODE_CONFIG`), and it **must stay mirrored** between
`movieLadder.ts` and `round_selector.py` — they're deliberately duplicated,
not imported, so a divergence would silently change what the game counts as
"connected" in one implementation but not the other.

### Option 4 — reveal the connection category as a hint (built 2026-08-08)

Easy mode names the category up front — the round prompt becomes "WHICH
MOVIE SHARES A DIRECTOR WITH THE TOP TILE?" instead of the open-ended
"WHICH MOVIE CONNECTS TO THE TOP TILE?". The chosen type is stored on the
`Round` (`hintType`) rather than derived at render time, so it's stable
across re-renders and survives a save/reload with the round it belongs to.

The `same_series` wrinkle was handled by suppression: it's in
`NON_HINTABLE_TYPES`, so a round whose *only* match is a franchise link
shows the normal no-hint prompt rather than a hint that gives it away.
Measured frequency: 2–3 rounds in 800.

**Finding worth keeping — this hint is weaker than the idea suggests.**
Choosing at random among applicable types made the hint read "a cast
member" in **93%** of easy rounds (measured over 800), because nearly every
pair that connects at all connects on cast. So it rarely narrowed anything.
Mitigated by `HINT_PREFERENCE`: when several types apply, name the *rarest*
(ordered by measured reach — award 7.4%, screenwriter 75%, composer 78%,
director 82.7%, cast 96.2%), which surfaces the ~7% of rounds that have a
director link as "a director" instead of a coin flip. That raised director
hints from 27 to 39 per 600 rounds — a real improvement but not a
transformation. **The bulk of easy mode's difficulty reduction comes from
options 1 and 2, not from this.** If the hint needs to matter more, the
lever is biasing *round construction* toward rarer connection types, not
changing how the hint is picked — deliberately not done here, since it
would make chains director-heavy and repetitive.

A side benefit of preference-ordering: `pickHintType` is now deterministic,
so `TutorialScreen` calls the real function instead of reimplementing the
rule, and the tutorial can't teach a hint the game wouldn't show.

### Option 5 — bias easy toward director/franchise links (built 2026-08-08)

The lever the earlier notes flagged as untried, built after testers said
easy was still too hard. `MODE_CONFIG.preferConnectionTypes` steers easy's
correct answer towards `same_director`/`same_series` when the current movie
offers a choice; regular's list is empty and it's unaffected.

Three separate problems, one change:
1. **Difficulty.** Knowing who directed a film is ordinary knowledge;
   recalling its full cast list isn't. Measured earlier: easy candidates
   were already famous (median 39 sitelinks) and the connecting person
   prolific (median 33 films), so the difficulty was never obscurity — it
   was the *kind* of recall cast connections demand.
2. **The useless hint.** 93% of easy hints said "a cast member."
3. **Uncredited roles.** A director credit can't be a walk-on, so this
   sidesteps the Harrison Ford class of bad connection entirely — which
   matters because section 6 establishes there is *no* data-side fix for it.

Result, over 10,000 rounds per mode: easy rounds using a director link go
**5% → 46%**, franchise 21%, and the hint now reads "a director" 46% of the
time instead of 7%. Regular is unchanged (5% director). Zero invariant
failures in either mode.

**`MAX_DIRECTOR_LINKS_PER_FLOOR = 2`** accompanies it, mirroring the
franchise cap: the bias makes director links common, and without a cap a
floor would walk one filmography — the same repetitive shape the franchise
cap exists to prevent. Both caps are preferences with fallbacks, so a floor
still gets built when only capped options remain (measured: 8 floors per
2,500 exceed the director cap that way, 1–3 the franchise cap).

Steering also **introduced the recognizability tell** described at the top
of this section, by pulling the correct answer towards famous films. That's
what forced `matchDecoyRecognizability` — the two changes have to ship
together, and anyone re-tuning `preferConnectionTypes` should re-measure the
tell afterwards rather than assume it stayed closed.

### Dead ends, and non-US clustering (both fixed 2026-08-08)

Two player reports, both traced to the same underlying shape: the pool is a
graph, and a chain that never revisits a node eventually runs out of edges.

**Dead ends stranded runs.** `buildRound` returns null when a movie has no
unused connection left, and the app rendered a bare "Dead end — no valid
round from this movie" with **no way to continue** — the run was over
except for quitting. Measured before fixing: **135 of 300 simulated easy
runs** hit one, median around 191 picks but as early as pick 2. Two fixes:

1. `buildRoundWithFallback` relaxes constraints in order rather than
   giving up — everything asked for, then caps ignored, then repeats from
   earlier in the run allowed (excluding only what's on the board). A
   repeated movie is far better than an ended run, and the chain stays
   truthful because every link is still a real connection.
2. When even that fails, the board now offers **"CONTINUE FROM A NEW
   MOVIE"** instead of a dead screen. Score, strikes and floor progress
   carry over; the new movie *replaces* the top tile rather than stacking
   on it, so the ladder never shows two adjacent tiles with no link.

The genuinely unrecoverable case is real but narrow — e.g. *Smurfs: The
Lost Village* has exactly **2 connections in the whole easy pool**, and
both were already on the board. Verified after: 0 of 300 runs left
unplayable in either mode, all completing 400 picks; easy needed a recovery
in 109 of 300 long runs, regular in 4.

**Non-US movies clustered into whole floors.** The US-relevance filter
(section 5b) decides *which* non-US films are in the pool — they must
connect to a US film or have won a major award — but says nothing about how
they **chain**, and they cluster hard: a hop out of a non-US movie lands on
another non-US movie **31%** of the time versus **4%** out of a US movie,
because a non-US director's filmography and cast pool are themselves
non-US. Same stickiness shape as the Bond franchise problem.

Worth noting the floor raise did *not* cause this — non-US share actually
falls as the floor rises (35.5% of the full pool, 16.8% at ≥30, 13.8% at
≥40). The director bias made it more visible, since a director link keeps a
chain inside one filmography by construction.

Fixed with `maxNonUSPerFloor` (easy: 2, regular: 0 = uncapped, since
regular's pool is 35% non-US by design and capping would distort the mode
rather than fix a complaint about it). This needed a new **`is_us`** field
in `connections.json` — appended last, so movie IDs are unchanged and saved
games survive (verified: 0 rows shifted, 0 connection groups changed).
Measured after: 33 of 22,820 easy floors exceed 2 non-US movies, all via
the documented fallback.

### Shared plumbing (built 2026-08-08)

- **Leaderboard separation — one collection per mode**, not a `mode` field.
  `highscores` stays regular's (so scores submitted before modes existed
  remain on the board they were played under, zero migration);
  `highscores_easy` is new. Chosen over a `mode` field for two concrete
  reasons: a field would need a composite index
  (`where('mode','==',x)` + `orderBy('score')`) created by hand in the
  Firebase console before the leaderboard worked at all, and every existing
  document lacks the field, so a filtered query would silently drop the
  entire existing board. `firestore.rules` now covers both collections via
  a shared `validScore()` function.
- **Save-game compatibility.** `SavedGame` gained `mode`; `SAVE_KEY`/
  `SAVE_VERSION` bumped `v1` → `v2`. A v1 save has no mode and defaulting
  it either way would resume a run under rules it wasn't played by, so the
  existing version-mismatch discard is the intended outcome (costs each
  player one in-flight run, once). `loadSavedGame` also discards a save
  whose `mode` isn't recognized rather than coercing it.
- **Tutorial copy.** The intro's connection-type list and the
  `pick-correct` copy are per-mode (`buildCopy(mode)`); easy's version
  lists three types and explains the hint. `buildTutorialScript` now takes
  the mode engine, so the explain modals only ever show connections that
  mode actually counts — otherwise easy's tutorial would have taught a
  screenwriter link the mode ignores (all three scripted pairs match on
  screenwriter). Verified the scripted chain survives both modes: every
  pair still connects under easy's reduced type list, all 10 scripted
  movies clear the ≥30 floor, and the decoys were zero-connection under all
  six types so they remain so under three. The tutorial now also renders
  the real round prompt above its candidate rows, so easy's hint is taught
  rather than appearing unexplained in a real run.
- **Mode selector.** New first screen (`ModeSelectScreen`), shown before
  the tutorial so the walkthrough teaches the rules actually chosen. Pool
  sizes on the cards are read from the live engine, not hardcoded, so they
  can't drift after a dataset regeneration. A `CHANGE DIFFICULTY` button on
  the RUN OVER banner returns to it (and clears the save — a run can't
  change mode mid-flight). The mode is also shown in the status bar at all
  times.

### What shipped, and what's verified

Files: `app/src/movieLadder.ts` (mode config + `ModeEngine`),
`app/App.tsx` (selector, plumbing, save v2, hint prompt, mode badge),
`app/src/tutorial.ts` + `TutorialScreen.tsx` (mode-aware copy, hint
prompt), `app/src/leaderboard.ts` + `firestore.rules` (per-mode boards),
`scripts/round_selector.py` (mirrored config, `--mode` flag).

**Verified:** `tsc --noEmit` clean (except one pre-existing unrelated error
in `LadderStack.tsx`, `StyleSheet.absoluteFillObject`, present in HEAD);
`expo export --platform web` bundles successfully; and the **shipped TS
engine** driven headlessly for 800 rounds per mode asserting every
invariant — whole round inside the pool, correct answer connected, both
decoys connected by nothing, no repeats within a run, only the mode's own
types ever reported, hint always among the matches and never
`same_series`, regular never hinting. Zero failures in either mode. The
Python mirror was verified the same way and agrees.

**UI verified in-browser 2026-08-08** (via Claude-in-Chrome against a local
`npm run web` — the Cowork sandbox itself has no browser, the proxy
allowlist blocks Chromium downloads, so the dev server has to run on the
user's machine). Checked end to end, zero console errors:
- Mode-select screen renders both cards with pool sizes read live from the
  engine (3,765 / 15,674) — not hardcoded.
- Easy tutorial intro lists exactly the three easy types and explains the
  hint; the `pick-correct` phase shows the real prompt line.
- **The `explain-correct` modal in easy mode showed only director + cast,
  not screenwriter** — the mode-scoped `connectionsBetween` doing its job,
  which was the specific risk of the tutorial teaching a rule easy ignores.
- A live easy round showed "WHICH MOVIE SHARES A DIRECTOR WITH THE TOP
  TILE?", picking the rarer type over cast exactly as `HINT_PREFERENCE`
  intends.
- **Pool filter confirmed against real rendered output:** all four movies
  in a live easy round (Osmosis Jones 31, Freddy's Dead 37, Shazam! Fury of
  the Gods 39, The Darjeeling Limited 37 sitelinks) clear the ≥30 floor —
  i.e. the current movie AND all three candidates, not just the correct
  answer.
- Regular mode shows the open-ended prompt with no hint, and visibly
  obscurer titles (*It's All Gone Pete Tong*, *Atlas Shrugged: Part I*) —
  the intended contrast.
- Status-bar mode badge, `CHANGE DIFFICULTY` → selector → new mode, the
  quit flow, and the chain modal (mode-scoped reason text) all work.
- **Leaderboard split confirmed live:** `highscores_easy` is empty (a score
  of 5 was offered a top-10 slot), while regular still shows the full
  pre-existing board (WIL 172, 50, 43, BLN 34, …) — the existing scores
  survived untouched, which was the whole reason for splitting by
  collection rather than adding a `mode` field.

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

**Famous people with non-appearances defeat the cast notability filter
(2026-08-08).** The sitelink filter keeps only well-known cast members,
which is exactly why it can't catch this: a famous actor with an
*uncredited* bit part sails through it. A player reported Harrison Ford
being used as the connection between two films on the strength of an
uncredited role (he has several from the late 60s/70s — Zabriskie Point
and others). It reads as a wrong answer even though the data is technically
correct, and no player could be expected to spot it.

**Partial fix, and the reported case is NOT fixed — don't re-attempt this
without reading why.** `films_enrich.py`'s cast query now excludes P161
statements qualified with `pq:P3831 wd:Q16582801` ("object of statement has
role" = "uncredited appearance"). Re-running `--refresh-group cast` removed
**85 cast memberships** (121,865 → 121,780) and dropped 30 people out of the
graph entirely, so the mechanism works. But Harrison Ford still appears in
all 54 of his films, Zabriskie Point included.

**Why: the underlying data isn't there.** Zabriskie Point's Harrison Ford
statement was inspected directly (raw entity JSON via
`Special:EntityData/Q139078.json`) and has **no qualifiers whatsoever** —
Wikidata never recorded that the role was uncredited. It is indistinguishable
from a lead role at the data level.

**Alternatives measured and rejected** (sampled Zabriskie Point, Pulp
Fiction, Star Wars IV, The Godfather, E.T. — all via raw entity JSON):

| Signal | Coverage | Verdict |
|---|---|---|
| `P1545` billing order | **0 of 5 films** had it on any cast statement | unusable |
| `P453` character role | Godfather 28/40, Star Wars 16/24, Pulp Fiction 6/35, E.T. 1/15, Zabriskie Point 0/7 | too inconsistent — requiring it would delete 14 of E.T.'s 15 cast |
| `P3831` generally | Pulp Fiction's 5 uses are `Q1765879` = **"leading actor"**, a positive marker, not a negative one | too sparse to require |

So there is no data-side fix for the Harrison Ford class of problem. The
practical answer is at the **game** level: bias easy mode toward
director/franchise connections (see section 5c), where an uncredited bit
part can't arise by construction — a director credit is never a walk-on.
That also fixes the "93% of hints say cast member" problem, so it's one
change addressing two complaints.

Note the occupation filter (`P106 = Q33999`) suggested below would NOT have
helped either — Harrison Ford is an actor. The two filters address different
halves: sitelinks drops unknown people, the qualifier drops annotated
non-appearances by known people. Neither can drop an unannotated one.

**Re-fetching after a cast-query change** doesn't need a full run:
`python3 scripts/films_enrich.py --refresh-group cast` (new flag) discards
just that group's cache and re-fetches it, leaving the other four cached.

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

**Difficulty modes (Easy/Regular) — built 2026-08-08, see section 5c for
the full spec, measurements and decided constraints:**
- [x] Ship `sitelinks` as a per-movie field in `connections.json` (option
  1's data prerequisite) — generator, regenerated data, both shipped
  copies, `movieLadder.ts` types. Verified ID-stable, so existing saved
  games survive it.
- [x] Option 1: pool filtering by sitelinks (Easy ≥30, 3,765 movies),
  applied to the whole round via `ModeEngine`, plus `randomStartMovie()`
  for the dead-end class the filter introduces.
- [x] Option 2: `ACTIVE_CONNECTION_TYPES` is now per-mode `MODE_CONFIG`
  (Easy = series/director/cast), mirrored in `movieLadder.ts` and
  `round_selector.py`.
- [x] Option 4: connection category named up front in Easy, with
  `same_series` suppressed and rarest-type preference. See section 5c for
  why this lever turned out weaker than expected (93% of hints are "cast
  member" — it's the graph shape, not a bug).
- [x] Shared plumbing: per-mode leaderboard collections (+
  `firestore.rules`), `SavedGame.mode` + `SAVE_VERSION` v1→v2, mode-aware
  tutorial copy, mode selector screen.
- [x] Verified in-browser, 2026-08-08 — mode select, both tutorials, live
  rounds in each mode, hint prompt, pool filter (checked candidate
  sitelinks against the ≥30 floor in a real round), mode badge, CHANGE
  DIFFICULTY, quit/chain flows, and both leaderboards. Zero console
  errors. See section 5c for the itemized results.
- [x] `TUTORIAL_FLOW.md` betting/scoring copy resynced with the shipped
  tutorial (2026-08-08) — it had still described the pre-2026-08-01 betting
  rules (stake one strike, +10 win, −2 strikes loss) and the pre-escalation
  flat +1/+5/+10 scoring, both superseded long before the modes work.
- [ ] Not playtested: whether Easy actually *feels* easier, and whether ≥30
  is the right threshold (25 and 40 are one constant away —
  `EASY_MIN_SITELINKS`).

**Movie Ladder — updated 2026-08-01, this is the current punch list:**
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
- [x] Save-game mechanic added, 2026-07-31 — `App.tsx` auto-persists the
  entire run to `localStorage` on every state change and resumes it on
  reload, since there's only ever one run in flight (not an explicit save
  slot). Resumes mid-round, mid-result-modal, at a milestone/bet-offer
  screen, or even the RUN OVER screen, exactly as left; skips the
  tutorial on reload if there's a run to resume. PLAY AGAIN overwrites
  the save with the fresh run, no separate clearing path needed.
  **Correctness detail worth remembering:** movie IDs are array positions
  in `connections.json` (see `connections_generator.py`), which can shift
  between dataset regenerations even without the total movie count
  changing (referenced-movie set changes, e.g. the `same_award`
  restriction above could drop a movie whose only surviving connection
  was an excluded award value) — this project has already regenerated
  that file twice in one session. A save's displayed movie IDs are each
  paired with their title at save time and re-checked against the live
  dataset on load; any mismatch (or malformed JSON, or a save-schema
  version bump) discards the whole save rather than risk silently
  resuming with the wrong movie under a stale ID. Verified in-browser,
  including deliberately corrupting a saved title and malformed JSON —
  both fall back to a fresh game with no crash.
- [x] Persistent top-10 high-score leaderboard added, 2026-07-31 (design
  decisions from a quick interview, matching this project's established
  pattern for implementation-level questions an ask doesn't specify):
  3-letter arcade-style initials, the name-entry prompt only appears on
  RUN OVER when the score actually makes the top 10 (checked live against
  the leaderboard, not just "always offer"), and the leaderboard itself
  is viewable any time via a "🏆 SCORES" header button, not gated behind
  a run ending. Backed by Firestore: `app/src/leaderboard.ts` wraps
  `fetchTopScores()`/`wouldQualify()`/`submitScore()` around one
  `highscores` collection (one doc per submission, ranked by an
  `orderBy('score','desc').limit(10)` query rather than maintaining a
  single top-10 array document under concurrent writes).
  `app/src/firebaseConfig.ts` holds the Firebase Web SDK config as
  placeholders — these values are meant to be public in client apps
  (Firebase's own model; access control is Firestore Security Rules, not
  hiding the config) — real project values are a follow-up once the
  user supplies them. `/firestore.rules` at the repo root has the rules
  to paste into that project's console: public read, a narrowly-shaped
  create (3-letter name, bounded positive score, server-set timestamp),
  no update/delete from the client. **Not real anti-cheat** — this is a
  client-only game with no backend to verify a score was actually
  earned; acceptable for a casual hobby leaderboard, revisit with Cloud
  Functions verification if that ever becomes a real problem.
  **Bug found and fixed while verifying:** every leaderboard call is
  raced against a 6-second timeout (`withTimeout` in leaderboard.ts) —
  discovered that a call against an unreachable/misconfigured Firebase
  project (e.g. the placeholder config, before real values are filled
  in) doesn't reject quickly, it can hang well past 30 seconds, which
  would leave the qualify-check effect and the leaderboard modal's
  loading state stuck indefinitely with no timeout guard. Verified
  in-browser end to end against the placeholder config (which exercises
  exactly this failure path): leaderboard modal's loading/empty states,
  full submit flow (qualify → enter initials → SUBMIT → SAVING… →
  scoreSubmitted persists across reload so a refresh doesn't re-offer/
  duplicate-submit), all resolving within the timeout with no crash and
  no console errors. Real Firestore connectivity still needs the
  project's own config values and the rules above pasted in — flagged
  to the user as a follow-up, not something Claude can complete alone
  (no access to the user's Firebase console).
- [x] Scoring reworked to escalate per floor, betting redesigned around
  whole floors, 2026-08-01 — see section 5b's "Scoring and betting
  reworked" entry for the full spec, interview-derived decisions, and
  in-browser verification. Short version: per-tile points and the floor
  completion bonus both now scale with floor number (5/tile and 10/floor
  respectively, times the floor number) instead of flat amounts; betting
  now stakes an entire floor (win = finish with zero strikes, doubles
  that floor's completion bonus) instead of a single pick, with no
  separate strike penalty for losing anymore.

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
