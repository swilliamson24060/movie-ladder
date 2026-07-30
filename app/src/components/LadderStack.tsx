import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors } from '../theme';

/**
 * Movie-ladder's game board: a square grid of square cells that fills the
 * available width, matching chart-ladder's board look (see BoardGrid.tsx
 * and GRID_SIZE in the Chartcross repo, which is a 7x7 square of 1x1
 * tiles). The placement geometry is movie-ladder's own -- chart-ladder has
 * no multi-cell tiles and no staircase.
 *
 * Geometry (fixed spec, not tunable per-call):
 * - GRID_COLUMNS x GRID_ROWS square board, square cells.
 * - Tiles are TILE_SPAN columns wide and TILE_ROWS rows tall. The extra
 *   height is there so long titles ("The Lord of the Rings: The Return of
 *   the King") can wrap to two lines and still sit centered in the tile.
 * - Tile 0 (the starter) sits on the bottom rows, flush against the left
 *   edge.
 * - Each later tile sits directly on top of the one below (TILE_ROWS
 *   higher, so they stack rather than overlap) and STEP columns further
 *   from the left edge: tile i has left = i * STEP. With
 *   STEP = TILE_SPAN / 2 each tile overhangs exactly half the one below.
 * - MAX_STACK_TILES = 5 tiles per group; the 5th ends flush against the
 *   right edge (4*2 + 4 = 12 = GRID_COLUMNS), so a completed group spans
 *   the board's full width and its bottom 10 rows.
 *
 * Rows above the stack stay empty, the same way most of chart-ladder's
 * board is unfilled cells. Slots with no movie yet are never given
 * placeholder titles -- they simply aren't rendered.
 */
const GRID_COLUMNS = 12;
const GRID_ROWS = 12;
const TILE_SPAN = 4;
const TILE_ROWS = 2;
const STEP = 2;

/** Tiles in one milestone group, per CLAUDE.md section 5b. */
export const MAX_STACK_TILES = 5;

/** Board never grows past this, matching chart-ladder's own board cap. */
const MAX_BOARD_WIDTH = 520;
/** Horizontal padding both screens put around the board (see the
 * `container` styles in App.tsx / TutorialScreen.tsx), used only to
 * estimate the board width before onLayout reports the real one. */
const SCREEN_PADDING = 16;

export interface LadderMovie {
  title: string;
  year: number | null;
}

export default function LadderStack({
  movies,
}: {
  /** In placement order: movies[0] is the starter (bottom row), the last
   * entry is the most recently placed (highest, furthest right). Extra
   * entries beyond MAX_STACK_TILES are ignored. */
  movies: (LadderMovie | null | undefined)[];
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  // onLayout is the exact source, but it does not reliably fire for this
  // view on react-native-web (verified: the tile font stayed pinned at its
  // minimum because the measured width never left 0), so fall back to a
  // window-derived estimate rather than silently rendering unscaled text.
  const boardWidth =
    measuredWidth || Math.min(MAX_BOARD_WIDTH, windowWidth - SCREEN_PADDING * 2);
  const cellSize = boardWidth / GRID_COLUMNS;
  // Scale label text off the measured cell size, the same way chart-ladder's
  // TileChip does, so tiles stay legible on a phone and don't look lost on a
  // wide screen. Tiles are TILE_ROWS tall, so two wrapped lines fit with
  // room to spare.
  const fontSize = Math.max(8, cellSize * 0.34);

  const placed = movies.slice(0, MAX_STACK_TILES);

  return (
    <View
      style={styles.grid}
      onLayout={(e) => setMeasuredWidth(e.nativeEvent.layout.width)}
    >
      {Array.from({ length: GRID_ROWS }).map((_, r) => (
        <View key={r} style={styles.row}>
          {Array.from({ length: GRID_COLUMNS }).map((_, c) => (
            <View key={c} style={styles.cell} />
          ))}
        </View>
      ))}

      {placed.map((movie, i) => {
        if (!movie) return null;
        const isTop = i === placed.length - 1;
        const accent = isTop ? colors.green : colors.blue;
        return (
          <View
            key={i}
            style={[
              styles.tile,
              {
                left: `${(i * STEP * 100) / GRID_COLUMNS}%`,
                width: `${(TILE_SPAN * 100) / GRID_COLUMNS}%`,
                top: `${((GRID_ROWS - (i + 1) * TILE_ROWS) * 100) / GRID_ROWS}%`,
                height: `${(TILE_ROWS * 100) / GRID_ROWS}%`,
                borderColor: accent,
                boxShadow: `0 0 6px ${accent}` as any,
              },
            ]}
          >
            {/* Up to 3 lines: two lines cover ~99% of titles in films.csv
                (p99 length is 42 chars), and the third catches the tail
                without overflowing a TILE_ROWS-tall tile. Anything longer
                still truncates with an ellipsis. */}
            <Text numberOfLines={3} style={[styles.tileText, { fontSize }]}>
              {movie.title}
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
    // Square board, like chart-ladder's. Capped so it doesn't become an
    // enormous square on a desktop-width window (chart-ladder caps its own
    // board at 520px the same way).
    maxWidth: MAX_BOARD_WIDTH,
    alignSelf: 'center',
    aspectRatio: GRID_COLUMNS / GRID_ROWS,
    position: 'relative',
    backgroundColor: colors.boardBackground,
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
    paddingHorizontal: 3,
  },
  tileText: {
    color: colors.textPrimary,
    fontWeight: '700',
    textAlign: 'center',
  },
});
