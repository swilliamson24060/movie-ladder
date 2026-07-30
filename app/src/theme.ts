/**
 * Movie Ladder's color palette and "cell" look, matching chart-ladder's
 * visual language (packages/mobile/src/theme.ts in the Chartcross repo).
 * Movie-ladder has no shared theme/engine code with chart-ladder (see
 * CLAUDE.md section 5b) -- these are the same color VALUES, duplicated
 * here on purpose, not imported.
 */

export const colors = {
  background: '#0a1224',
  headerBackground: '#16213f',
  boardBackground: '#0d1730',
  cellEmpty: '#1a2444',
  cellBorder: '#2a3660',
  textPrimary: '#e8ecf8',
  textSecondary: '#8b96b8',

  // chart-ladder's accent palette, reused as-is for the same look and feel.
  pink: '#ff3d9a', // chart-ladder's "artist"
  pinkDim: '#5c2244',
  blue: '#2ec5ff', // chart-ladder's "song"
  blueDim: '#1e4258',
  yellow: '#ffe066', // chart-ladder's "wildcard"
  yellowDim: '#4a4322',
  green: '#4fd67a', // chart-ladder's "year"
  orange: '#ff9a3d', // chart-ladder's "chartBoost"
  red: '#ff4d4d', // chart-ladder's "illegal"

  rackSlotBg: '#111b36',
  rackSlotBorder: '#2a3660',
};

// Movie-ladder's own mapping onto that shared palette: the current movie
// on top of the stack reads as a "green = build from here" cell (mirrors
// chart-ladder's legal-move highlight), a correct pick glows blue, and a
// deliberately-wrong tutorial pick glows red (chart-ladder's "illegal"
// color) so its wrongness reads instantly.
export const movieAccents = {
  current: colors.green,
  correct: colors.blue,
  wrong: colors.red,
  neutral: colors.cellBorder,
};
