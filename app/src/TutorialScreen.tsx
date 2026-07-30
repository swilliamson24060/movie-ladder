import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MovieLadder } from './movieLadder';
import { colors } from './theme';
import MovieCell from './components/MovieCell';
import LadderStack from './components/LadderStack';
import {
  buildTutorialScript,
  COPY,
  EXPLAIN_MODAL_MIN_MS,
  formatMatches,
  Phase,
  PHASE_ORDER,
} from './tutorial';

export default function TutorialScreen({
  game,
  onDone,
}: {
  game: MovieLadder;
  onDone: () => void;
}) {
  const script = useMemo(() => buildTutorialScript(game), [game]);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const phase: Phase = PHASE_ORDER[phaseIndex];

  function advance() {
    if (phase === 'done') {
      onDone();
      return;
    }
    setPhaseIndex((i) => Math.min(i + 1, PHASE_ORDER.length - 1));
  }

  function skip() {
    onDone();
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>TUTORIAL</Text>
        <Pressable onPress={skip}>
          <Text style={styles.skip}>SKIP ✕</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.board}>
          <Board phase={phase} script={script} game={game} />
        </View>
      </ScrollView>

      {(phase === 'intro' ||
        phase === 'pick-correct' ||
        phase === 'pick-wrong' ||
        phase === 'milestone' ||
        phase === 'betting' ||
        phase === 'strikes' ||
        phase === 'done') && (
        <StaticPhasePanel phase={phase} onAdvance={advance} />
      )}

      {phase === 'explain-correct' && (
        <ExplainModal
          title={COPY['explain-correct'].title!}
          lines={[
            ...formatMatches(script.correctRound1),
            '',
            '+1 point. All matching connections are always shown, even when there’s more than one — you don’t have to guess which one "counts."',
          ]}
          button={COPY['explain-correct'].button}
          onAdvance={advance}
        />
      )}

      {phase === 'explain-wrong' && (
        <ExplainModal
          title={COPY['explain-wrong'].title!}
          lines={[
            'Home Alone doesn’t connect to Kill Bill: Volume 1 by anything in the data. The correct movie, Kill Bill: Volume 2, has been placed on the ladder for you automatically — the chain always keeps moving, whether you get a round right or not.',
            '',
            'Kill Bill: Volume 2 connects to Kill Bill: Volume 1 by:',
            ...formatMatches(script.correctRound2).map((l) => `• ${l}`),
            '',
            '1/5 strikes used. Miss five and the run ends — more on that shortly.',
          ]}
          button={COPY['explain-wrong'].button}
          onAdvance={advance}
        />
      )}
    </View>
  );
}

function Board({
  phase,
  script,
  game,
}: {
  phase: Phase;
  script: ReturnType<typeof buildTutorialScript>;
  game: MovieLadder;
}) {
  const m = (id: number) => game.movie(id);

  if (phase === 'intro') {
    const cur = m(script.pulpFiction);
    return <MovieCell title={cur.title} year={cur.year} state="current" big />;
  }
  if (phase === 'pick-correct' || phase === 'explain-correct') {
    const cur = m(script.pulpFiction);
    return (
      <>
        <MovieCell title={cur.title} year={cur.year} state="current" big />
        <View style={styles.candidates}>
          {[
            { id: script.killBill1, highlight: true },
            { id: script.harryPotter1, highlight: false },
            { id: script.guardiansOfTheGalaxy, highlight: false },
          ].map(({ id, highlight }) => {
            const movie = m(id);
            return (
              <MovieCell
                key={id}
                title={movie.title}
                year={movie.year}
                state={highlight ? 'correct' : 'default'}
              />
            );
          })}
        </View>
      </>
    );
  }
  if (phase === 'pick-wrong' || phase === 'explain-wrong') {
    const cur = m(script.killBill1);
    return (
      <>
        <MovieCell title={cur.title} year={cur.year} state="current" big />
        <View style={styles.candidates}>
          {[
            { id: script.killBill2, highlight: false },
            { id: script.backToTheFuture, highlight: phase === 'pick-wrong' },
            { id: script.homeAlone, highlight: false },
          ].map(({ id, highlight }) => {
            const movie = m(id);
            return (
              <MovieCell
                key={id}
                title={movie.title}
                year={movie.year}
                state={highlight ? 'wrong' : 'default'}
              />
            );
          })}
        </View>
      </>
    );
  }
  if (phase === 'milestone' || phase === 'done') {
    // Only 3 real movies are scripted for this tutorial (see
    // buildTutorialScript) -- the remaining 2 slots of the 5-tile milestone
    // grid render as empty ghost squares rather than inventing titles for
    // movies 4 and 5.
    const stack = [script.pulpFiction, script.killBill1, script.killBill2].map((id) => {
      const movie = m(id);
      return { title: movie.title, year: movie.year };
    });
    return <LadderStack movies={stack} />;
  }
  return null;
}

function StaticPhasePanel({ phase, onAdvance }: { phase: Phase; onAdvance: () => void }) {
  const copy = COPY[phase];
  return (
    <View style={styles.panel}>
      <Text style={styles.body}>{copy.body}</Text>
      <Pressable style={styles.button} onPress={onAdvance}>
        <Text style={styles.buttonText}>{copy.button}</Text>
      </Pressable>
    </View>
  );
}

function ExplainModal({
  title,
  lines,
  button,
  onAdvance,
}: {
  title: string;
  lines: string[];
  button: string;
  onAdvance: () => void;
}) {
  const [canContinue, setCanContinue] = useState(false);

  useEffect(() => {
    setCanContinue(false);
    const t = setTimeout(() => setCanContinue(true), EXPLAIN_MODAL_MIN_MS);
    return () => clearTimeout(t);
  }, [title, lines.join('|')]);

  return (
    <Modal transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView style={styles.modalScroll}>
            <Text style={styles.modalTitle}>{title}</Text>
            {lines.map((line, i) => (
              <Text key={i} style={styles.modalLine}>
                {line}
              </Text>
            ))}
          </ScrollView>
          <Pressable
            disabled={!canContinue}
            style={[styles.button, !canContinue && styles.buttonDisabled]}
            onPress={onAdvance}
          >
            <Text style={styles.buttonText}>{canContinue ? button : '...'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 48 },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingBottom: 12 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.headerBackground,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 16,
  },
  headerText: {
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 1.5,
  },
  skip: {
    color: colors.textSecondary,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  board: {
    backgroundColor: colors.boardBackground,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  candidates: { gap: 0, marginTop: 4 },
  panel: { marginTop: 'auto', paddingBottom: 16 },
  body: { fontSize: 15, lineHeight: 21, marginBottom: 16, color: colors.textSecondary },
  button: {
    backgroundColor: colors.pink,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: colors.cellBorder },
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
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10, color: colors.textPrimary },
  modalLine: { fontSize: 14, lineHeight: 20, marginBottom: 4, color: colors.textPrimary },
});
