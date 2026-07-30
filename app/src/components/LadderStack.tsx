import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

/**
 * The 5-tile milestone stack, rendered on an actual grid -- matching
 * chart-ladder's bordered-square board look (see BoardGrid.tsx in the
 * Chartcross repo) but with movie-ladder's own placement geometry, which
 * chart-ladder doesn't have (its tiles are always exactly 1x1 grid cells;
 * see GRID_SIZE/STARTER_POS in packages/engine/src/engine/board.ts).
 *
 * Geometry (fixed spec, not tunable per-call):
 * - Grid is GRID_COLUMNS wide, one row per tile up to GRID_ROWS.
 * - Tile 0 (the starter) sits on the bottom row, flush against the left
 *   edge, spanning TILE_SPAN columns.
 * - Each following tile sits one row higher and STEP columns further right
 *   than the grid's left edge (tile i: left = i * STEP, width = TILE_SPAN),
 *   so with STEP = TILE_SPAN/2 every tile overlaps exactly half of the one
 *   below it -- that's the staircase.
 * - GRID_COLUMNS = 12 exactly fits the 5th tile flush against the right
 *   edge (4*2 + 4 = 12), so a full 5-tile group fills the grid exactly.
 *
 * Slots not yet reached (movies[i] undefined/null for i < GRID_ROWS) render
 * as empty ghost squares -- never fabricated placeholder titles.
 */
const GRID_COLUMNS = 12;
const GRID_ROWS = 5;
const TILE_SPAN = 4;
const STEP = 2;

export interface LadderMovie {
  title: string;
  year: number | null;
}

export default function LadderStack({
  movies,
}: {
  /** In placement order: movies[0] is the starter (bottom), last is the
   * most recently placed (top). Fewer than GRID_ROWS entries is fine --
   * remaining rows render as empty grid squares. */
  movies: (LadderMovie | null | undefined)[];
}) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: GRID_ROWS }).map((_, r) => (
        <View key={r} style={styles.row}>
          {Array.from({ length: GRID_COLUMNS }).map((_, c) => (
            <View key={c} style={styles.cell} />
          ))}
        </View>
      ))}

      {Array.from({ length: GRID_ROWS }).map((_, i) => {
        const movie = movies[i];
        if (!movie) return null;
        const isTop = i === movies.filter(Boolean).length - 1;
        return (
          <View
            key={i}
            style={[
              styles.tile,
              {
                left: `${(i * STEP * 100) / GRID_COLUMNS}%`,
                width: `${(TILE_SPAN * 100) / GRID_COLUMNS}%`,
                top: `${((GRID_ROWS - 1 - i) * 100) / GRID_ROWS}%`,
                height: `${100 / GRID_ROWS}%`,
                borderColor: isTop ? colors.green : colors.blue,
                boxShadow: `0 0 6px ${isTop ? colors.green : colors.blue}` as any,
              },
            ]}
          >
            <Text numberOfLines={1} style={styles.tileText}>
              {movie.title}
              {movie.year != null ? ` (${movie.year})` : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    width: '100%',
    aspectRatio: GRID_COLUMNS / GRID_ROWS,
    position: 'relative',
    backgroundColor: colors.boardBackground,
    borderRadius: 8,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    height: `${100 / GRID_ROWS}%`,
  },
  cell: {
    width: `${100 / GRID_COLUMNS}%`,
    height: '100%',
    borderWidth: 1,
    borderColor: colors.cellBorder,
    backgroundColor: colors.cellEmpty,
  },
  tile: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 4,
    backgroundColor: colors.rackSlotBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tileText: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 11,
    textAlign: 'center',
  },
});
