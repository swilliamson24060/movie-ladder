import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { MovieLadder } from './movieLadder';
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
        <Text style={styles.headerText}>Tutorial</Text>
        <Pressable onPress={skip}>
          <Text style={styles.skip}>SKIP ✕</Text>
        </Pressable>
      </View>

      <Board phase={phase} script={script} game={game} />

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
  const title = (id: number) => {
    const m = game.movie(id);
    return `${m.title} (${m.year})`;
  };

  if (phase === 'intro') {
    return <BoardTop label={title(script.pulpFiction)} />;
  }
  if (phase === 'pick-correct' || phase === 'explain-correct') {
    return (
      <>
        <BoardTop label={title(script.pulpFiction)} />
        <Candidates
          items={[
            { label: title(script.killBill1), highlight: true },
            { label: title(script.harryPotter1), highlight: false },
            { label: title(script.guardiansOfTheGalaxy), highlight: false },
          ]}
        />
      </>
    );
  }
  if (phase === 'pick-wrong' || phase === 'explain-wrong') {
    return (
      <>
        <BoardTop label={title(script.killBill1)} />
        <Candidates
          items={[
            { label: title(script.killBill2), highlight: false },
            { label: title(script.backToTheFuture), highlight: phase === 'pick-wrong' },
            { label: title(script.homeAlone), highlight: false },
          ]}
        />
      </>
    );
  }
  if (phase === 'milestone') {
    return (
      <View style={styles.milestonePreview}>
        {[1, 2, 3, 4].map((n) => (
          <View key={n} style={[styles.ghostTile, { opacity: 1 - n * 0.2 }]} />
        ))}
        <View style={styles.topTile}>
          <Text style={styles.topTileText}>{title(script.killBill2)}</Text>
        </View>
      </View>
    );
  }
  if (phase === 'done') {
    return (
      <View style={styles.chainReview}>
        {[script.pulpFiction, script.killBill1, script.killBill2].map((id, i) => (
          <Text key={id} style={styles.chainItem}>
            {i > 0 ? '↓\n' : ''}
            {title(id)}
          </Text>
        ))}
      </View>
    );
  }
  return null;
}

function BoardTop({ label }: { label: string }) {
  return (
    <View style={styles.boardTop}>
      <Text style={styles.boardTopText}>{label}</Text>
    </View>
  );
}

function Candidates({ items }: { items: { label: string; highlight: boolean }[] }) {
  return (
    <View style={styles.candidates}>
      {items.map((it) => (
        <View
          key={it.label}
          style={[styles.candidate, it.highlight && styles.candidateHighlight]}
        >
          <Text>{it.label}</Text>
        </View>
      ))}
    </View>
  );
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
          <Text style={styles.modalTitle}>{title}</Text>
          {lines.map((line, i) => (
            <Text key={i} style={styles.modalLine}>
              {line}
            </Text>
          ))}
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
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerText: { fontWeight: '700', fontSize: 16 },
  skip: { color: '#888' },
  boardTop: {
    borderWidth: 2,
    borderColor: '#333',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  boardTopText: { fontSize: 20, fontWeight: '700' },
  candidates: { gap: 8 },
  candidate: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
  },
  candidateHighlight: { borderColor: '#2a9d34', borderWidth: 2, backgroundColor: '#eaffea' },
  panel: { marginTop: 'auto' },
  body: { fontSize: 15, lineHeight: 21, marginBottom: 16 },
  button: {
    backgroundColor: '#222',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#999' },
  buttonText: { color: '#fff', fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: { backgroundColor: '#fff', borderRadius: 12, padding: 20, width: '100%', maxWidth: 420 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  modalLine: { fontSize: 14, lineHeight: 20, marginBottom: 4 },
  milestonePreview: { alignItems: 'center', marginBottom: 16 },
  ghostTile: {
    height: 20,
    width: '90%',
    backgroundColor: '#ddd',
    borderRadius: 6,
    marginBottom: 4,
  },
  topTile: {
    borderWidth: 2,
    borderColor: '#333',
    borderRadius: 10,
    padding: 16,
    width: '100%',
    alignItems: 'center',
  },
  topTileText: { fontWeight: '700' },
  chainReview: { alignItems: 'center', gap: 4 },
  chainItem: { textAlign: 'center', fontSize: 15 },
});
