/**
 * Movie-ladder's round-selection engine, ported from
 * scripts/round_selector.py (the Python reference implementation) to
 * TypeScript for the app -- movie-ladder has no shared engine code with
 * chart-ladder (see CLAUDE.md section 5b), so this is a from-scratch port,
 * not an import.
 *
 * Mechanic: the player is shown 3 candidate movies for the movie on top of
 * their stack. Exactly one has a real connection (any type -- director,
 * cast, award, etc.), the other two have zero connections by any type. The
 * player is never asked to name the connection type, just to spot that one
 * exists.
 */

export type MovieRow = [string, number | null, string, string | null];
// [title, year, wikidata_id, imdb_id]

/**
 * Connection types the GAME actually uses to build chains/decoys. The
 * generator still produces same_company, same_country, same_based_on,
 * shared_title_word, and same_release_year (they stay in connections.json's
 * schema), but they're excluded here by decision (2026-07-30): same_country
 * was flagged as a genre-style broadness risk (59.4% of films share "United
 * States"), same_company/same_based_on/shared_title_word were judged too
 * weak/loose a signal for "these two movies are meaningfully connected,"
 * and same_release_year was dropped because the year is printed right on
 * every candidate tile (see MovieCell) -- an active connection the UI
 * already displays isn't a hidden connection to spot, it's just reading a
 * number off the screen. Add a type back here only if that judgment
 * changes -- it doesn't require touching the generator. Mirrors
 * scripts/round_selector.py's ACTIVE_CONNECTION_TYPES.
 *
 * Verified impact of dropping same_release_year (2026-07-30): movies with
 * zero remaining active connection to anything else go from 4 (0.02%) to
 * 275 (1.6%) of the 17,009-film dataset -- those become unreachable as a
 * chain node (random_movie() can still pick one as a starter, which would
 * immediately dead-end). Small but real; not fixed here since nothing was
 * asked for beyond removing the type.
 */
const ACTIVE_CONNECTION_TYPES = new Set([
  'same_director',
  'shared_cast_member',
  'same_screenwriter',
  'same_composer',
  'same_award',
  'same_series',
]);

export interface ConnectionsData {
  movie_fields: string[];
  movies: MovieRow[];
  connections: Record<string, Record<string, number[]>>;
}

export interface Movie {
  title: string;
  year: number | null;
  wikidataId: string;
  imdbId: string | null;
}

export interface Round {
  currentId: number;
  candidateIds: number[]; // length 3, shuffled
  correctId: number;
  matches: Record<string, string[]>; // conn_type -> shared values, current<->correct
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class MovieLadder {
  private movies: MovieRow[];
  private connections: Record<string, Record<string, number[]>>;
  /** movieId -> connType -> Set(values) it belongs to, across every group of size >= 2. */
  private movieValues: Map<number, Map<string, Set<string>>>;

  constructor(data: ConnectionsData) {
    this.movies = data.movies;
    this.connections = data.connections;
    this.movieValues = this.buildMovieValues();
  }

  private buildMovieValues(): Map<number, Map<string, Set<string>>> {
    const result = new Map<number, Map<string, Set<string>>>();
    for (const [connType, groupMap] of Object.entries(this.connections)) {
      if (!ACTIVE_CONNECTION_TYPES.has(connType)) continue;
      for (const [value, idList] of Object.entries(groupMap)) {
        if (idList.length < 2) continue;
        for (const mid of idList) {
          if (!result.has(mid)) result.set(mid, new Map());
          const byType = result.get(mid)!;
          if (!byType.has(connType)) byType.set(connType, new Set());
          byType.get(connType)!.add(value);
        }
      }
    }
    return result;
  }

  movie(id: number): Movie {
    const [title, year, wikidataId, imdbId] = this.movies[id];
    return { title, year, wikidataId, imdbId };
  }

  get count(): number {
    return this.movies.length;
  }

  randomMovie(exclude?: Set<number>): number {
    while (true) {
      const id = Math.floor(Math.random() * this.movies.length);
      if (!exclude || !exclude.has(id)) return id;
    }
  }

  /** Every connection type/value shared by a and b -- ALL matches, not just the first. */
  connectionsBetween(a: number, b: number): Record<string, string[]> {
    const aValues = this.movieValues.get(a);
    const bValues = this.movieValues.get(b);
    const matches: Record<string, string[]> = {};
    if (!aValues || !bValues) return matches;
    for (const [connType, aVals] of aValues.entries()) {
      const bVals = bValues.get(connType);
      if (!bVals) continue;
      const shared = [...aVals].filter((v) => bVals.has(v)).sort();
      if (shared.length > 0) matches[connType] = shared;
    }
    return matches;
  }

  /** Every other movie sharing >=1 connection type/value with movieId. */
  connectedIds(movieId: number): Set<number> {
    const connected = new Set<number>();
    const byType = this.movieValues.get(movieId);
    if (byType) {
      for (const [connType, values] of byType.entries()) {
        for (const value of values) {
          for (const id of this.connections[connType][value]) connected.add(id);
        }
      }
    }
    connected.delete(movieId);
    return connected;
  }

  /**
   * Build a 3-candidate round for the movie on top of the stack.
   * Returns null if the movie has no valid next move at all (a dead end --
   * caller should restart from a different movie).
   */
  buildRound(movieId: number, exclude?: Set<number>, maxAttempts = 200): Round | null {
    const excludeSet = new Set(exclude ?? []);
    excludeSet.add(movieId);

    const connected = this.connectedIds(movieId);
    for (const id of excludeSet) connected.delete(id);
    if (connected.size === 0) return null;

    const connectedArr = [...connected];
    const correctId = connectedArr[Math.floor(Math.random() * connectedArr.length)];

    const decoyExclude = new Set(excludeSet);
    for (const id of connected) decoyExclude.add(id);
    decoyExclude.add(correctId);

    const decoys: number[] = [];
    let attempts = 0;
    while (decoys.length < 2 && attempts < maxAttempts) {
      attempts++;
      const candidate = this.randomMovie(decoyExclude);
      decoyExclude.add(candidate);
      decoys.push(candidate);
    }
    if (decoys.length < 2) return null;

    const candidateIds = shuffle([correctId, ...decoys]);
    const matches = this.connectionsBetween(movieId, correctId);

    return { currentId: movieId, candidateIds, correctId, matches };
  }
}
