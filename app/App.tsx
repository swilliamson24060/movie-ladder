import { useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import connectionsData from './assets/data/connections.json';
import { MovieLadder, Round } from './src/movieLadder';
import TutorialScreen from './src/TutorialScreen';
import MovieCell from './src/components/MovieCell';
import LadderStack, { MAX_STACK_TILES } from './src/components/LadderStack';
import { formatMatches } from './src/tutorial';
import { colors } from './src/theme';

const SLIDE_DURATION_MS = 450;

// The board and round loop are real (see src/movieLadder.ts + LadderStack).
// Strikes, scoring, and betting from CLAUDE.md section 5b are NOT built yet.
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

  function pick(candidateId: number) {
    if (!round) return;
    setPendingResult({
      correct: candidateId === round.correctId,
      pickedId: candidateId,
      correctId: round.correctId,
      previousId: currentId,
      matches: round.matches,
    });
  }

  function confirmPick() {
    if (!pendingResult) return;
    const { correctId } = pendingResult;
    setPendingResult(null);

    // The chain always advances, right or wrong (CLAUDE.md section 5b).
    const newStack = [...stack, correctId];
    setStack(newStack);

    if (newStack.length >= MAX_STACK_TILES) {
      // Pause on a full board rather than building the next round --
      // continueAfterMilestone() builds it once the player has seen the
      // completed group and the slide-down has cleared it away.
      setRound(null);
      setMilestone(true);
    } else {
      setRound(game.buildRound(correctId));
    }
  }

  function continueAfterMilestone() {
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: SLIDE_DURATION_MS,
      useNativeDriver: true,
    }).start(() => {
      const topId = stack[stack.length - 1];
      setStack([topId]);
      setRound(game.buildRound(topId));
      setMilestone(false);
      slideAnim.setValue(0);
    });
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

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <LadderStack movies={stackMovies} slideProgress={slideAnim} />

        {milestone ? (
          <View style={styles.milestoneBanner}>
            <Text style={styles.milestoneText}>🪜 ONE FLOOR COMPLETE!</Text>
            <Pressable style={styles.button} onPress={continueAfterMilestone}>
              <Text style={styles.buttonText}>CONTINUE ▶</Text>
            </Pressable>
          </View>
        ) : (
          <>
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
        <ResultModal game={game} result={pendingResult} onContinue={confirmPick} />
      )}
    </View>
  );
}

function ResultModal({
  game,
  result,
  onContinue,
}: {
  game: MovieLadder;
  result: PendingResult;
  onContinue: () => void;
}) {
  const { correct, pickedId, correctId, previousId, matches } = result;
  const previousTitle = game.movie(previousId).title;
  const correctTitle = game.movie(correctId).title;
  const pickedTitle = game.movie(pickedId).title;
  const matchLines = formatMatches(matches);

  return (
    <Modal transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView style={styles.modalScroll}>
            <Text style={[styles.modalTitle, { color: correct ? colors.green : colors.red }]}>
              {correct ? 'Correct!' : 'Not quite.'}
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
    marginBottom: 16,
  },
  headerText: {
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 18,
    letterSpacing: 2,
    textAlign: 'center',
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
  result: {
    marginTop: 12,
    textAlign: 'center',
    color: colors.textPrimary,
    fontSize: 13,
  },
  candidatesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  candidateSlot: {
    flex: 1,
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
    marginBottom: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.pink,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '800', letterSpacing: 1 },
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
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
  modalLine: { fontSize: 14, lineHeight: 20, marginBottom: 4, color: colors.textPrimary },
});
