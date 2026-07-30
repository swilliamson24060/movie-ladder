import { useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import connectionsData from './assets/data/connections.json';
import { MovieLadder, Round } from './src/movieLadder';
import TutorialScreen from './src/TutorialScreen';
import MovieCell from './src/components/MovieCell';
import { colors } from './src/theme';

// Scaffold: proves the data pipeline -> engine -> app wiring works end to
// end (loads connections.json, builds real rounds) and hosts the real
// tutorial component. The actual game session (strikes, scoring,
// milestones, betting) is not built yet -- see CLAUDE.md section 9.
export default function App() {
  const game = useMemo(() => new MovieLadder(connectionsData as any), []);
  const [showTutorial, setShowTutorial] = useState(true);

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      {showTutorial ? (
        <TutorialScreen game={game} onDone={() => setShowTutorial(false)} />
      ) : (
        <PlaceholderGame game={game} />
      )}
    </View>
  );
}

function PlaceholderGame({ game }: { game: MovieLadder }) {
  const [currentId, setCurrentId] = useState(() => game.randomMovie());
  const [round, setRound] = useState<Round | null>(() => game.buildRound(currentId));
  const [lastResult, setLastResult] = useState<string | null>(null);

  function pick(candidateId: number) {
    if (!round) return;
    if (candidateId === round.correctId) {
      const lines = Object.entries(round.matches).map(
        ([type, values]) => `${type}: ${values.join(', ')}`
      );
      setLastResult(`Correct! ${lines.join(' / ')}`);
    } else {
      setLastResult('Wrong -- placing the correct movie anyway.');
    }
    const nextId = round.correctId;
    setCurrentId(nextId);
    setRound(game.buildRound(nextId));
  }

  const current = game.movie(currentId);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>MOVIE LADDER</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.board}>
          <MovieCell title={current.title} year={current.year} state="current" big />
          <Text style={styles.label}>WHICH MOVIE CONNECTS TO THIS ONE?</Text>
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
            <Text style={styles.result}>Dead end -- no valid round from this movie.</Text>
          )}
          {lastResult && <Text style={styles.result}>{lastResult}</Text>}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 48 },
  scrollContent: { paddingBottom: 24 },
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
  board: {
    backgroundColor: colors.boardBackground,
    borderRadius: 10,
    padding: 14,
  },
  label: {
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginVertical: 10,
  },
  result: {
    marginTop: 12,
    textAlign: 'center',
    color: colors.textPrimary,
    fontSize: 13,
  },
});
