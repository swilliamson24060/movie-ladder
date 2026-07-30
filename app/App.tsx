import { useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Pressable } from 'react-native';

import connectionsData from './assets/data/connections.json';
import { MovieLadder, Round } from './src/movieLadder';
import TutorialScreen from './src/TutorialScreen';

// Scaffold: proves the data pipeline -> engine -> app wiring works end to
// end (loads connections.json, builds real rounds) and hosts the real
// tutorial component. The actual game session (strikes, scoring,
// milestones, betting) is not built yet -- see CLAUDE.md section 9.
export default function App() {
  const game = useMemo(() => new MovieLadder(connectionsData as any), []);
  const [showTutorial, setShowTutorial] = useState(true);

  if (showTutorial) {
    return <TutorialScreen game={game} onDone={() => setShowTutorial(false)} />;
  }

  return <PlaceholderGame game={game} />;
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
      <StatusBar style="auto" />
      <Text style={styles.header}>Movie Ladder (scaffold)</Text>
      <Text style={styles.current}>
        {current.title} ({current.year})
      </Text>
      <Text style={styles.label}>Which movie connects to this one?</Text>
      {round ? (
        round.candidateIds.map((id) => {
          const m = game.movie(id);
          return (
            <Pressable key={id} style={styles.candidate} onPress={() => pick(id)}>
              <Text>
                {m.title} ({m.year})
              </Text>
            </Pressable>
          );
        })
      ) : (
        <Text>Dead end -- no valid round from this movie.</Text>
      )}
      {lastResult && <Text style={styles.result}>{lastResult}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  header: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
  },
  current: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  label: {
    marginBottom: 12,
  },
  candidate: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginVertical: 6,
    width: '100%',
  },
  result: {
    marginTop: 16,
    textAlign: 'center',
  },
});
