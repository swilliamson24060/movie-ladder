import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import connectionsData from './assets/data/connections.json';
import { MovieLadder, Round } from './src/movieLadder';
import TutorialScreen from './src/TutorialScreen';
import MovieCell from './src/components/MovieCell';
import LadderStack, { MAX_BOARD_WIDTH, MAX_STACK_TILES } from './src/components/LadderStack';
import { formatMatches } from './src/tutorial';
import { colors } from './src/theme';
import { fetchTopScores, LeaderboardEntry, submitScore, wouldQualify } from './src/leaderboard';

const SLIDE_DURATION_MS = 450;

// CLAUDE.md section 5b's scoring/strikes spec, escalating per floor
// (decided 2026-07-31, replacing the original flat-rate version): floor N
// (1-indexed) pays 5*N points per correct tile and a 10*N-point completion
// bonus, plus a flat +10 more on top of that bonus if the floor had zero
// strikes; 5 strikes ends the run.
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
const FLOOR_BONUS_PER_FLOOR = 10;
const FLOOR_NO_STRIKE_BONUS = 10;
// Skip the bet offer after the very first floor, so a new player gets one
// clean floor before stakes show up (decided in the interview for this
// feature, not part of CLAUDE.md's original spec).
const FLOORS_BEFORE_BETTING = 1;

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
const SAVE_KEY = 'movie-ladder:save-v1';
const SAVE_VERSION = 1;

interface SavedGame {
  version: number;
  stack: number[];
  history: number[];
  score: number;
  strikes: number;
  groupHadStrike: boolean;
  floorScore: number;
  // Whether the most recently completed floor (the one floorScore/
  // floorBetWon describe) had zero strikes / had its bet won -- both only
  // meaningful while `milestone` is true, persisted so a reload mid-
  // milestone-screen shows the exact same banner text.
  floorHadNoStrikes: boolean;
  floorBetWon: boolean;
  floorsCompleted: number;
  betOffer: boolean;
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
  const [savedGame] = useState<SavedGame | null>(() => loadSavedGame(game));
  // Skip the tutorial on reload if there's a run to resume -- a returning
  // player doesn't need the walkthrough again just because they refreshed.
  const [showTutorial, setShowTutorial] = useState(() => savedGame === null);

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      {showTutorial ? (
        <TutorialScreen game={game} onDone={() => setShowTutorial(false)} />
      ) : (
        <GameScreen game={game} savedGame={savedGame} />
      )}
    </View>
  );
}

