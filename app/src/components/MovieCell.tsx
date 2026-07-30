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
  onPress,
}: {
  title: string;
  year: number | null;
  state?: CellState;
  big?: boolean;
  onPress?: () => void;
}) {
  const accent = BORDER_COLOR[state];
  const glow = state !== 'default';

  const content = (
    <View
      style={[
        styles.cell,
        big && styles.cellBig,
        {
          borderColor: accent,
          borderWidth: state === 'default' ? 1.5 : 2.5,
          boxShadow: glow ? (`0 0 8px ${accent}` as any) : undefined,
        },
      ]}
    >
      <Text style={[styles.title, big && styles.titleBig]}>{title}</Text>
      {year != null && <Text style={styles.year}>{year}</Text>}
    </View>
  );

  if (!onPress) return content;
  return <Pressable onPress={onPress}>{content}</Pressable>;
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
  year: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
});
