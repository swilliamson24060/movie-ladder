import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MovieLadder } from './movieLadder';
import { colors } from './theme';
import MovieCell from './components/MovieCell';
import LadderStack, { MAX_BOARD_WIDTH } from './components/LadderStack';
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
            'Back to the Future doesn’t connect to Kill Bill: Volume 1 by anything in the data. The correct movie, Kill Bill: Volume 2, has been placed on the ladder for you automatically — the chain always keeps moving, whether you get a round right or not.',
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
  const asStack = (ids: number[]) =>
    ids.map((id) => {
      const movie = m(id);
      return { title: movie.title, year: movie.year };
    });

  // Every phase shows the same board the real game uses, so the tutorial
  // teaches the actual play surface rather than a stand-in diagram. Only
  // the 3 hand-verified movies from TUTORIAL_FLOW.md are ever placed --
  // the remaining slots of the 5-tile group stay as empty grid cells
  // rather than inventing titles for movies 4 and 5.
  if (phase === 'intro') {
    return <LadderStack movies={asStack([script.pulpFiction])} />;
  }
  if (phase === 'pick-correct' || phase === 'explain-correct') {
    return (
      <>
        <LadderStack movies={asStack([script.pulpFiction])} />
        <View style={styles.candidates}>
          {[
            { id: script.killBill1, highlight: true },
            { id: script.harryPotter1, highlight: false },
            { id: script.guardiansOfTheGalaxy, highlight: false },
          ].map(({ id, highlight }) => {
            const movie = m(id);
            return (
              <View key={id} style={styles.candidateSlot}>
                <MovieCell
                  title={movie.title}
                  year={movie.year}
                  state={highlight ? 'correct' : 'default'}
                  compact
                />
              </View>
            );
          })}
        </View>
      </>
    );
  }
  if (phase === 'pick-wrong' || phase === 'explain-wrong') {
    return (
      <>
        {/* Kill Bill Vol. 1 was placed by the previous correct pick, so it's
            now the top tile and Pulp Fiction sits below it. */}
        <LadderStack movies={asStack([script.pulpFiction, script.killBill1])} />
        <View style={styles.candidates}>
          {[
            { id: script.killBill2, highlight: false },
            { id: script.backToTheFuture, highlight: phase === 'pick-wrong' },
            { id: script.homeAlone, highlight: false },
          ].map(({ id, highlight }) => {
            const movie = m(id);
            return (
              <View key={id} style={styles.candidateSlot}>
                <MovieCell
                  title={movie.title}
                  year={movie.year}
                  state={highlight ? 'wrong' : 'default'}
                  compact
                />
              </View>
            );
          })}
        </View>
      </>
    );
  }
  if (phase === 'milestone' || phase === 'done') {
    return (
      <LadderStack
        movies={asStack([script.pulpFiction, script.killBill1, script.killBill2])}
      />
    );
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
  // No background/padding here -- LadderStack draws the board surface
  // itself, and the phases that show no board (betting/strikes) should not
  // leave an empty panel behind.
  board: {
    marginBottom: 16,
  },
  candidates: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    width: '100%',
    // Lines up with the board's own edges on a wide (computer-sized)
    // screen instead of stretching past them -- LadderStack caps itself
    // the same way.
    maxWidth: MAX_BOARD_WIDTH,
    alignSelf: 'center',
  },
  // 25% is ~75% of the ~33%-per-tile width the old flex:1/3-way-split gave
  // each candidate, spread across the row with space-between rather than
  // packed edge-to-edge.
  candidateSlot: { width: '25%' },
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