function GameScreen({ game, savedGame }: { game: MovieLadder; savedGame: SavedGame | null }) {
  const [stack, setStack] = useState<number[]>(() => savedGame?.stack ?? [game.randomMovie()]);
  const currentId = stack[stack.length - 1];
  // Every movie placed on the ladder this run, across every floor -- never
  // reset by a milestone clear (only by restart()). Passed as buildRound's
  // exclude set so a connection can never loop back to an earlier rung
  // (e.g. A -> B -> A): without this, buildRound only excluded the round's
  // own current movie, and B's real connections legitimately include A.
  const [history, setHistory] = useState<Set<number>>(() => new Set(savedGame?.history ?? stack));
  const [round, setRound] = useState<Round | null>(() =>
    savedGame ? savedGame.round : game.buildRound(currentId, history)
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
  // Points the most recently completed floor earned, shown in the
  // milestone banner. Only meaningful while `milestone` is true.
  const [floorScore, setFloorScore] = useState(() => savedGame?.floorScore ?? 0);
  const [floorHadNoStrikes, setFloorHadNoStrikes] = useState(
    () => savedGame?.floorHadNoStrikes ?? false
  );
  const [floorBetWon, setFloorBetWon] = useState(() => savedGame?.floorBetWon ?? false);
  const [gameOver, setGameOver] = useState(() => savedGame?.gameOver ?? false);
  // How many floors have been completed this run -- gates the bet offer
  // (skips after floor 1) rather than tracking a separate boolean.
  const [floorsCompleted, setFloorsCompleted] = useState(() => savedGame?.floorsCompleted ?? 0);
  // True while the bet-offer step (BET / NO THANKS) is showing, right
  // after a floor's slide-down finishes and before the next round builds.
  const [betOffer, setBetOffer] = useState(() => savedGame?.betOffer ?? false);
  // True for every round of the entire next floor once a bet is accepted
  // (win condition: complete that floor with zero strikes) -- flips back
  // to false the instant a strike breaks it, or once the floor resolves.
  const [isBetFloor, setIsBetFloor] = useState(() => savedGame?.isBetFloor ?? false);

  // High-score leaderboard: modal visibility + its data (null = loading /
  // not yet fetched), openable any time via the header button regardless
  // of run state.
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[] | null>(null);
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
    wouldQualify(score).then((qualifies) => {
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
      stack,
      history: [...history],
      score,
      strikes,
      groupHadStrike,
      floorScore,
      floorHadNoStrikes,
      floorBetWon,
      floorsCompleted,
      betOffer,
      isBetFloor,
      milestone,
      gameOver,
      round,
      pendingResult,
      scoreSubmitted,
    });
  }, [
    game,
    stack,
    history,
    score,
    strikes,
    groupHadStrike,
    floorScore,
    floorHadNoStrikes,
    floorBetWon,
    floorsCompleted,
    betOffer,
    isBetFloor,
    milestone,
    gameOver,
    round,
    pendingResult,
    scoreSubmitted,
  ]);

  function openLeaderboard() {
    setShowLeaderboard(true);
    setLeaderboardEntries(null);
    fetchTopScores().then(setLeaderboardEntries);
  }

  async function handleSubmitScore() {
    if (initials.length === 0 || submittingScore) return;
    setSubmittingScore(true);
    await submitScore(initials, score);
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

    if (correct) setScore((s) => s + tileValue);
    if (!correct) setStrikes(newStrikes);

    // A strike permanently forfeits this floor's bet -- winning requires
    // finishing with zero strikes, so once one happens there's nothing
    // left to preserve. Turning the bet off immediately (rather than
    // waiting for the floor to finish) stops the gold "bet floor" marking
    // on the rest of this floor's rounds, which would otherwise misleadingly
    // suggest the bet is still winnable.
    if (isBetFloor && !correct) setIsBetFloor(false);

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
      const completionBonus = FLOOR_BONUS_PER_FLOOR * floorNum + noStrikeBonus;
      // isBetFloor here reflects the outcome of every earlier pick this
      // floor (it would already be false if any of them missed -- see
      // above), so "still true AND this pick was correct too" is exactly
      // "zero strikes across the whole floor," the bet's win condition.
      const betWon = isBetFloor && correct && !thisGroupHadStrike;
      const bonus = betWon ? completionBonus * 2 : completionBonus;
      setScore((s) => s + bonus);
      setFloorScore(bonus);
      setFloorHadNoStrikes(!thisGroupHadStrike);
      setFloorBetWon(betWon);
      setIsBetFloor(false);
      setGroupHadStrike(false);
      setFloorsCompleted((n) => n + 1);
    } else {
      setGroupHadStrike(thisGroupHadStrike);
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
      setRound(game.buildRound(correctId, newHistory));
    }
  }

  function continueAfterMilestone() {
    // Decided synchronously, in direct response to the tap, rather than
    // re-read from state inside the .start() callback below -- state
    // setters called from that delayed callback were observed not to take
    // effect reliably on web (useNativeDriver falls back to a JS/rAF-driven
    // animation there). Capturing a plain boolean here sidesteps it.
    const offerBet = floorsCompleted > FLOORS_BEFORE_BETTING;
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: SLIDE_DURATION_MS,
      useNativeDriver: true,
    }).start(() => {
      const topId = stack[stack.length - 1];
      setStack([topId]);
      setMilestone(false);
      slideAnim.setValue(0);

      if (offerBet) {
        setBetOffer(true);
      } else {
        setRound(game.buildRound(topId, history));
      }
    });
  }

  function resolveBetOffer(accepted: boolean) {
    setBetOffer(false);
    setIsBetFloor(accepted);
    setRound(game.buildRound(stack[stack.length - 1], history));
  }

  function restart() {
    const startId = game.randomMovie();
    const startHistory = new Set([startId]);
    setStack([startId]);
    setHistory(startHistory);
    setRound(game.buildRound(startId, startHistory));
    setPendingResult(null);
    setMilestone(false);
    setScore(0);
    setStrikes(0);
    setGroupHadStrike(false);
    setFloorScore(0);
    setFloorHadNoStrikes(false);
    setFloorBetWon(false);
    setGameOver(false);
    setFloorsCompleted(0);
    setBetOffer(false);
    setIsBetFloor(false);
    setScoreQualifies(false);
    setScoreSubmitted(false);
    setInitials('');
    setSubmittingScore(false);
    slideAnim.setValue(0);
  }

  const stackMovies = stack.map((id) => {
    const m = game.movie(id);
    return { title: m.title, year: m.year };
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>MOVIE LADDER</Text>
        <Pressable onPress={openLeaderboard}>
          <Text style={styles.leaderboardButtonText}>🏆 SCORES</Text>
        </Pressable>
      </View>

      <View style={styles.statusBar}>
        <Text style={styles.statusText}>SCORE: {score}</Text>
        <Text style={[styles.statusText, strikes > 0 && styles.statusTextDanger]}>
          STRIKES: {strikes}/{MAX_STRIKES}
        </Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <LadderStack movies={stackMovies} slideProgress={slideAnim} />

        {gameOver ? (
          <View style={styles.milestoneBanner}>
            <Text style={[styles.milestoneText, { color: colors.red }]}>RUN OVER</Text>
            <Text style={styles.milestoneScore}>Final score: {score}</Text>
            <Pressable style={styles.button} onPress={restart}>
              <Text style={styles.buttonText}>PLAY AGAIN ▶</Text>
            </Pressable>
          </View>
        ) : milestone ? (
          <View style={styles.milestoneBanner}>
            <Text style={styles.milestoneText}>🪜 FLOOR {floorsCompleted} COMPLETE!</Text>
            <Text style={styles.milestoneScore}>
              +{floorScore} points
              {floorBetWon
                ? ' — bet won, completion bonus doubled!'
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
            <Text style={styles.betLine}>Miss even once and the bet's off — strikes cost their</Text>
            <Text style={styles.betLine}>normal amount either way.</Text>
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
        ) : (
          <>
            {isBetFloor && (
              <Text style={styles.betRoundBanner}>
                💰 BET FLOOR — ZERO STRIKES DOUBLES THIS FLOOR’S COMPLETION BONUS
              </Text>
            )}
            <Text style={styles.label}>WHICH MOVIE CONNECTS TO THE TOP TILE?</Text>

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
                        state={isBetFloor ? 'bet' : 'default'}
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
        <LeaderboardModal entries={leaderboardEntries} onClose={() => setShowLeaderboard(false)} />
      )}

      {gameOver && scoreQualifies && !scoreSubmitted && (
        <ScoreSubmitModal
          score={score}
          initials={initials}
          onChangeInitials={setInitials}
          submitting={submittingScore}
          onSubmit={handleSubmitScore}
          onSkip={handleSkipScoreSubmit}
        />
      )}
    </View>
  );
}

function LeaderboardModal({
  entries,
  onClose,
}: {
  entries: LeaderboardEntry[] | null;
  onClose: () => void;
}) {
  return (
    <Modal transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>🏆 HIGH SCORES</Text>
          {entries === null ? (
            <Text style={styles.modalLine}>Loading…</Text>
          ) : entries.length === 0 ? (
            <Text style={styles.modalLine}>
              No scores yet — be the first! (Or the leaderboard isn’t configured yet.)
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
  const points = correct ? tileValue : 0;

  return (
    <Modal transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView style={styles.modalScroll}>
            <Text style={[styles.modalTitle, { color: correct ? colors.green : colors.red }]}>
              {correct ? 'Correct!' : 'Not quite.'}
            </Text>
            <Text style={[styles.modalScore, { color: correct ? colors.green : colors.textSecondary }]}>
              +{points} point{points === 1 ? '' : 's'}
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
                {isBet ? ' This also forfeits this floor’s bet.' : ''}
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
  leaderboardButtonText: {
    color: colors.yellow,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },
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
