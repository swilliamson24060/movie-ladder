import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import connectionsData from './assets/data/connections.json';
import {
  isMode,
  Mode,
  MODE_CONFIG,
  MODES,
  ModeEngine,
  MovieLadder,
  Round,
} from './src/movieLadder';
import TutorialScreen from './src/TutorialScreen';
import MovieCell from './src/components/MovieCell';
import LadderStack, { MAX_BOARD_WIDTH, MAX_STACK_TILES } from './src/components/LadderStack';
import { formatMatches, roundPrompt } from './src/tutorial';
import { colors } from './src/theme';
import { fetchTopScores, LeaderboardResult, submitScore, wouldQualify } from './src/leaderboard';

const SLIDE_DURATION_MS = 450;

// CLAUDE.md section 5b's scoring/strikes spec, escalating per floor
// (decided 2026-07-31, replacing the original flat-rate version): floor N
// (1-indexed) pays 5*N points per correct tile; 5 strikes ends the run.
// Completion bonus reworked 2026-08-01: floor N pays 2*N points per
// correct answer THAT FLOOR (a miss doesn't earn its 2*N, even though the
// correct movie still gets auto-placed -- see groupCorrectCount below),
// plus a flat +10 more on top of that bonus if the floor had zero strikes.
// Betting: offered once per completed floor (from floor 2 onward -- see
// the interview this was built from, not a CLAUDE.md-decided number), now
// staking the entire NEXT FLOOR rather than a single pick (decided
// 2026-07-31): win by completing that floor with zero strikes, which
// doubles its completion bonus (the flat no-strike +10 included). Missing
// even once forfeits the bet immediately -- strikes cost their normal 1
// either way, there's no separate bet-loss strike penalty anymore. No
// blocking even when a strike would end the run -- CLAUDE.md is explicit
// that's intentional for the base game, and nothing about the bet redesign
// changes that.
const MAX_STRIKES = 5;
const TILE_POINTS_PER_FLOOR = 5;
const FLOOR_BONUS_PER_CORRECT_PER_FLOOR = 2;
const FLOOR_NO_STRIKE_BONUS = 10;
// Skip the bet offer after the very first floor, so a new player gets one
// clean floor before stakes show up (decided in the interview for this
// feature, not part of CLAUDE.md's original spec).
const FLOORS_BEFORE_BETTING = 1;
// A bet floor still costs a strike its normal amount on a miss (see above),
// so accepting one at MAX_STRIKES - 1 strikes means a single miss both loses
// the bet and ends the run in the same tap -- blocked as a bug fix, 2026-08-01.
const MIN_STRIKES_LEFT_TO_BET = 2;
// Losing a bet now costs points, not just the doubled bonus (decided
// 2026-08-08). On a floor with a bet riding, EVERY wrong answer subtracts
// double that floor's per-tile value, and the floor's completion bonus is
// forfeited outright. So a lost bet floor scores exactly
//   (TILE_POINTS_PER_FLOOR * N * correct) - (2 * TILE_POINTS_PER_FLOOR * N * wrong)
// e.g. floor 2 with 3 of 4 correct: (5*2*3) - (2*5*2) = 10; floor 3 with 3
// of 4: (5*3*3) - (2*5*3) = 15. Strikes themselves still cost their normal
// 1 either way -- this is a points penalty, not a strike penalty.
const BET_LOSS_PENALTY_MULTIPLIER = 2;

function floorNumberFor(floorsCompleted: number): number {
  return floorsCompleted + 1; // 1-indexed: the floor currently in progress
}

interface PendingResult {
  correct: boolean;
  pickedId: number;
  correctId: number;
  previousId: number;
  matches: Record<string, string[]>;
  // Was this pick made during an active bet floor -- captured at pick()
  // time so the result modal can warn that a miss forfeits the bet, even
  // though the bet's actual win/lose resolution happens at floor
  // completion, not per pick.
  isBet: boolean;
  // This floor's per-tile point value (see floorNumberFor/TILE_POINTS_PER_FLOOR),
  // captured at pick() time so confirmPick() and the result modal use the
  // exact same number without recomputing it from floorsCompleted twice.
  tileValue: number;
}

// Save-game mechanic: there's only ever one run in flight, so "saving" just
// means the current run survives a reload/tab close, not an explicit save
// slot -- every state change re-persists the whole snapshot, and starting a
// new run (restart()) naturally overwrites it with the fresh state.
// Bumped v1 -> v2 when difficulty modes landed (2026-08-08): a v1 save has
// no `mode`, and defaulting it either way would silently resume a run under
// rules it wasn't played by (easy's restricted pool/type list vs regular's).
// The version check below already discards cleanly, so a bump is the whole
// fix -- one abandoned in-flight run per player, once.
const SAVE_KEY = 'movie-ladder:save-v2';
const SAVE_VERSION = 2;

interface SavedGame {
  version: number;
  /** Which difficulty mode this run is being played under. A run never
   * changes mode mid-flight -- switching modes goes through the mode-select
   * screen, which starts a fresh run. */
  mode: Mode;
  stack: number[];
  history: number[];
  score: number;
  strikes: number;
  groupHadStrike: boolean;
  // How many of this floor's picks so far were correct -- only correct
  // picks earn the per-correct-answer completion bonus (see the constants
  // comment above), so this has to be tracked separately from just
  // "reached MAX_STACK_TILES," which every floor does regardless of misses.
  groupCorrectCount: number;
  floorScore: number;
  // Whether the most recently completed floor (the one floorScore/
  // floorBetWon describe) had zero strikes / had its bet won -- both only
  // meaningful while `milestone` is true, persisted so a reload mid-
  // milestone-screen shows the exact same banner text.
  floorHadNoStrikes: boolean;
  floorBetWon: boolean;
  // Optional: absent in saves written before the bet-loss penalty shipped,
  // which just means a resumed milestone screen won't call out a lost bet.
  // Not worth a SAVE_VERSION bump (and another discarded run) over one line
  // of banner copy.
  floorBetLost?: boolean;
  floorsCompleted: number;
  betOffer: boolean;
  // True while the "can't bet, not enough strikes left" notice is showing,
  // right after a floor's slide-down finishes -- mutually exclusive with
  // betOffer (the offer never renders when this is what triggered instead).
  betBlocked: boolean;
  // True for every round of the *entire next floor* once a bet is
  // accepted, not just one pick -- reset the instant a strike breaks it or
  // the floor resolves, win or lose.
  isBetFloor: boolean;
  milestone: boolean;
  gameOver: boolean;
  round: Round | null;
  pendingResult: PendingResult | null;
  // Whether this run's final score has already been submitted to the
  // leaderboard -- persisted so a reload on the RUN OVER screen doesn't
  // re-offer (and risk a duplicate submission for) a score already saved.
  // Whether it currently QUALIFIES is re-checked live against the
  // leaderboard instead (see GameScreen's scoreQualifies effect), not
  // persisted here.
  scoreSubmitted: boolean;
  // Every movie ID actually displayed by this snapshot (stack, round
  // candidates, pending-result movies), paired with its title at save time.
  // Movie IDs are just array positions (see connections_generator.py) --
  // they can shift if the connections dataset is ever regenerated, even
  // without the movie count changing. Re-checked on load so a stale save
  // is discarded rather than silently showing the wrong movie under an
  // old ID.
  titleCheck: Record<number, string>;
}

