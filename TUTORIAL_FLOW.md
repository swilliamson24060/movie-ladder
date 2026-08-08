# Movie Ladder — Tutorial Flow (draft)

Adapted from chart-ladder's `TutorialModal.tsx` + `HowToPlayModal.tsx`
(reviewed 2026-07-30, see project memory), with the differences that were
deliberately decided for movie-ladder: no connection-type guessing step,
5-strike limit, an open-ended run instead of a bounded path, and a betting
mechanic chart-ladder doesn't have.

Implemented (`app/src/TutorialScreen.tsx` + `app/src/tutorial.ts`), with
two deviations from this doc's original draft, both decided later:
- **The minimum-5-second explain-modal delay was removed entirely
  (2026-07-31)** — pure friction with no upside once the tutorial content
  is readable at a glance. The "5s-min modal" phases below now advance the
  instant the player taps, same as every other phase.
- **The `betting` phase was expanded into a live demo, not a static
  explainer (2026-07-31)** — see its entry below for the 4 sub-phases that
  replaced it.
- **The standalone `strikes` phase was folded into `done` (2026-07-31)** —
  it was a single sentence on an otherwise-empty board, sparse enough next
  to every other phase's live demo that it read as an afterthought. Its
  copy now opens the `done` screen's body instead of getting its own tap.

Example movies below are real, pulled from `films.csv`, and hand-verified
against the actual data (see the "Verified connections used" section) so
the tutorial teaches with a true example instead of an invented one.

## Phase list

Mirrors chart-ladder's `Phase` union but extended for movie-ladder's extra
mechanics (milestone scroll-off, betting) and the two-outcome walkthrough
(chart-ladder's tutorial only ever demonstrates a correct pick; this one
demonstrates both, since the wrong-pick modal is new, more detailed UX with
no existing precedent to lean on):

```
type Phase =
  | "intro"
  | "pick-correct"     // scripted: player taps the correct candidate
  | "explain-correct"  // modal, connection breakdown
  | "pick-wrong"        // scripted: player taps a decoy on purpose
  | "explain-wrong"     // modal, connection breakdown + strike count
  | "milestone"         // explains the 5-tile scroll-off + bonus scoring
  | "betting-intro"      // recaps the checkpoint bet offer
  | "betting-offer"      // live preview of the real BET / NO THANKS screen
  | "betting-round"      // scripted: gold-marked candidates, correct one wins
  | "betting-win"        // modal, connection breakdown + bet payout
  | "done"               // chain review + explains the 5-strike game-over
```

Global rules carried over from chart-ladder's tutorial: a fixed demo
sequence (not randomized) so every player sees the identical walkthrough; a
persistent "SKIP ✕" in the header at every phase; advancement is always
player-paced via a button tap, with no minimum delay on any phase
(the original draft specced a 5-second minimum on the explain modals —
removed 2026-07-31, see the note at the top of this doc).

## Phase-by-phase

**intro** — Board shown with one movie already placed (no STARTER/ANCHOR
framing since this is an open-ended run, not a bounded path). Copy:

> Every ladder starts with one movie already on the board. Your job: keep
> picking movies that connect to the one on top, for as long as you can.
>
> Connections come from:
> • Same director
> • Shared cast member
> • Same screenwriter
> • Same composer
> • Same award (Academy Awards, AFI, BAFTA, Cannes, Golden Globe, Golden
>   Raspberry, Palme d'Or, Screen Actors Guild, Sundance, or Writers Guild
>   of America)
> • Same franchise/series
>
> You don't need to know which one applies — just that one exists.
>
> Movies range from 1950 to 2026.

That's regular mode's list. **Easy mode's intro lists only its three types
(director, cast, franchise) and explains the category hint instead** — see
"Difficulty modes changed this script" at the end of this doc.

Button: "NEXT ▶"

**pick-correct** — Board shows **Pulp Fiction (1994)** on top. Three
candidates: **Kill Bill: Volume 1 (2003)** (correct, highlighted),
**Harry Potter and the Philosopher's Stone (2001)**, **Guardians of the
Galaxy (2014)** (both decoys). Copy:

