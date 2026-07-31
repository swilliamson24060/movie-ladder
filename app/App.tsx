import { useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import connectionsData from './assets/data/connections.json';
import { MovieLadder, Round } from './src/movieLadder';
import TutorialScreen from './src/TutorialScreen';
import MovieCell from './src/components/MovieCell';
import LadderStack, { MAX_BOARD_WIDTH, MAX_STACK_TILES } from './src/components/LadderStack';
import { formatMatches } from './src/tutorial';
import { colors } from './src/theme';

const SLIDE_DURATION_MS = 450;

// CLAUDE.md section 5b's scoring/strikes/betting spec, implemented here:
// +1 point per correct tile; +5 for completing a 5-tile floor; +10 more on
// top of that if the floor had zero strikes; 5 strikes ends the run.
// Betting: offered once per completed floor (from floor 2 onward -- see
// the interview this was built from, not a CLAUDE.md-decided number) as a
// stake on the very next pick. Win pays 10x that pick's normal point
// value; lose costs 2 strikes instead of 1. No blocking even when a loss
// would end the run -- CLAUDE.md is explicit that's intentional.
const MAX_STRIKES = 5;
const FLOOR_BASE_BONUS = 5;
const FLOOR_NO_STRIKE_BONUS = 10;
const BET_WIN_MULTIPLIER = 10;
const BET_LOSE_STRIKES = 2;
// Skip the bet offer after the very first floor, so a new player gets one
// clean floor before stakes show up (decided in the interview for this
// feature, not part of CLAUDE.md's original spec).
const FLOORS_BEFORE_BETTING = 1;

export default function App() {
  const game = useMemo(() => new MovieLadder(connectionsData as any), []);
  const [showTutorial, setShowTutorial] = useState(true);

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      {showTutorial ? (
        <TutorialScreen game={game} onDone={() => setShowTutorial(false)} />
      ) : (
        <GameScreen game={game} />
      )}
    </View>
  );
}

interface PendingResult {
  correct: boolean;
  pickedId: number;
  correctId: number;
  previousId: number;
  matches: Record<string, string[]>;
  isBet: boolean;
}