function collectDisplayedIds(snapshot: Omit<SavedGame, 'version' | 'titleCheck'>): number[] {
  const ids = new Set<number>(snapshot.stack);
  if (snapshot.round) {
    ids.add(snapshot.round.currentId);
    snapshot.round.candidateIds.forEach((id) => ids.add(id));
  }
  if (snapshot.pendingResult) {
    ids.add(snapshot.pendingResult.pickedId);
    ids.add(snapshot.pendingResult.correctId);
    ids.add(snapshot.pendingResult.previousId);
  }
  return [...ids];
}

function loadSavedGame(game: MovieLadder): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedGame;
    if (parsed.version !== SAVE_VERSION) return null;
    // A save whose mode isn't one this build knows about (hand-edited
    // storage, or a mode removed in a later version) is discarded rather
    // than coerced to a default -- resuming under the wrong ruleset is
    // exactly what the version bump above exists to prevent.
    if (!isMode(parsed.mode)) return null;
    if (!Array.isArray(parsed.stack) || parsed.stack.length === 0) return null;
    for (const [idStr, title] of Object.entries(parsed.titleCheck ?? {})) {
      const id = Number(idStr);
      if (id < 0 || id >= game.count || game.movie(id).title !== title) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveGame(game: MovieLadder, snapshot: Omit<SavedGame, 'version' | 'titleCheck'>): void {
  try {
    const titleCheck: Record<number, string> = {};
    for (const id of collectDisplayedIds(snapshot)) titleCheck[id] = game.movie(id).title;
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...snapshot, version: SAVE_VERSION, titleCheck }));
  } catch {
    // Storage unavailable (private browsing, quota, etc.) -- the run just
    // won't survive a reload, not worth surfacing to the player over.
  }
}

export default function App() {
  const game = useMemo(() => new MovieLadder(connectionsData as any), []);
  const [savedGame, setSavedGame] = useState<SavedGame | null>(() => loadSavedGame(game));
  // Mode has to be chosen before anything else renders, because the tutorial
  // teaches mode-specific rules and the engine builds mode-specific rounds.
  // A resumed run keeps the mode it was saved under; otherwise null until
  // the player picks, which is what shows the selector.
  const [mode, setMode] = useState<Mode | null>(() => savedGame?.mode ?? null);
  // Skip the tutorial on reload if there's a run to resume -- a returning
  // player doesn't need the walkthrough again just because they refreshed.
  const [showTutorial, setShowTutorial] = useState(() => savedGame === null);

  // Returning to the mode selector abandons the in-flight run (a run can't
  // change mode mid-flight -- see SavedGame.mode), so the stale save is
  // dropped here rather than left to be resumed under the newly chosen mode.
  function changeMode() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // Storage unavailable -- nothing to clear, the run just wasn't saved.
    }
    setSavedGame(null);
    setMode(null);
  }

  function chooseMode(chosen: Mode) {
    setMode(chosen);
    // A player arriving at the selector with no saved run is new (or just
    // reset), so they get the tutorial for the mode they picked.
    setShowTutorial(savedGame === null);
  }

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      {mode === null ? (
        <ModeSelectScreen game={game} onChoose={chooseMode} />
      ) : showTutorial ? (
        <TutorialScreen game={game} mode={mode} onDone={() => setShowTutorial(false)} />
      ) : (
        <GameScreen
          key={mode}
          game={game}
          mode={mode}
          savedGame={savedGame}
          onChangeMode={changeMode}
        />
      )}
    </View>
  );
}

/**
 * Mode picker, shown before the tutorial so the walkthrough can teach the
 * rules the player actually chose. Each mode's pool size is read off the
 * live engine rather than hardcoded, so the numbers can't drift from the
 * shipped dataset the way a written-in figure would after a regeneration.
 */
function ModeSelectScreen({
  game,
  onChoose,
}: {
  game: MovieLadder;
  onChoose: (mode: Mode) => void;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>MOVIE LADDER</Text>
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.modeSelectTitle}>CHOOSE A DIFFICULTY</Text>
        {MODES.map((m) => {
          const config = MODE_CONFIG[m];
          const poolSize = game.forMode(m).poolSize;
          return (
            <Pressable key={m} style={styles.modeCard} onPress={() => onChoose(m)}>
              <Text style={styles.modeCardTitle}>{config.label}</Text>
              <Text style={styles.modeCardBlurb}>{config.blurb}</Text>
              <Text style={styles.modeCardMeta}>
                {poolSize.toLocaleString()} movies · {config.connectionTypes.size} connection types
              </Text>
            </Pressable>
          );
        })}
        <Text style={styles.modeSelectFootnote}>
          Each mode keeps its own high-score board, since the two aren’t comparable.
        </Text>
      </ScrollView>
    </View>
  );
}

