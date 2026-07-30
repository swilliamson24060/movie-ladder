# Movie Ladder — Tutorial Flow (draft)

Adapted from chart-ladder's `TutorialModal.tsx` + `HowToPlayModal.tsx`
(reviewed 2026-07-30, see project memory), with the differences that were
deliberately decided for movie-ladder: no connection-type guessing step,
5-strike limit, minimum-5-second explanation modals, an open-ended run
instead of a bounded path, and a betting mechanic chart-ladder doesn't have.

Not yet implemented — this is the phase-by-phase script + copy to build
from once the game engine exists. Example movies below are real, pulled
from `films.csv`, and hand-verified against the actual data (see the
"Verified connections used" section) so the tutorial teaches with a true
example instead of an invented one.

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
  | "explain-correct"  // 5s-min modal
  | "pick-wrong"        // scripted: player taps a decoy on purpose
  | "explain-wrong"     // 5s-min modal
  | "milestone"         // explains the 5-tile scroll-off + bonus scoring
  | "betting"            // explains the checkpoint bet offer
  | "strikes"            // explains the 5-strike game-over
  | "done"
```

Global rules carried over from chart-ladder's tutorial: a fixed demo
sequence (not randomized) so every player sees the identical walkthrough; a
persistent "SKIP ✕" in the header at every phase; advancement is always
player-paced via a button tap — the modals' 5-second *minimum* is the one
new exception (button is present but disabled/unpressable for the first 5s,
matching your "minimum 5s, then tap to continue" spec).

## Phase-by-phase

**intro** — Board shown with one movie already placed (no STARTER/ANCHOR
framing since this is an open-ended run, not a bounded path). Copy:

> Every ladder starts with one movie already on the board. Your job: keep
> picking movies that connect to the one on top, for as long as you can.
> Connections come straight from the data — shared director, cast member,
> award, and more. You don't need to know *which* connection it is, just
> that one exists.

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

**explain-correct** — 5s-minimum modal. Copy:

> **Correct!** Kill Bill: Volume 1 connects to Pulp Fiction in two ways:
> - Same director — Quentin Tarantino
> - Same cast member — Uma Thurman
>
> +1 point. All matching connections are always shown, even when there's
> more than one — you don't have to guess which one "counts."

Button disabled for 5s, then "NEXT ▶"

**pick-wrong** — Board shows **Kill Bill: Volume 1** on top (now the top
of the stack after the previous correct pick). Three candidates: **Kill
Bill: Volume 2 (2004)** (actually correct), **Back to the Future (1985)**,
**Home Alone (1990)** (both decoys, no connection to Kill Bill Vol. 1 by
any type). Scripted so the demo player taps a decoy — **Back to the
Future** — on purpose. Copy:

> This time, let's pick wrong on purpose so you know what happens.

Button: "SEE WHAT HAPPENS ▶" (taps the decoy)

**explain-wrong** — 5s-minimum modal. Copy:

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

Button disabled for 5s, then "CONTINUE ▶"

**milestone** — Board shows a mocked/animated preview of a 5-tile stack
scrolling off-screen, leaving only the top tile. Copy:

> Land 5 correct movies in a row without a strike and the stack clears off
> the board, leaving just the top tile to keep building from — like the
> last one you placed. Every group of 5 also pays a bonus:
> - +1 point per correct movie (as you just saw)
> - **+5 points** for completing a group of 5
> - **+10 points more** if that group of 5 had zero strikes
>
> A strike anywhere in the group still lets you finish it — you just miss
> out on that +10.

Button: "NEXT ▶"

**betting** — Static explainer (no live demo — betting depends on reaching
a real checkpoint, which the scripted tutorial doesn't play out fully).
Copy:

> Right after you clear a group of 5, you'll sometimes get the option to
> bet — you can decline any time. A bet stakes one of your strikes on your
> very next pick:
> - **Win** → a big bonus payout on top of normal scoring
> - **Lose** → that miss costs you 2 strikes instead of 1
>
> You get one bet offer per group of 5, so use it when you're confident.

Button: "NEXT ▶"

**strikes** — Copy:

> Miss 5 times total and the run ends. From there: your score is checked
> against the leaderboard, you can review the full connection chain you
> built, or start a new run.

Button: "NEXT ▶"

**done** — Full mini chain review of the 3 scripted rounds (Pulp Fiction →
Kill Bill: Volume 1 → Kill Bill: Volume 2), same pattern as chart-ladder's
"done" phase. Copy:

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

Rounds 4–5 (needed to actually complete the first 5-tile milestone) aren't
hand-verified here — the pattern would continue through more of Tarantino's
filmography (e.g. → Jackie Brown, itself verified against Kill Bill Vol. 2:
shared director, shared cast — Samuel L. Jackson, Michael Bowen). Worth
having the real round-generation engine finalize those once it exists
rather than hand-picking further.

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
