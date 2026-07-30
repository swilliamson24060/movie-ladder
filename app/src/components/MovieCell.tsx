import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

/**
 * A single movie "cell" -- the bordered, rounded-corner box chart-ladder
 * builds its whole grid out of (see BoardGrid.tsx / TileChip.tsx in the
 * Chartcross repo). Movie-ladder isn't a grid game (it's an open-ended
 * vertical stack, see CLAUDE.md section 5b), so this doesn't reproduce the
 * NxN board layout -- it reproduces the cell itself: dark fill, colored
 * border, optional glow, bold centered label.
 */
export type CellState = 'default' | 'current' | 'correct' | 'wrong';

const BORDER_COLOR: Record<CellState, string> = {
  default: colors.cellBorder,
  current: colors.green,
  correct: colors.blue,
  wrong: colors.red,
};

export default function MovieCell({
  title,
  year,
  state = 'default',
  big = false,
  compact = false,
  onPress,
}: {
  title: string;
  year: number | null;
  state?: CellState;
  big?: boolean;
  /** Narrower cell for laying candidates out 3-across instead of stacked
   * full-width: tighter padding, smaller type, and a capped line count
   * (long titles ellipsize instead of growing the cell tall) so all three
   * still read at roughly a third of the screen's width. */
  compact?: boolean;
  onPress?: () => void;
}) {
  const accent = BORDER_COLOR[state];
  const glow = state !== 'default';

  const content = (
    <View
      style={[
        styles.cell,
        big && styles.cellBig,
        compact && styles.cellCompact,
        {
          borderColor: accent,
          borderWidth: state === 'default' ? 1.5 : 2.5,
          boxShadow: glow ? (`0 0 8px ${accent}` as any) : undefined,
        },
      ]}
    >
      <Text
        style={[styles.title, big && styles.titleBig, compact && styles.titleCompact]}
        numberOfLines={compact ? 4 : undefined}
      >
        {title}
      </Text>
      {year != null && (
        <Text style={[styles.year, compact && styles.yearCompact]}>{year}</Text>
      )}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable style={compact && styles.pressableCompact} onPress={onPress}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    backgroundColor: colors.cellEmpty,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginVertical: 6,
    alignItems: 'center',
  },
  cellBig: {
    backgroundColor: colors.boardBackground,
    borderRadius: 10,
    paddingVertical: 18,
  },
  cellCompact: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    marginVertical: 0,
  },
  // Applied to the Pressable itself (compact mode only), not just the
  // View inside it -- a candidateSlot in a 3-across row gets stretched to
  // match its tallest sibling automatically (default row cross-axis
  // stretch), but that only makes the invisible slot taller. Without this,
  // the Pressable -- and the bordered cell inside it -- would stay at
  // their own short content height, leaving the visible tiles mismatched
  // even though their containers lined up.
  pressableCompact: {
    flex: 1,
  },
  title: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  titleBig: {
    fontSize: 20,
    fontWeight: '800',
  },
  titleCompact: {
    fontSize: 12,
  },
  year: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  yearCompact: {
    fontSize: 10,
    marginTop: 1,
  },
});
