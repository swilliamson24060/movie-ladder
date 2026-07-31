import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MovieLadder } from './movieLadder';
import { colors } from './theme';
import MovieCell from './components/MovieCell';
import LadderStack, { MAX_BOARD_WIDTH } from './components/LadderStack';
import {
  buildTutorialScript,
  COPY,
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
        phase === 'betting-intro' ||
        phase === 'betting-offer' ||
        phase === 'betting-round' ||
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

      {phase === 'betting-win' && (
        <ExplainModal
          title={COPY['betting-win'].title!}
          lines={[
            'Jackie Brown connects to Kill Bill: Volume 2 by:',
            ...formatMatches(script.betRound).map((l) => `• ${l}`),
            '',
            '+10 points — bet won! Betting pays off big when you’re confident. Remember: losing a bet costs 2 strikes instead of 1.',
          ]}
          button={COPY['betting-win'].button}
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
  // the 4 hand-verified movies from TUTORIAL_FLOW.md are ever placed --
  // the remaining slot of the 5-tile group stays as empty grid cells rather
  // than inventing a title for movie 5.
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
  if (phase === 'milestone' || phase === 'betting-intro') {
    return (
      <LadderStack
        movies={asStack([script.pulpFiction, script.killBill1, script.killBill2])}
      />
    );
  }
  if (phase === 'betting-offer') {
    return (
      <>
        <LadderStack
          movies={asStack([script.pulpFiction, script.killBill1, script.killBill2])}
        />
        <BetOfferPreview />
      </>
    );
  }
  if (phase === 'betting-round' || phase === 'betting-win') {
    return (
      <>
        <LadderStack
          movies={asStack([script.pulpFiction, script.killBill1, script.killBill2])}
        />
        <Text style={styles.betRoundBanner}>
          💰 BET ROUND — WIN: +10 PTS · LOSE: −2 STRIKES
        </Text>
        <View style={styles.candidates}>
          {[
            { id: script.jackieBrown, highlight: true },
            { id: script.titanic, highlight: false },
            { id: script.soundOfMusic, highlight: false },
          ].map(({ id, highlight }) => {
            const movie = m(id);
            return (
              <View key={id} style={styles.candidateSlot}>
                <MovieCell
                  title={movie.title}
                  year={movie.year}
                  state={highlight ? 'correct' : 'bet'}
                  compact
                />
              </View>
            );
          })}
        </View>
      </>
    );
  }
  if (phase === 'done') {
    return (
      <LadderStack
        movies={asStack([
          script.pulpFiction,
          script.killBill1,
          script.killBill2,
          script.jackieBrown,
        ])}
      />
    );
  }
  return null;
}

/** Non-interactive preview of the real bet-offer screen (see App.tsx) --
 * the tutorial's own NEXT-style button below drives advancement, same
 * pattern as every other scripted phase, so these buttons don't need to
 * be pressable themselves. */
function BetOfferPreview() {
  return (
    <View style={styles.betOfferPanel}>
      <Text style={styles.betOfferTitle}>💰 WANT TO BET?</Text>
      <View style={styles.betButtonRow}>
        <View style={styles.buttonSecondaryPreview}>
          <Text style={styles.buttonSecondaryText}>NO THANKS</Text>
        </View>
        <View style={styles.buttonBetPreview}>
          <Text style={styles.buttonBetText}>BET</Text>
        </View>
      </View>
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
          <Pressable style={styles.button} onPress={onAdvance}>
            <Text style={styles.buttonText}>{button}</Text>
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
  // Wider than an even 1/3-way split (33%) would look with space-between's
  // full gap, but not packed edge-to-edge either -- 30% keeps a slim gap
  // between tiles while the row's own maxWidth/alignSelf (above) still
  // pins the first and last tile's outer edges to the board's edges.
  // Matches App.tsx's real candidatesRow/candidateSlot.
  candidateSlot: { width: '30%' },
  betRoundBanner: {
    color: colors.yellow,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 16,
  },
  betOfferPanel: {
    marginTop: 16,
    alignItems: 'center',
    backgroundColor: colors.headerBackground,
    borderRadius: 10,
    padding: 16,
    maxWidth: MAX_BOARD_WIDTH,
    width: '100%',
    alignSelf: 'center',
  },
  betOfferTitle: {
    color: colors.green,
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.5,
    marginBottom: 14,
    textAlign: 'center',
  },
  betButtonRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  buttonBetPreview: {
    flex: 1,
    backgroundColor: colors.yellow,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonBetText: { color: colors.background, fontWeight: '800', letterSpacing: 1 },
  buttonSecondaryPreview: {
    flex: 1,
    backgroundColor: colors.cellEmpty,
    borderWidth: 1.5,
    borderColor: colors.cellBorder,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonSecondaryText: { color: colors.textSecondary, fontWeight: '800', letterSpacing: 1 },
  panel: { marginTop: 'auto', paddingBottom: 16 },
  body: { fontSize: 15, lineHeight: 21, marginBottom: 16, color: colors.textSecondary },
  button: {
    backgroundColor: colors.pink,
    borderRadius: 8,
    padding: 14,
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
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10, color: colors.textPrimary },
  modalLine: { fontSize: 14, lineHeight: 20, marginBottom: 4, color: colors.textPrimary },
});
