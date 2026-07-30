import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
 * - Tile 0 (the starter) sits on the bottom row, flush against the left
 *   edge, spanning TILE_SPAN columns.
 * - Each later tile sits one row higher and STEP columns further from the
 *   left edge: tile i has left = i * STEP, width = TILE_SPAN. With
 *   STEP = TILE_SPAN / 2 each tile overlaps exactly half the one below it.
 * - MAX_STACK_TILES = 5 tiles per group; the 5th ends flush against the
 *   right edge (4*2 + 4 = 12 = GRID_COLUMNS), so a completed group spans
 *   the board exactly.
 *
 * Rows above the stack stay empty, the same way most of chart-ladder's
 * board is unfilled cells. Slots with no movie yet are never given
 * placeholder titles -- they simply aren't rendered.
 */
const GRID_COLUMNS = 12;
const GRID_ROWS = 12;
const TILE_SPAN = 4;
const STEP = 2;

/** Tiles in one milestone group, per CLAUDE.md section 5b. */
export const MAX_STACK_TILES = 5;

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
  const [boardWidth, setBoardWidth] = useState(0);
  const cellSize = boardWidth / GRID_COLUMNS;
  // Scale label text off the measured cell size, the same way chart-ladder's
  // TileChip does, so tiles stay legible on a phone and don't look lost on a
  // wide screen.
  const fontSize = Math.max(7, cellSize * 0.3);

  const placed = movies.slice(0, MAX_STACK_TILES);

  return (
    <View
      style={styles.grid}
      onLayout={(e) => setBoardWidth(e.nativeEvent.layout.width)}
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
                top: `${((GRID_ROWS - 1 - i) * 100) / GRID_ROWS}%`,
                height: `${100 / GRID_ROWS}%`,
                borderColor: accent,
                boxShadow: `0 0 6px ${accent}` as any,
              },
            ]}
          >
            <Text numberOfLines={2} style={[styles.tileText, { fontSize }]}>
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
    maxWidth: 520,
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
