import { useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import connectionsData from './assets/data/connections.json';
import { MovieLadder, Round } from './src/movieLadder';
import TutorialScreen from './src/TutorialScreen';
import MovieCell from './src/components/MovieCell';
import LadderStack, { MAX_STACK_TILES } from './src/components/LadderStack';
import { colors } from './src/theme';

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
    setStack((s) =>
      // A completed group of 5 clears off the board, leaving only the top
      // tile to keep building from (section 5b's milestone scroll-off).
      s.length >= MAX_STACK_TILES ? [s[s.length - 1], nextId] : [...s, nextId]
    );
    setRound(game.buildRound(nextId));
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
        <LadderStack movies={stackMovies} />

        <Text style={styles.label}>WHICH MOVIE CONNECTS TO THE TOP TILE?</Text>

        {round ? (
          round.candidateIds.map((id) => {
            const m = game.movie(id);
            return (
              <MovieCell
                key={id}
                title={m.title}
                year={m.year}
                onPress={() => pick(id)}
              />
            );
          })
        ) : (
          <Text style={styles.result}>Dead end — no valid round from this movie.</Text>
        )}

        {lastResult && <Text style={styles.result}>{lastResult}</Text>}
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
});
