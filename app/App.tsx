import { useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import connectionsData from './assets/data/connections.json';
import { MovieLadder, Round } from './src/movieLadder';
import TutorialScreen from './src/TutorialScreen';
import MovieCell from './src/components/MovieCell';
import LadderStack, { MAX_STACK_TILES } from './src/components/LadderStack';
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

function GameScreen({ game }: { game: MovieLadder }) {
  const [stack, setStack] = useState<number[]>(() => [game.randomMovie()]);
  const currentId = stack[stack.length - 1];
  const [round, setRound] = useState<Round | null>(() => game.buildRound(currentId));
  const [lastResult, setLastResult] = useState<string | null>(null);
  // True once a group of 5 is showing, from the pick that completed it until
  // the player taps CONTINUE -- no round is built for the 6th movie until
  // the pause is dismissed and the slide-down finishes (CLAUDE.md section
  // 5b's milestone scroll-off).
  const [milestone, setMilestone] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  function pick(candidateId: number) {
    if (!round) return;

    if (candidateId === round.correctId) {
      const lines = Object.entries(round.matches).map(
        ([type, values]) => `${type.replace(/_/g, ' ')}: ${values.join(', ')}`
      );
      setLastResult(`Correct! ${lines.join(' / ')}`);
    } else {
      setLastResult('Not a connection — the correct movie was placed for you.');
    }

    // The chain always advances, right or wrong (CLAUDE.md section 5b).
    const nextId = round.correctId;
    const newStack = [...stack, nextId];
    setStack(newStack);

    if (newStack.length >= MAX_STACK_TILES) {
      // Pause on a full board rather than building the next round --
      // continueAfterMilestone() builds it once the player has seen the
      // completed group and the slide-down has cleared it away.
      setRound(null);
      setMilestone(true);
    } else {
      setRound(game.buildRound(nextId));
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

            {lastResult && <Text style={styles.result}>{lastResult}</Text>}
          </>
        )}
      </ScrollView>
    </View>
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
});