function GameScreen({
  game,
  mode,
  savedGame,
  onChangeMode,
}: {
  game: MovieLadder;
  mode: Mode;
  savedGame: SavedGame | null;
  onChangeMode: () => void;
}) {
  // Every round-building call goes through the mode's engine, never the raw
  // dataset -- that's what applies the pool filter and the reduced
  // connection-type list. `game` is still used directly for movie lookups,
  // which are mode-independent.
  const engine = useMemo(() => game.forMode(mode), [game, mode]);
  const [stack, setStack] = useState<number[]>(() => savedGame?.stack ?? [engine.randomStartMovie()]);
  const currentId = stack[stack.length - 1];
  // Every movie placed on the ladder this run, across every floor -- never
  // reset by a milestone clear (only by restart()). Passed as buildRound's
  // exclude set so a connection can never loop back to an earlier rung
  // (e.g. A -> B -> A): without this, buildRound only excluded the round's
  // own current movie, and B's real connections legitimately include A.
  const [history, setHistory] = useState<Set<number>>(() => new Set(savedGame?.history ?? stack));
  const [round, setRound] = useState<Round | null>(() =>
    savedGame ? savedGame.round : engine.buildRound(currentId, history)
  );
  // Set the instant a candidate is tapped, cleared once the player dismisses
  // the result modal -- every pick gets this, right or wrong, per the "more
  // prominent notice on correctness" request. Advancing the stack/round
  // waits for that dismissal (see confirmPick), so the connection is always
  // shown before the board moves on.
  const [pendingResult, setPendingResult] = useState<PendingResult | null>(
    () => savedGame?.pendingResult ?? null
  );
  // True once a group of 5 is showing, from the pick that completed it until
  // the player taps CONTINUE -- no round is built for the 6th movie until
  // the pause is dismissed and the slide-down finishes (CLAUDE.md section
  // 5b's milestone scroll-off).
  const [milestone, setMilestone] = useState(() => savedGame?.milestone ?? false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const [score, setScore] = useState(() => savedGame?.score ?? 0);
  const [strikes, setStrikes] = useState(() => savedGame?.strikes ?? 0);
  // Whether any wrong pick has happened in the group of 5 currently being
  // built -- resets every time a floor completes. Decides that floor's
  // +10 no-strike bonus, independent of the run's total strike count.
  const [groupHadStrike, setGroupHadStrike] = useState(() => savedGame?.groupHadStrike ?? false);
  // How many correct picks so far in the group of 5 currently being built --
  // resets every time a floor completes. Only correct picks earn the
  // per-correct-answer completion bonus.
  const [groupCorrectCount, setGroupCorrectCount] = useState(
    () => savedGame?.groupCorrectCount ?? 0
  );
  // Points the most recently completed floor earned, shown in the
  // milestone banner. Only meaningful while `milestone` is true.
  const [floorScore, setFloorScore] = useState(() => savedGame?.floorScore ?? 0);
  const [floorHadNoStrikes, setFloorHadNoStrikes] = useState(
    () => savedGame?.floorHadNoStrikes ?? false
  );
  const [floorBetWon, setFloorBetWon] = useState(() => savedGame?.floorBetWon ?? false);
  // Whether the floor just completed had a bet that was LOST -- distinct
  // from "no bet" for the milestone banner, since a lost bet is the case
  // where the completion bonus was forfeited outright and the player is
  // owed an explanation for a floor that paid far less than usual.
  const [floorBetLost, setFloorBetLost] = useState(() => savedGame?.floorBetLost ?? false);
  const [gameOver, setGameOver] = useState(() => savedGame?.gameOver ?? false);
  // How many floors have been completed this run -- gates the bet offer
  // (skips after floor 1) rather than tracking a separate boolean.
  const [floorsCompleted, setFloorsCompleted] = useState(() => savedGame?.floorsCompleted ?? 0);
  // True while the bet-offer step (BET / NO THANKS) is showing, right
  // after a floor's slide-down finishes and before the next round builds.
  const [betOffer, setBetOffer] = useState(() => savedGame?.betOffer ?? false);
  // True while the "can't bet" notice is showing in place of the bet offer,
  // for a floor reached with too few strikes remaining to risk one.
  const [betBlocked, setBetBlocked] = useState(() => savedGame?.betBlocked ?? false);
  // True for every round of the entire floor once a bet is accepted, and it
  // STAYS true after a miss breaks the bet -- because every wrong answer on
  // a bet floor is penalised, not just the first (see
  // BET_LOSS_PENALTY_MULTIPLIER). Cleared only when the floor resolves or
  // the run restarts. Whether the bet is still winnable is derived below
  // rather than stored, so there's no second flag to keep in sync.
  const [isBetFloor, setIsBetFloor] = useState(() => savedGame?.isBetFloor ?? false);

  // High-score leaderboard: modal visibility + its data (null = loading /
  // not yet fetched), openable any time via the header button regardless
  // of run state.
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardResult, setLeaderboardResult] = useState<LeaderboardResult | null>(null);
  // True when the leaderboard was opened as the last step of the quit flow.
  // Closing it then ends the session entirely (clears the save and reloads)
  // rather than dropping the player back on the RUN OVER screen -- see
  // endSessionAfterQuit.
  const [quitFlowActive, setQuitFlowActive] = useState(false);
  // Connection-chain review: openable any time via the header button,
  // during a live run or after RUN OVER alike -- promised by the tutorial's
  // closing copy ("Tap 🔗 VIEW CONNECTION CHAIN any time during a real
  // run"), which shipped before this button did.
  const [showChain, setShowChain] = useState(false);
  // True from the moment the player taps QUIT until they dismiss the
  // "Thanks for playing!" modal -- lets that modal own the score-submit UI
  // itself (see the render condition below) instead of also popping the
  // automatic ScoreSubmitModal on top of it once scoreQualifies resolves.
  const [showQuitModal, setShowQuitModal] = useState(false);
  // Whether this run's final score currently makes the top 10 -- re-checked
  // against the live leaderboard whenever the game-over screen mounts
  // (including resuming straight into it after a reload), so it's derived
  // state rather than something persisted in the save itself.
  const [scoreQualifies, setScoreQualifies] = useState(false);
  const [scoreSubmitted, setScoreSubmitted] = useState(() => savedGame?.scoreSubmitted ?? false);
  const [initials, setInitials] = useState('');
  const [submittingScore, setSubmittingScore] = useState(false);

  useEffect(() => {
    if (!gameOver || scoreSubmitted) return;
    let cancelled = false;
    wouldQualify(score, mode).then((qualifies) => {
      if (!cancelled) setScoreQualifies(qualifies);
    });
    return () => {
      cancelled = true;
    };
  }, [gameOver, scoreSubmitted, score]);

  // Auto-save: re-persist the whole run on every change so a reload/close
  // resumes exactly where the player left off (see the SavedGame type's
  // docs above for why movie IDs are re-verified on load, not just replayed
  // blindly).
  useEffect(() => {
    saveGame(game, {
      mode,
      stack,
      history: [...history],
      score,
      strikes,
      groupHadStrike,
      groupCorrectCount,
      floorScore,
      floorHadNoStrikes,
      floorBetWon,
      floorBetLost,
      floorsCompleted,
      betOffer,
      betBlocked,
      isBetFloor,
      milestone,
      gameOver,
      round,
      pendingResult,
      scoreSubmitted,
    });
  }, [
    game,
    mode,
    stack,
    history,
    score,
    strikes,
    groupHadStrike,
    groupCorrectCount,
    floorScore,
    floorHadNoStrikes,
    floorBetWon,
    floorBetLost,
    floorsCompleted,
    betOffer,
    betBlocked,
    isBetFloor,
    milestone,
    gameOver,
    round,
    pendingResult,
    scoreSubmitted,
  ]);

  function openLeaderboard() {
    setShowLeaderboard(true);
    setLeaderboardResult(null);
    fetchTopScores(mode).then(setLeaderboardResult);
  }

  /**
   * Ends the session for real at the end of the quit flow: drops the saved
   * run and reloads the page.
   *
   * Both halves matter. Clearing the save is what lets the player back to
   * the start screen at all -- the autosave resumes any run that exists on
   * boot (and deliberately skips the tutorial when it does), so without
   * this a quit would just be resumed on the next visit. The reload is what
   * lets a deployed update actually reach them: this is a static web build,
   * so a player who never closes the tab keeps running whatever JS bundle
   * they first loaded, however many times they quit and replay.
   *
   * Order matters: clear first, reload second, and do nothing in between --
   * the autosave effect re-persists on every state change, so any state
   * update after the clear would write the run straight back.
   */
  function endSessionAfterQuit() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // Storage unavailable -- there was no save to clear anyway.
    }
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
      window.location.reload();
      return;
    }
    // Native (no window.location): fall back to the in-app equivalent --
    // back to the mode selector with the save already cleared.
    setQuitFlowActive(false);
    setShowLeaderboard(false);
    onChangeMode();
  }

  // Ends the run early, same underlying "run over" state a strikeout
  // triggers (gameOver -- reuses the same wouldQualify effect, the same
  // RUN OVER banner underneath, the same PLAY AGAIN restart), but through
  // QuitModal's friendlier framing instead of the automatic ScoreSubmitModal.
  // Clears every mid-round overlay so QuitModal is the only thing on top,
  // even if the player quits mid-pick or mid-milestone.
  function quit() {
    setPendingResult(null);
    setMilestone(false);
    setBetOffer(false);
    setBetBlocked(false);
    setIsBetFloor(false);
    setRound(null);
    setGameOver(true);
    setShowQuitModal(true);
  }

  // QuitModal's own "done" action -- closes it and hands off straight to
  // the high-scores screen, per the ask ("once the dialog is closed, the
  // player is taken to a high scores screen"). Works whether or not the
  // player submitted/skipped a qualifying score first. Marking the quit
  // flow here is what makes closing that leaderboard end the session
  // (endSessionAfterQuit) instead of returning to the RUN OVER screen.
  function finishQuit() {
    setShowQuitModal(false);
    setQuitFlowActive(true);
    openLeaderboard();
  }

  async function handleSubmitScore() {
    if (initials.length === 0 || submittingScore) return;
    setSubmittingScore(true);
    await submitScore(initials, score, mode);
    setSubmittingScore(false);
    setScoreSubmitted(true);
  }

  // "Declining" reuses scoreSubmitted rather than a separate flag -- for
  // this modal's purposes "submitted" and "skipped" mean the same thing
  // (don't show the prompt again this run), and the leaderboard itself
  // only ever reflects a real submitScore() call either way.
  function handleSkipScoreSubmit() {
    setScoreSubmitted(true);
  }

  function pick(candidateId: number) {
    if (!round) return;
    setPendingResult({
      correct: candidateId === round.correctId,
      pickedId: candidateId,
      correctId: round.correctId,
      previousId: currentId,
      matches: round.matches,
      isBet: isBetFloor,
      tileValue: TILE_POINTS_PER_FLOOR * floorNumberFor(floorsCompleted),
    });
  }

  function confirmPick() {
    if (!pendingResult) return;
    const { correctId, correct, isBet, tileValue } = pendingResult;
    setPendingResult(null);

    const newStrikes = correct ? strikes : Math.min(MAX_STRIKES, strikes + 1);
    const thisGroupHadStrike = groupHadStrike || !correct;
    const thisGroupCorrectCount = groupCorrectCount + (correct ? 1 : 0);

    // Every wrong answer on a bet floor costs double this floor's per-tile
    // value -- including ones after the bet is already unwinnable, since the
    // rule penalises each wrong answer on the floor, not just the one that
    // broke the bet. Clamped so a run can't go negative; the leaderboard
    // rejects scores of 0 or less anyway, so there's nothing below 0 to
    // represent.
    const penalty = !correct && isBet ? BET_LOSS_PENALTY_MULTIPLIER * tileValue : 0;

    if (correct) setScore((s) => s + tileValue);
    if (penalty > 0) setScore((s) => Math.max(0, s - penalty));
    if (!correct) setStrikes(newStrikes);

    // NB: isBetFloor is deliberately NOT cleared here on a miss. It has to
    // survive to the end of the floor so later wrong answers are penalised
    // too and the completion bonus is correctly forfeited. "Still winnable"
    // is derived from it plus groupHadStrike (see betStillWinnable), which
    // is what drives the gold marking off the moment a miss happens.

    // The chain always advances, right or wrong (CLAUDE.md section 5b).
    const newStack = [...stack, correctId];
    setStack(newStack);
    const newHistory = new Set(history);
    newHistory.add(correctId);
    setHistory(newHistory);

    const floorComplete = newStack.length >= MAX_STACK_TILES;
    if (floorComplete) {
      const floorNum = floorNumberFor(floorsCompleted);
      const noStrikeBonus = thisGroupHadStrike ? 0 : FLOOR_NO_STRIKE_BONUS;
      // isBetFloor now stays true for the whole floor once a bet is taken
      // (see confirmPick), so the bet's outcome is simply whether the floor
      // ended clean.
      const betWon = isBetFloor && !thisGroupHadStrike;
      const betLost = isBetFloor && thisGroupHadStrike;
      // A lost bet forfeits the completion bonus outright -- not just the
      // doubling, and not just the no-strike +10. Combined with the
      // per-wrong-answer penalty above, a lost bet floor scores exactly
      // (tile points earned) - (2 x tile value x wrong answers).
      const completionBonus = betLost
        ? 0
        : FLOOR_BONUS_PER_CORRECT_PER_FLOOR * floorNum * thisGroupCorrectCount + noStrikeBonus;
      const bonus = betWon ? completionBonus * 2 : completionBonus;
      setScore((s) => s + bonus);
      setFloorScore(bonus);
      setFloorHadNoStrikes(!thisGroupHadStrike);
      setFloorBetWon(betWon);
      setFloorBetLost(betLost);
      setIsBetFloor(false);
      setGroupHadStrike(false);
      setGroupCorrectCount(0);
      setFloorsCompleted((n) => n + 1);
    } else {
      setGroupHadStrike(thisGroupHadStrike);
      setGroupCorrectCount(thisGroupCorrectCount);
    }

    if (newStrikes >= MAX_STRIKES) {
      // Hard game over, no continue -- matches CLAUDE.md section 5b. If
      // this same pick also completed a floor, the score above already
      // includes that floor's bonus; the milestone banner just doesn't get
      // a turn, since there's no next round to continue into anyway.
      setGameOver(true);
      setRound(null);
      return;
    }

    if (floorComplete) {
      // Pause on a full board rather than building the next round --
      // continueAfterMilestone() builds it (or offers a bet first) once
      // the player has seen the completed group and the slide-down has
      // cleared it away.
      setRound(null);
      setMilestone(true);
    } else {
      setRound(engine.buildRound(correctId, newHistory));
    }
  }

  function continueAfterMilestone() {
    // Decided synchronously, in direct response to the tap, rather than
    // re-read from state inside the .start() callback below -- state
    // setters called from that delayed callback were observed not to take
    // effect reliably on web (useNativeDriver falls back to a JS/rAF-driven
    // animation there). Capturing a plain boolean here sidesteps it.
    const offerBet = floorsCompleted > FLOORS_BEFORE_BETTING;
    const canBet = MAX_STRIKES - strikes >= MIN_STRIKES_LEFT_TO_BET;
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: SLIDE_DURATION_MS,
      useNativeDriver: true,
    }).start(() => {
      const topId = stack[stack.length - 1];
      setStack([topId]);
      setMilestone(false);
      slideAnim.setValue(0);

      if (offerBet && canBet) {
        setBetOffer(true);
      } else if (offerBet) {
        setBetBlocked(true);
      } else {
        setRound(engine.buildRound(topId, history));
      }
    });
  }

  function resolveBetOffer(accepted: boolean) {
    setBetOffer(false);
    setIsBetFloor(accepted);
    setRound(engine.buildRound(stack[stack.length - 1], history));
  }

  function continueAfterBetBlocked() {
    setBetBlocked(false);
    setRound(engine.buildRound(stack[stack.length - 1], history));
  }

  function restart() {
    const startId = engine.randomStartMovie();
    const startHistory = new Set([startId]);
    setStack([startId]);
    setHistory(startHistory);
    setRound(engine.buildRound(startId, startHistory));
    setPendingResult(null);
    setMilestone(false);
    setScore(0);
    setStrikes(0);
    setGroupHadStrike(false);
    setGroupCorrectCount(0);
    setFloorScore(0);
    setFloorHadNoStrikes(false);
    setFloorBetWon(false);
    setFloorBetLost(false);
    setGameOver(false);
    setFloorsCompleted(0);
    setBetOffer(false);
    setBetBlocked(false);
    setIsBetFloor(false);
    setScoreQualifies(false);
    setScoreSubmitted(false);
    setInitials('');
    setSubmittingScore(false);
    setShowQuitModal(false);
    setQuitFlowActive(false);
    slideAnim.setValue(0);
  }

  // isBetFloor stays true for the whole floor so every wrong answer is
  // penalised (see confirmPick), so it can't drive the gold marking on its
  // own -- that has to stop the moment the bet becomes unwinnable, or the
  // board would keep advertising a bet the player can no longer win.
  const betStillWinnable = isBetFloor && !groupHadStrike;

  const stackMovies = stack.map((id) => {
    const m = game.movie(id);
    return { title: m.title, year: m.year };
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>MOVIE LADDER</Text>
        <View style={styles.headerButtons}>
          {!gameOver && (
            <Pressable onPress={quit}>
              <Text style={[styles.leaderboardButtonText, styles.quitButtonText]}>🚪 QUIT</Text>
            </Pressable>
          )}
          <Pressable onPress={() => setShowChain(true)}>
            <Text style={styles.leaderboardButtonText}>🔗 CHAIN</Text>
          </Pressable>
          <Pressable onPress={openLeaderboard}>
            <Text style={styles.leaderboardButtonText}>🏆 SCORES</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.statusBar}>
        <Text style={styles.statusText}>SCORE: {score}</Text>
        {/* Always-visible mode badge: the two modes differ enough (pool,
            connection types, hints) that "which mode am I in" has to be
            answerable at a glance, not only from the leaderboard. */}
        <Text style={styles.statusTextMode}>{MODE_CONFIG[mode].label}</Text>
        <Text style={[styles.statusText, strikes > 0 && styles.statusTextDanger]}>
          STRIKES: {strikes}/{MAX_STRIKES}
        </Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <LadderStack movies={stackMovies} slideProgress={slideAnim} />

        {gameOver ? (
          <View style={styles.milestoneBanner}>
            <Text style={[styles.milestoneText, { color: colors.red }]}>RUN OVER</Text>
            <Text style={styles.milestoneScore}>
              Final score: {score} ({MODE_CONFIG[mode].label})
            </Text>
            <Pressable style={styles.button} onPress={restart}>
              <Text style={styles.buttonText}>PLAY AGAIN ▶</Text>
            </Pressable>
            {/* Switching difficulty is only offered between runs -- a run
                can't change mode mid-flight (see SavedGame.mode), and the
                run-over screen is the natural place to reconsider. */}
            <Pressable style={styles.buttonSecondaryFull} onPress={onChangeMode}>
              <Text style={styles.buttonSecondaryText}>CHANGE DIFFICULTY</Text>
            </Pressable>
          </View>
        ) : milestone ? (
          <View style={styles.milestoneBanner}>
            <Text style={styles.milestoneText}>🪜 FLOOR {floorsCompleted} COMPLETE!</Text>
            <Text style={styles.milestoneScore}>
              +{floorScore} points
              {floorBetWon
                ? ' — bet won, completion bonus doubled!'
                : floorBetLost
                  ? ' — bet lost: completion bonus forfeited, wrong answers cost double'
                  : floorHadNoStrikes
                    ? ' — no strikes this floor!'
                    : ''}
            </Text>
            <Pressable style={styles.button} onPress={continueAfterMilestone}>
              <Text style={styles.buttonText}>CONTINUE ▶</Text>
            </Pressable>
          </View>
        ) : betOffer ? (
          <View style={styles.milestoneBanner}>
            <Text style={styles.milestoneText}>💰 WANT TO BET?</Text>
            <Text style={styles.betLine}>Stake the next floor: finish it with zero strikes and</Text>
            <Text style={styles.betLine}>that floor's completion bonus is doubled.</Text>
            <Text style={styles.betLine}>Miss even once and you lose the bet: no completion</Text>
            <Text style={styles.betLine}>bonus, and every wrong answer that floor subtracts</Text>
            <Text style={styles.betLine}>double its points. Strikes cost their normal amount.</Text>
            <View style={styles.betButtonRow}>
              <Pressable style={styles.betButtonSlot} onPress={() => resolveBetOffer(false)}>
                <View style={styles.buttonSecondary}>
                  <Text style={styles.buttonSecondaryText}>NO THANKS</Text>
                </View>
              </Pressable>
              <Pressable style={styles.betButtonSlot} onPress={() => resolveBetOffer(true)}>
                <View style={styles.buttonBet}>
                  <Text style={styles.buttonBetText}>BET</Text>
                </View>
              </Pressable>
            </View>
          </View>
        ) : betBlocked ? (
          <View style={styles.milestoneBanner}>
            <Text style={styles.milestoneText}>🚫 TOO MANY STRIKES. CANNOT PLACE BET</Text>
            <Text style={styles.betLine}>You don’t have enough strikes left to risk a bet --</Text>
            <Text style={styles.betLine}>a miss during a bet floor still costs a strike, and</Text>
            <Text style={styles.betLine}>you're too close to {MAX_STRIKES}/{MAX_STRIKES} for that.</Text>
            <Pressable style={styles.button} onPress={continueAfterBetBlocked}>
              <Text style={styles.buttonText}>CONTINUE ▶</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {betStillWinnable ? (
              <Text style={styles.betRoundBanner}>
                💰 BET FLOOR — ZERO STRIKES DOUBLES THIS FLOOR’S COMPLETION BONUS
              </Text>
            ) : isBetFloor ? (
              // The bet is already lost, but the floor's penalty is still
              // live -- every remaining wrong answer costs double. Saying so
              // matters more than the gold marking did: the player is still
              // exposed to a cost they opted into.
              <Text style={[styles.betRoundBanner, { color: colors.red }]}>
                💸 BET LOST — WRONG ANSWERS STILL COST DOUBLE THIS FLOOR
              </Text>
            ) : null}
            {/* In easy mode this names the connection category to look for
                (option 4 of CLAUDE.md section 5c); in regular it's the
                original open-ended prompt. Reads round.hintType rather than
                recomputing, so the hint is stable across re-renders and
                survives a save/reload with the round it belongs to. */}
            <Text style={styles.label}>{roundPrompt(round?.hintType ?? null)}</Text>

            {round ? (
              <View style={styles.candidatesRow}>
                {round.candidateIds.map((id) => {
                  const m = game.movie(id);
                  return (
                    <View key={id} style={styles.candidateSlot}>
                      <MovieCell
                        title={m.title}
                        year={m.year}
                        compact
                        state={betStillWinnable ? 'bet' : 'default'}
                        onPress={() => pick(id)}
                      />
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.result}>Dead end — no valid round from this movie.</Text>
            )}
          </>
        )}
      </ScrollView>

      {pendingResult && (
        <ResultModal game={game} result={pendingResult} strikes={strikes} onContinue={confirmPick} />
      )}

      {showLeaderboard && (
        <LeaderboardModal
          result={leaderboardResult}
          mode={mode}
          onClose={() => {
            if (quitFlowActive) {
              endSessionAfterQuit();
              return;
            }
            setShowLeaderboard(false);
          }}
        />
      )}

      {showChain && (
        <ConnectionChainModal
          game={game}
          engine={engine}
          history={history}
          onClose={() => setShowChain(false)}
        />
      )}

      {gameOver && scoreQualifies && !scoreSubmitted && !showQuitModal && (
        <ScoreSubmitModal
          score={score}
          initials={initials}
          onChangeInitials={setInitials}
          submitting={submittingScore}
          onSubmit={handleSubmitScore}
          onSkip={handleSkipScoreSubmit}
        />
      )}

      {showQuitModal && (
        <QuitModal
          score={score}
          scoreQualifies={scoreQualifies}
          scoreSubmitted={scoreSubmitted}
          initials={initials}
          onChangeInitials={setInitials}
          submitting={submittingScore}
          onSubmit={handleSubmitScore}
          onSkip={handleSkipScoreSubmit}
          onViewChain={() => setShowChain(true)}
          onDone={finishQuit}
        />
      )}
    </View>
  );
}

function LeaderboardModal({
  result,
  mode,
  onClose,
}: {
  result: LeaderboardResult | null; // null = still loading
  mode: Mode;
  onClose: () => void;
}) {
  const entries = result?.entries ?? [];
  return (
    <Modal transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>🏆 HIGH SCORES — {MODE_CONFIG[mode].label}</Text>
          {result === null ? (
            <Text style={styles.modalLine}>Loading…</Text>
          ) : result.status === 'unavailable' ? (
            // Only shown when the fetch actually failed/timed out. An empty
            // board reports status 'ok' with no entries and gets the
            // "be the first" message below instead -- the two used to be
            // indistinguishable, which made a brand-new easy board look
            // broken. See LeaderboardResult in leaderboard.ts.
            <Text style={styles.modalLine}>
              Couldn’t load the leaderboard right now. Your run still counts — try again in a
              moment.
            </Text>
          ) : entries.length === 0 ? (
            <Text style={styles.modalLine}>
              No scores yet on the {MODE_CONFIG[mode].label} board — be the first!
            </Text>
          ) : (
            <ScrollView style={styles.modalScroll}>
              {entries.map((entry, i) => (
                <View key={i} style={styles.leaderboardRow}>
                  <Text style={styles.leaderboardRank}>{i + 1}.</Text>
                  <Text style={styles.leaderboardName}>{entry.name}</Text>
                  <Text style={styles.leaderboardScore}>{entry.score}</Text>
                </View>
              ))}
            </ScrollView>
          )}
          <Pressable style={styles.button} onPress={onClose}>
            <Text style={styles.buttonText}>CLOSE</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ConnectionChainModal({
  game,
  engine,
  history,
  onClose,
}: {
  game: MovieLadder;
  // Mode-scoped, so the chain explains each link using the same connection
  // types the run was actually played under -- in easy mode, listing a
  // screenwriter link the mode never counted would misreport why those two
  // movies connected.
  engine: ModeEngine;
  history: Set<number>;
  onClose: () => void;
}) {
  // `history` is a Set, but insertion order is exactly this run's chain
  // order (see the SavedGame docs above the state) -- every movie ever
  // placed, across every floor, not just the current visible stack (which
  // gets collapsed down to one tile at each milestone).
  const chain = [...history];

  return (
    <Modal transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>🔗 THE CHAIN SO FAR</Text>
          <ScrollView style={styles.modalScroll}>
            {chain.map((id, i) => {
              const movie = game.movie(id);
              const nextId = chain[i + 1];
              const matchLines =
                nextId !== undefined ? formatMatches(engine.connectionsBetween(id, nextId)) : [];
              return (
                <View key={`${id}-${i}`}>
                  <View style={styles.chainRow}>
                    <Text style={styles.chainRank}>{i + 1}</Text>
                    <View style={styles.chainCopy}>
                      <Text style={styles.chainTitle}>{movie.title}</Text>
                      <Text style={styles.chainMeta}>{movie.year}</Text>
                    </View>
                  </View>
                  {matchLines.length > 0 && (
                    <View style={styles.chainLinkRow}>
                      <Text style={styles.chainLinkLine}>│</Text>
                      <Text style={styles.chainReason}>{matchLines.join(' · ')}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
          <Pressable style={styles.button} onPress={onClose}>
            <Text style={styles.buttonText}>CLOSE</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ScoreSubmitModal({
  score,
  initials,
  onChangeInitials,
  submitting,
  onSubmit,
  onSkip,
}: {
  score: number;
  initials: string;
  onChangeInitials: (value: string) => void;
  submitting: boolean;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  return (
    <Modal transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, styles.scoreSubmitCard]}>
          <Text style={[styles.modalTitle, styles.centeredText]}>🎉 New top-10 high score!</Text>
          <Text style={[styles.modalScore, styles.centeredText]}>Final score: {score}</Text>
          <Text style={[styles.modalLine, styles.centeredText]}>Enter your initials:</Text>
          <TextInput
            style={styles.initialsInput}
            value={initials}
            onChangeText={(t) => onChangeInitials(t.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))}
            maxLength={3}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="ABC"
            placeholderTextColor={colors.textSecondary}
            autoFocus
          />
          <View style={styles.betButtonRow}>
            <Pressable style={styles.betButtonSlot} onPress={onSkip}>
              <View style={styles.buttonSecondary}>
                <Text style={styles.buttonSecondaryText}>SKIP</Text>
              </View>
            </Pressable>
            <Pressable
              style={styles.betButtonSlot}
              disabled={initials.length === 0 || submitting}
              onPress={onSubmit}
            >
              <View style={[styles.button, (initials.length === 0 || submitting) && styles.buttonDisabled]}>
                <Text style={styles.buttonText}>{submitting ? 'SAVING…' : 'SUBMIT ▶'}</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function QuitModal({
  score,
  scoreQualifies,
  scoreSubmitted,
  initials,
  onChangeInitials,
  submitting,
  onSubmit,
  onSkip,
  onViewChain,
  onDone,
}: {
  score: number;
  scoreQualifies: boolean;
  scoreSubmitted: boolean;
  initials: string;
  onChangeInitials: (value: string) => void;
  submitting: boolean;
  onSubmit: () => void;
  onSkip: () => void;
  onViewChain: () => void;
  onDone: () => void;
}) {
  return (
    <Modal transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, styles.scoreSubmitCard]}>
          <Text style={[styles.modalTitle, styles.centeredText]}>👋 Thanks for playing!</Text>
          <Text style={[styles.modalScore, styles.centeredText]}>Final score: {score}</Text>

          {scoreQualifies && !scoreSubmitted && (
            <>
              <Text style={[styles.modalLine, styles.centeredText]}>
                🎉 That’s a new top-10 high score! Enter your initials:
              </Text>
              <TextInput
                style={styles.initialsInput}
                value={initials}
                onChangeText={(t) => onChangeInitials(t.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))}
                maxLength={3}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="ABC"
                placeholderTextColor={colors.textSecondary}
                autoFocus
              />
              <View style={styles.betButtonRow}>
                <Pressable style={styles.betButtonSlot} onPress={onSkip}>
                  <View style={styles.buttonSecondary}>
                    <Text style={styles.buttonSecondaryText}>SKIP</Text>
                  </View>
                </Pressable>
                <Pressable
                  style={styles.betButtonSlot}
                  disabled={initials.length === 0 || submitting}
                  onPress={onSubmit}
                >
                  <View style={[styles.button, (initials.length === 0 || submitting) && styles.buttonDisabled]}>
                    <Text style={styles.buttonText}>{submitting ? 'SAVING…' : 'SUBMIT ▶'}</Text>
                  </View>
                </Pressable>
              </View>
            </>
          )}

          {scoreSubmitted && <Text style={[styles.modalLine, styles.centeredText]}>✅ Score saved!</Text>}

          <Pressable style={styles.buttonSecondaryFull} onPress={onViewChain}>
            <Text style={styles.buttonSecondaryText}>🔗 VIEW FULL CHAIN</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={onDone}>
            <Text style={styles.buttonText}>SEE HIGH SCORES ▶</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ResultModal({
  game,
  result,
  strikes,
  onContinue,
}: {
  game: MovieLadder;
  result: PendingResult;
  strikes: number;
  onContinue: () => void;
}) {
  const { correct, pickedId, correctId, previousId, matches, isBet, tileValue } = result;
  const previousTitle = game.movie(previousId).title;
  const correctTitle = game.movie(correctId).title;
  const pickedTitle = game.movie(pickedId).title;
  const matchLines = formatMatches(matches);
  // Strikes state doesn't update until the player taps CONTINUE (see
  // confirmPick), so this pick's own tally has to be computed here rather
  // than read off the live count. Bet floors no longer change the strike
  // cost -- a miss always costs 1, whether or not a bet is riding on the
  // floor (see the constants comment at the top of this file).
  const displayStrikes = correct ? strikes : Math.min(MAX_STRIKES, strikes + 1);
  // A wrong answer on a bet floor doesn't just score 0, it subtracts double
  // the tile's value (see BET_LOSS_PENALTY_MULTIPLIER), so the modal has to
  // show a negative rather than the usual "+0 points".
  const points = correct ? tileValue : -(isBet ? BET_LOSS_PENALTY_MULTIPLIER * tileValue : 0);

  return (
    <Modal transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView style={styles.modalScroll}>
            <Text style={[styles.modalTitle, { color: correct ? colors.green : colors.red }]}>
              {correct ? 'Correct!' : 'Not quite.'}
            </Text>
            <Text
              style={[
                styles.modalScore,
                { color: correct ? colors.green : points < 0 ? colors.red : colors.textSecondary },
              ]}
            >
              {points >= 0 ? '+' : '−'}
              {Math.abs(points)} point{Math.abs(points) === 1 ? '' : 's'}
              {points < 0 ? ' (bet floor — wrong answers cost double)' : ''}
            </Text>
            {!correct && (
              <Text style={styles.modalLine}>
                {pickedTitle} doesn’t connect to {previousTitle} by anything in the data. The
                correct movie, {correctTitle}, has been placed on the ladder for you
                automatically.
              </Text>
            )}
            <Text style={styles.modalLine}>
              {correctTitle} connects to {previousTitle} by:
            </Text>
            {matchLines.map((line, i) => (
              <Text key={i} style={styles.modalLine}>
                • {line}
              </Text>
            ))}
            {!correct && (
              <Text style={[styles.modalLine, styles.modalStrikes]}>
                {displayStrikes}/{MAX_STRIKES} strikes used.
                {isBet ? ' The bet is lost — this floor’s completion bonus is forfeited.' : ''}
              </Text>
            )}
          </ScrollView>
          <Pressable style={styles.button} onPress={onContinue}>
            <Text style={styles.buttonText}>CONTINUE ▶</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 48 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.headerBackground,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 8,
  },
  headerText: {
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 18,
    letterSpacing: 2,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  leaderboardButtonText: {
    color: colors.yellow,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  quitButtonText: { color: colors.textSecondary },
  // Pinned above the scrollable board, like chart-ladder's own
  // LEVEL/SCORE subheader, so it stays visible regardless of scroll
  // position -- the whole point of "prominently."
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.boardBackground,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  statusText: {
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  statusTextDanger: {
    color: colors.red,
  },
  statusTextMode: {
    color: colors.textSecondary,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1.2,
  },
  // --- mode select ---
  modeSelectTitle: {
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: 18,
  },
  modeCard: {
    backgroundColor: colors.headerBackground,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.cellBorder,
    padding: 18,
    marginBottom: 14,
    maxWidth: MAX_BOARD_WIDTH,
    width: '100%',
    alignSelf: 'center',
  },
  modeCardTitle: {
    color: colors.pink,
    fontWeight: '800',
    fontSize: 20,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  modeCardBlurb: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  modeCardMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  modeSelectFootnote: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
    maxWidth: MAX_BOARD_WIDTH,
    alignSelf: 'center',
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  label: {
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 6,
  },
  betRoundBanner: {
    color: colors.yellow,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 16,
  },
  result: {
    marginTop: 12,
    textAlign: 'center',
    color: colors.textPrimary,
    fontSize: 13,
  },
  candidatesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    // Lines up with the board's own edges on a wide (computer-sized)
    // screen instead of stretching past them -- LadderStack caps itself
    // the same way.
    maxWidth: MAX_BOARD_WIDTH,
    alignSelf: 'center',
  },
  // Wider than an even 1/3-way split (33%) would look with space-between's
  // full gap, but not packed edge-to-edge either -- 30% keeps a slim gap
  // between tiles while the row's own maxWidth/alignSelf (above) still
  // pins the first and last tile's outer edges to the board's edges.
  candidateSlot: {
    width: '30%',
  },
  milestoneBanner: {
    marginTop: 16,
    alignItems: 'center',
    backgroundColor: colors.headerBackground,
    borderRadius: 10,
    padding: 16,
  },
  milestoneText: {
    color: colors.green,
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.5,
    marginBottom: 8,
    textAlign: 'center',
  },
  milestoneScore: {
    color: colors.yellow,
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 14,
    textAlign: 'center',
  },
  betLine: {
    color: colors.textPrimary,
    fontSize: 13,
    marginBottom: 4,
    textAlign: 'center',
  },
  betButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    width: '100%',
  },
  betButtonSlot: {
    flex: 1,
  },
  button: {
    backgroundColor: colors.pink,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  buttonBet: {
    backgroundColor: colors.yellow,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  // Dark text on the gold button -- the shared white buttonText style
  // reads poorly against yellow.
  buttonBetText: { color: colors.background, fontWeight: '800', letterSpacing: 1 },
  buttonSecondary: {
    backgroundColor: colors.cellEmpty,
    borderWidth: 1.5,
    borderColor: colors.cellBorder,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonSecondaryFull: {
    backgroundColor: colors.cellEmpty,
    borderWidth: 1.5,
    borderColor: colors.cellBorder,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    width: '100%',
    marginTop: 14,
    marginBottom: 10,
  },
  buttonText: { color: '#fff', fontWeight: '800', letterSpacing: 1 },
  buttonDisabled: { opacity: 0.5 },
  buttonSecondaryText: { color: colors.textSecondary, fontWeight: '800', letterSpacing: 1 },
  initialsInput: {
    backgroundColor: colors.cellEmpty,
    borderWidth: 1.5,
    borderColor: colors.cellBorder,
    borderRadius: 8,
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 4,
    textAlign: 'center',
    paddingVertical: 10,
    width: 100,
    marginBottom: 12,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.cellBorder,
  },
  leaderboardRank: {
    width: 28,
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: 14,
  },
  leaderboardName: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 1,
  },
  leaderboardScore: {
    color: colors.yellow,
    fontWeight: '800',
    fontSize: 15,
  },
  chainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  chainRank: {
    width: 24,
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: 12,
  },
  chainCopy: { flex: 1 },
  chainTitle: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 13,
  },
  chainMeta: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  chainLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  chainLinkLine: {
    width: 24,
    textAlign: 'center',
    color: colors.blue,
    fontWeight: '900',
  },
  chainReason: {
    flex: 1,
    color: colors.blue,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 8, 18, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.headerBackground,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.cellBorder,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
  },
  modalScroll: { flexShrink: 1 },
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  modalScore: { fontSize: 14, fontWeight: '800', marginBottom: 10 },
  modalLine: { fontSize: 14, lineHeight: 20, marginBottom: 4, color: colors.textPrimary },
  modalStrikes: { marginTop: 8, fontWeight: '700', color: colors.red },
  // ResultModal/LeaderboardModal's text is deliberately left-aligned (it's
  // reading prose), but the score-submit modal's content is short status
  // lines + a centered input, so it opts into centering instead of that
  // shared default.
  scoreSubmitCard: { alignItems: 'center' },
  centeredText: { textAlign: 'center' },
});
