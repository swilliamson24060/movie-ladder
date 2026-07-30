import { useState } from 'react';
import { Animated, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors } from '../theme';

/**
 * Movie-ladder's game board: a grid of square cells that fills the
 * available width, matching chart-ladder's board look (see BoardGrid.tsx
 * and GRID_SIZE in the Chartcross repo, which is a 7x7 square of 1x1
 * tiles) but sized to exactly fit this game's own stack instead of being
 * square. The placement geometry is movie-ladder's own -- chart-ladder has
 * no multi-cell tiles and no staircase.
 *
 * Geometry (fixed spec, not tunable per-call):
 * - GRID_COLUMNS x GRID_ROWS board, square cells. GRID_ROWS is exactly
 *   MAX_STACK_TILES * TILE_ROWS (5*2=10) -- a completed group of 5 fills
 *   the board's full height with no empty rows left over above it.
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
 *   right edge (4*2 + 4 = 12 = GRID_COLUMNS) and the top edge, so a
 *   completed group spans the board exactly, corner to corner.
 *
 * Slots with no movie yet are never given placeholder titles -- they
 * simply aren't rendered, leaving that part of the grid empty.
 */
const GRID_COLUMNS = 12;
const GRID_ROWS = 10;
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
  slideProgress,
}: {
  /** In placement order: movies[0] is the starter (bottom row), the last
   * entry is the most recently placed (highest, furthest right). Extra
   * entries beyond MAX_STACK_TILES are ignored. */
  movies: (LadderMovie | null | undefined)[];
  /** 0 = tiles sit in their normal stair position; 1 = tiles have slid down
   * off the bottom of the board. Drive this from the caller (see App.tsx's
   * milestone pause) to animate a completed group of 5 clearing off the
   * board. The background grid never moves -- only the tiles layer does. */
  slideProgress?: Animated.Value;
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
  const boardHeight = boardWidth * (GRID_ROWS / GRID_COLUMNS);
  const tilesLayerStyle = slideProgress
    ? {
        transform: [
          {
            translateY: slideProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, boardHeight],
            }),
          },
        ],
        opacity: slideProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      }
    : undefined;

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

      <Animated.View style={[styles.tilesLayer, tilesLayerStyle]}>
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
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    width: '100%',
    // Capped so it doesn't become enormous on a desktop-width window
    // (chart-ladder caps its own board at 520px the same way).
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
  // Fills the grid exactly so the tiles inside keep resolving their
  // percentage left/top/width/height against the full board, not against
  // whatever size Animated.View would otherwise shrink-wrap to.
  tilesLayer: {
    ...StyleSheet.absoluteFillObject,
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