> Each round shows you three movies. Exactly one connects to the movie on
> top of your stack — the other two share nothing with it at all. Here,
> **Kill Bill: Volume 1** (highlighted) is the right pick.

Button: "NEXT ▶" (taps the highlighted candidate for the player, same
pattern as chart-ladder's scripted `handleConfirmTile`)

**explain-correct** — modal, no minimum delay. Copy:

> **Correct!** Kill Bill: Volume 1 connects to Pulp Fiction by:
> - Same director — Quentin Tarantino
> - Same cast member — Uma Thurman
> *(regular mode also shows: Same screenwriter — Quentin Tarantino)*
>
> +5 points, this floor's per-tile value. All matching connections are
> always shown, even when there's more than one — you don't have to guess
> which one "counts."

Button: "NEXT ▶"

**pick-wrong** — Board shows **Kill Bill: Volume 1** on top (now the top
of the stack after the previous correct pick). Three candidates: **Kill
Bill: Volume 2 (2004)** (actually correct), **Back to the Future (1985)**,
**Home Alone (1990)** (both decoys, no connection to Kill Bill Vol. 1 by
any type). Scripted so the demo player taps a decoy — **Back to the
Future** — on purpose. Copy:

> This time, let's pick wrong on purpose so you know what happens.

Button: "SEE WHAT HAPPENS ▶" (taps the decoy)

**explain-wrong** — modal, no minimum delay. Copy:

> **Not quite.** Back to the Future doesn't connect to Kill Bill: Volume 1
> by anything in the data. The correct movie, **Kill Bill: Volume 2**, has
> been placed on the ladder for you automatically — the chain always keeps
> moving, whether you get a round right or not.
>
> Kill Bill: Volume 2 connects to Kill Bill: Volume 1 by:
> - Same director — Quentin Tarantino
> - Same cast — Michael Madsen, Uma Thurman, David Carradine (and 9 more)
>
> **1/5 strikes used.** Miss five and the run ends — more on that shortly.

Button: "CONTINUE ▶"

**milestone** — Board shows a mocked/animated preview of a 5-tile stack
scrolling off-screen, leaving only the top tile. Copy:

> Land 5 correct movies in a row without a strike and the stack clears off
> the board, leaving just the top tile to keep building from. Scoring
> climbs every floor:
> - Floor 1 pays 5 points per correct movie, Floor 2 pays 10, Floor 3 pays
>   15 — 5 more per tile each floor (as you just saw)
> - Completing a floor pays a bonus too: 2 points per correct answer that
>   floor, doubling to 4 on Floor 2, 6 on Floor 3 — 2 more per correct
>   answer each floor. A miss doesn't earn its share, even though the
>   correct movie still gets placed for you.
> - Zero strikes on a floor adds +10 more on top of that floor's bonus
>
> A strike anywhere in the floor still lets you finish it — you just miss
> out on the strike's own bonus share and the +10.

Button: "NEXT ▶"

**betting-intro** — Board still shows the 3-tile Pulp Fiction → Kill Bill
Vol. 1 → Kill Bill Vol. 2 stack from the milestone phase (not actually
cleared/re-scrolled — no slide animation in the tutorial). Copy:

> Right after you clear a group of 5, you'll sometimes get the option to
> bet — you can decline any time. Let's see it in action.

Button: "NEXT ▶"

**betting-offer** — Board adds a non-interactive preview of the real
bet-offer screen (`App.tsx`'s actual `betOffer` UI: "💰 WANT TO BET?" +
NO THANKS / BET) below the stack. The buttons are visual only — the
tutorial's own panel button below drives advancement, same pattern as
every other scripted phase, so the demo doesn't need real branching for a
decline path. Copy:

> A bet stakes your entire next floor:
> - **Win** → finish that floor with zero strikes and its completion bonus
>   doubles
> - **Lose** → miss even once and the bet's off — strikes still cost their
>   normal amount either way
>
> Let's take the bet.

Button: "TAKE THE BET ▶"

**betting-round** — Board shows the same 3-tile stack, a
"💰 BET FLOOR — ZERO STRIKES DOUBLES THIS FLOOR'S COMPLETION BONUS" banner,
and 3 gold-bordered candidates continuing the Tarantino chain past Kill
Bill Vol. 2: **Jackie Brown (1997)** (correct, highlighted blue on top of
the gold bet marking), **Titanic (1997)**, **The Sound of Music (1965)**
(both decoys, zero connection to Kill Bill Vol. 2 — see the
verified-connections table below). Copy:

> Every pick in a bet floor is marked gold, so the raised stakes are never
> a surprise. Here, Jackie Brown (highlighted) is the right pick.

Button: "SEE WHAT HAPPENS ▶"

**betting-win** — modal, no minimum delay, reuses the betting-round board.
Copy:

> **Correct!** Jackie Brown connects to Kill Bill: Volume 2 by:
> - Same director — Quentin Tarantino
> - Same cast member — Michael Bowen, Quentin Tarantino, Samuel L. Jackson
> *(regular mode also shows: Same screenwriter — Quentin Tarantino)*
>
> +5 points, same as any correct pick. A real bet pays off separately, at
> the end of the floor: finish the whole floor with zero strikes and its
> completion bonus doubles. Miss even once and the bet's off, though
> strikes still cost their normal amount either way.

Note the modal deliberately does **not** claim this single pick "won" the
bet — winning now requires completing a whole floor, and the tutorial only
demos one pick, so the copy explains the mechanic rather than asserting the
demo fulfilled it.

Button: "NEXT ▶"

**done** — Full mini chain review of the 4 scripted rounds (Pulp Fiction →
Kill Bill: Volume 1 → Kill Bill: Volume 2 → Jackie Brown, the last hop
added by the betting-round demo), same pattern as chart-ladder's "done"
phase. Also carries what used to be the standalone `strikes` phase's copy
(folded in 2026-07-31 — see the note at the top of this doc) as an
opening paragraph, since a single sentence on an otherwise-empty board had
nothing to anchor it once every other phase had a live demo. Copy:

> Miss 5 times total and the run ends. From there: your score is checked
> against the leaderboard, you can review the full connection chain you
> built, or start a new run.
>
> That's the idea! Tap 🔗 VIEW CONNECTION CHAIN any time during a real run
> to review your path like this again.

Button: "START PLAYING"

## Verified connections used (checked directly against `films.csv`, not invented)

| From | To | Shared | Type |
|---|---|---|---|
| Pulp Fiction | Kill Bill: Volume 1 | Quentin Tarantino | director |
| Pulp Fiction | Kill Bill: Volume 1 | Uma Thurman, Quentin Tarantino | cast |
| Kill Bill: Volume 1 | Kill Bill: Volume 2 | Quentin Tarantino | director |
| Kill Bill: Volume 1 | Kill Bill: Volume 2 | Michael Madsen, Vivica A. Fox, Zoë Bell, Uma Thurman, Julie Dreyfus, Gordon Liu, Michael Parks, Lucy Liu, Quentin Tarantino, Daryl Hannah, David Carradine, Michael Bowen | cast |
| Pulp Fiction | Harry Potter and the Philosopher's Stone | *(none)* | — |
| Pulp Fiction | Guardians of the Galaxy | *(none)* | — |
| Kill Bill: Volume 1 | Back to the Future | *(none)* | — |
| Kill Bill: Volume 1 | Home Alone | *(none)* | — |
| Kill Bill: Volume 2 | Jackie Brown | Quentin Tarantino | director |
| Kill Bill: Volume 2 | Jackie Brown | Michael Bowen, Quentin Tarantino, Samuel L. Jackson | cast |
| Kill Bill: Volume 2 | Jackie Brown | Quentin Tarantino | screenwriter |
| Kill Bill: Volume 2 | Titanic | *(none)* | — |
| Kill Bill: Volume 2 | The Sound of Music | *(none)* | — |

**Correction, 2026-07-30:** this table originally listed The Lord of the
Rings: The Return of the King as the second Kill Bill Vol. 1 decoy,
verified only against director/cast/screenwriter/composer/company/award —
`same_release_year`, `same_series`, `same_based_on`, and `same_country`
didn't exist as connection types yet. Once the real generator/engine were
built (see CLAUDE.md section 9), that pair turned out to share
`same_release_year` (both 2003) — not a valid decoy. Replaced with
**Home Alone (1990)**, re-verified against the actual shipped
`data/connections.json.gz` across all 11 implemented connection types
(zero overlap). This is exactly the failure mode the original table's
closing note anticipated ("have the real round-generation engine finalize
those... rather than hand-picking further") — it just hit an earlier round
than expected.

**Round 4 verified and shipped, 2026-07-31:** Kill Bill Vol. 2 → Jackie
Brown is now the betting-round demo's scripted correct pick (see above),
verified against the real `data/connections.json.gz` (director, cast,
screenwriter — see table above), decoys Titanic and The Sound of Music
verified zero-connection. Round 5 (needed to actually complete the
first 5-tile milestone, which the tutorial still doesn't play out to
completion) remains unverified — the pattern would continue through more
of Tarantino's filmography. Worth having the real round-generation engine
finalize that one too if the tutorial is ever extended to a full milestone
clear, rather than hand-picking further.

## Genre dropped as a connection type (resolved 2026-07-30)

Building the decoy list above surfaced a real risk for `same_genre` as a
connection type: Pulp Fiction alone carries **15** genre tags on Wikidata,
several very generic (`drama film`, `comedy film`, `action film`, `crime
film`). The first three decoy candidates tried — The Shawshank Redemption,
Home Alone, The Sound of Music, The Lion King — all failed because they
turned out to share at least one broad genre tag with Pulp Fiction; it took
filtering ~17,000 films programmatically to find clean ones (Harry Potter,
Guardians of the Galaxy). For any well-tagged, prestige, or multi-genre
film, `same_genre` would end up nearly always true against other
substantial films — undermining the "a decoy has zero valid connections"
premise this whole design depends on.

**Decision:** rather than down-weighting or filtering genre labels, genre
is dropped entirely as a film connection type. The example above and the
verified-decoy table were updated accordingly — the two scripted correct
picks (Pulp Fiction → Kill Bill Vol. 1 → Kill Bill Vol. 2) still work fine
on director + cast alone, and the decoys were already genre-clean anyway,
so nothing needed re-verifying. Also documented in `CLAUDE.md` section 6
and `README.md`. Doesn't affect music/chart-ladder — `same_song_genre` is
shipped there and hasn't shown this problem.

## Difficulty modes changed this script (2026-08-08)

The tutorial is now mode-aware (CLAUDE.md section 5c). What changed:

- **The intro's connection-type list is per mode.** Easy lists three types
  (director, cast, franchise) and explains the category hint; regular keeps
  the six-type list this document originally described.
- **The explain modals use the mode's own connection types.** All three
  scripted pairs also share a screenwriter, which easy mode doesn't count —
  showing it would teach a rule that mode ignores. Verified every scripted
  pair still connects under easy's reduced list (Pulp Fiction → Kill Bill
  Vol. 1 on director + cast; Vol. 1 → Vol. 2 on director + cast + series;
  Vol. 2 → Jackie Brown on director + cast), that all ten scripted movies
  clear easy's ≥30 sitelink floor, and that the decoy pairs — already
  zero-connection across all six types — remain so under three.
- **The candidate rows now show the real round prompt**, which in easy mode
  names the connection category ("WHICH MOVIE SHARES A DIRECTOR WITH THE
  TOP TILE?"). Without this the tutorial would never mention a UI element
  the player meets in their first real round. The tutorial calls the
  engine's own `pickHintType`, so it can't teach a hint the game wouldn't
  actually show.

Everything else in the script — phases, scoring copy, betting demo — is
identical in both modes, because the modes deliberately change only which
rounds get built, not the run's economy.