function GameScreen({ game }: { game: MovieLadder }) {
  const [stack, setStack] = useState<number[]>(() => [game.randomMovie()]);
  const currentId = stack[stack.length - 1];
  const [round, setRound] = useState<Round | null>(() => game.buildRound(currentId));
  // Set the instant a candidate is tapped, cleared once the player dismisses
  // the result modal -- every pick gets this, right or wrong, per the "more
  // prominent notice on correctness" request. Advancing the stack/round
  // waits for that dismissal (see confirmPick), so the connection is always
  // shown before the board moves on.
  const [pendingResult, setPendingResult] = useState<PendingResult | null>(null);
  // True once a group of 5 is showing, from the pick that completed it until
  // the player taps CONTINUE -- no round is built for the 6th movie until
  // the pause is dismissed and the slide-down finishes (CLAUDE.md section
  // 5b's milestone scroll-off).
  const [milestone, setMilestone] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const [score, setScore] = useState(0);
  const [strikes, setStrikes] = useState(0);
  // Whether any wrong pick has happened in the group of 5 currently being
  // built -- resets every time a floor completes. Decides that floor's
  // +10 no-strike bonus, independent of the run's total strike count.
  const [groupHadStrike, setGroupHadStrike] = useState(false);
  // Points the most recently completed floor earned, shown in the
  // milestone banner. Only meaningful while `milestone` is true.
  const [floorScore, setFloorScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  // How many floors have been completed this run -- gates the bet offer
  // (skips after floor 1) rather than tracking a separate boolean.
  const [floorsCompleted, setFloorsCompleted] = useState(0);
  // True while the bet-offer step (BET / NO THANKS) is showing, right
  // after a floor's slide-down finishes and before the next round builds.
  const [betOffer, setBetOffer] = useState(false);
  // True only for the single round the player staked a bet on -- reset the
  // instant that round resolves, win or lose.
  const [isBetRound, setIsBetRound] = useState(false);

  function pick(candidateId: number) {
    if (!round) return;
    setPendingResult({
      correct: candidateId === round.correctId,
      pickedId: candidateId,
      correctId: round.correctId,
      previousId: currentId,
      matches: round.matches,
      isBet: isBetRound,
    });
  }

  function confirmPick() {
    if (!pendingResult) return;
    const { correctId, correct, isBet } = pendingResult;
    setPendingResult(null);
    setIsBetRound(false); // a bet only ever stakes the one pick right after it's accepted

    const strikeCost = isBet ? BET_LOSE_STRIKES : 1;
    const newStrikes = correct ? strikes : Math.min(MAX_STRIKES, strikes + strikeCost);
    const thisGroupHadStrike = groupHadStrike || !correct;

    if (correct) setScore((s) => s + (isBet ? BET_WIN_MULTIPLIER : 1));
    if (!correct) setStrikes(newStrikes);

    // The chain always advances, right or wrong (CLAUDE.md section 5b).
    const newStack = [...stack, correctId];
    setStack(newStack);

    const floorComplete = newStack.length >= MAX_STACK_TILES;
    if (floorComplete) {
      const bonus = thisGroupHadStrike ? FLOOR_BASE_BONUS : FLOOR_BASE_BONUS + FLOOR_NO_STRIKE_BONUS;
      setScore((s) => s + bonus);
      setFloorScore(bonus);
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
      setRound(game.buildRound(correctId));
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
        setRound(game.buildRound(topId));
      }
    });
  }

  function resolveBetOffer(accepted: boolean) {
    setBetOffer(false);
    setIsBetRound(accepted);
    setRound(game.buildRound(stack[stack.length - 1]));
  }

  function restart() {
    const startId = game.randomMovie();
    setStack([startId]);
    setRound(game.buildRound(startId));
    setPendingResult(null);
    setMilestone(false);
    setScore(0);
    setStrikes(0);
    setGroupHadStrike(false);
    setFloorScore(0);
    setGameOver(false);
    setFloorsCompleted(0);
    setBetOffer(false);
    setIsBetRound(false);
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
            <Text style={styles.milestoneText}>🪜 ONE FLOOR COMPLETE!</Text>
            <Text style={styles.milestoneScore}>
              +{floorScore} points
              {floorScore > FLOOR_BASE_BONUS ? ' — no strikes this floor!' : ''}
            </Text>
            <Pressable style={styles.button} onPress={continueAfterMilestone}>
              <Text style={styles.buttonText}>CONTINUE ▶</Text>
            </Pressable>
          </View>
        ) : betOffer ? (
          <View style={styles.milestoneBanner}>
            <Text style={styles.milestoneText}>💰 WANT TO BET?</Text>
            <Text style={styles.betLine}>Stake a strike on your very next pick:</Text>
            <Text style={styles.betLine}>
              Win → +{BET_WIN_MULTIPLIER} points instead of +1
            </Text>
            <Text style={styles.betLine}>
              Lose → costs {BET_LOSE_STRIKES} strikes instead of 1
            </Text>
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
            {isBetRound && (
              <Text style={styles.betRoundBanner}>
                💰 BET ROUND — WIN: +{BET_WIN_MULTIPLIER} PTS · LOSE: −{BET_LOSE_STRIKES} STRIKES
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
                        state={isBetRound ? 'bet' : 'default'}
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
    </View>
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
  const { correct, pickedId, correctId, previousId, matches, isBet } = result;
  const previousTitle = game.movie(previousId).title;
  const correctTitle = game.movie(correctId).title;
  const pickedTitle = game.movie(pickedId).title;
  const matchLines = formatMatches(matches);
  const strikeCost = isBet ? BET_LOSE_STRIKES : 1;
  // Strikes state doesn't update until the player taps CONTINUE (see
  // confirmPick), so this pick's own tally has to be computed here rather
  // than read off the live count.
  const displayStrikes = correct ? strikes : Math.min(MAX_STRIKES, strikes + strikeCost);
  const points = correct ? (isBet ? BET_WIN_MULTIPLIER : 1) : 0;

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
              {isBet && correct ? ' — bet won!' : ''}
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
                {isBet ? ' (bet lost — 2 strikes)' : ''}
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
    textAlign: 'center',
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
  buttonSecondaryText: { color: colors.textSecondary, fontWeight: '800', letterSpacing: 1 },
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
});
