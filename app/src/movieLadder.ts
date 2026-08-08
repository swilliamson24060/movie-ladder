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
 *
 * Difficulty modes (CLAUDE.md section 5c) layer three independent
 * restrictions on top of that single mechanic -- see MODE_CONFIG.
 */

export type MovieRow = [string, number | null, string, string | null, number];
// [title, year, wikidata_id, imdb_id, sitelinks]
//
// sitelinks (Wikipedia language-edition count) is a recognizability proxy
// carried through from films.csv, added 2026-08-08 for the difficulty modes
// (CLAUDE.md section 5c). It is NOT a connection type and never groups
// anything -- purely a per-movie attribute for filtering the pool. It was
// appended as the last tuple element deliberately so movie IDs (= array
// positions) are unchanged, which keeps existing saved games valid; see the
// note in connections_generator.py.

export type Mode = 'easy' | 'regular';

export interface ModeConfig {
  label: string;
  /** One-line description shown on the mode-select screen. */
  blurb: string;
  /**
   * Minimum Wikipedia sitelinks for a movie to appear at all in this mode.
   * 0 = the whole pool.
   *
   * CRITICAL: this filters the ENTIRE round -- current movie, correct
   * answer, and both decoys alike (see buildRound). Applying it to only the
   * correct answer would hand the player a "pick whichever one you've heard
   * of" tell that measurably does not exist today: simulated over 400 real
   * rounds, the correct answer is the single most-recognizable of the three
   * 34% of the time vs. 33% by chance. Don't half-apply it.
   */
  minSitelinks: number;
  /**
   * Connection types that count as "these two movies are connected" in this
   * mode. Regular uses all six active types; easy keeps only the ones a
   * player can plausibly know off the top of their head, dropping
   * screenwriter and composer.
   *
   * Must stay mirrored with scripts/round_selector.py's MODE_CONFIG (the
   * two implementations are deliberately duplicated, not imported).
   */
  connectionTypes: Set<string>;
  /** Whether to name the connection category up front as a hint. */
  hint: boolean;
}

/**
 * The six connection types the GAME uses, out of the eleven the generator
 * produces. The other five (same_company, same_country, same_based_on,
 * shared_title_word, same_release_year) stay in connections.json's schema
 * but are excluded by decision (2026-07-30): same_country is a
 * genre-style broadness risk (59.4% of films share "United States"),
 * same_company/same_based_on/shared_title_word are too weak a signal for a
 * satisfying "aha, they connect" moment, and same_release_year was dropped
 * because the year is printed right on every candidate tile (MovieCell) --
 * a connection the UI already displays isn't one the player has to spot.
 */
const REGULAR_CONNECTION_TYPES = [
  'same_director',
  'shared_cast_member',
  'same_screenwriter',
  'same_composer',
  'same_award',
  'same_series',
];

/**
 * Easy keeps the three "loud" types. Verified reach in the shipped data:
 * shared_cast_member covers 96.2% of movies, same_director 82.7%,
 * same_series 8.4% -- so the first two carry the mode and same_series is a
 * bonus, not a load-bearing type. Do NOT try to build a mode on
 * same_award/same_series alone (7-8% reach each): far too thin to chain on.
 */
const EASY_CONNECTION_TYPES = ['same_director', 'shared_cast_member', 'same_series'];

/**
 * Easy's sitelink floor. 30 keeps 3,765 of 15,674 movies (24%) and, combined
 * with the reduced type list, leaves a median of 85 connections per movie
 * and a 1.4% dead-end rate (vs. 0.4% for regular) -- measured, not
 * estimated. The pool's overall median is 20 sitelinks, so roughly half of
 * regular's pool is obscure enough that a typical player is guessing blind
 * rather than reasoning; that's the thing this fixes.
 */
const EASY_MIN_SITELINKS = 30;

export const MODE_CONFIG: Record<Mode, ModeConfig> = {
  easy: {
    label: 'EASY',
    blurb: 'Well-known movies, the most recognizable connections, and a hint naming the category.',
    minSitelinks: EASY_MIN_SITELINKS,
    connectionTypes: new Set(EASY_CONNECTION_TYPES),
    hint: true,
  },
  regular: {
    label: 'REGULAR',
    blurb: 'Every movie in the dataset, all six connection types, no hints.',
    minSitelinks: 0,
    connectionTypes: new Set(REGULAR_CONNECTION_TYPES),
    hint: false,
  },
};

export const MODES: Mode[] = ['easy', 'regular'];

export function isMode(value: unknown): value is Mode {
  return value === 'easy' || value === 'regular';
}

/**
 * Naming this type in a hint would give the answer away rather than narrow
 * the search: a franchise is usually obvious from the title alone (Kill
 * Bill: Volume 1 on top + "shares a franchise" leaves nothing to work out).
 * When it's the only thing a round matches on, no hint is shown at all --
 * see pickHintType.
 */
const NON_HINTABLE_TYPES = new Set(['same_series']);

/**
 * When a round matches on more than one hintable type, name the rarest one:
 * it narrows the search most. Ordered by measured reach in the shipped data
 * (ascending), so the least common category wins: same_award 7.4% of movies,
 * same_screenwriter 75.0%, same_composer 78.0%, same_director 82.7%,
 * shared_cast_member 96.2%.
 *
 * This matters more than it looks. Picking at random among the applicable
 * types made the hint read "a cast member" in 93% of easy rounds (measured
 * over 800), because nearly every pair that connects at all connects on
 * cast -- so the hint rarely told the player anything they couldn't assume.
 * Preferring the rarer type means the ~7% of rounds that DO have a director
 * link surface as "a director" instead of a coin flip. It doesn't change how
 * often those rounds occur, only that the hint reports the more useful of
 * the two when it has a choice.
 */
const HINT_PREFERENCE = [
  'same_award',
  'same_screenwriter',
  'same_composer',
  'same_director',
  'shared_cast_member',
];

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
  /** Wikipedia sitelink count -- recognizability proxy, see MovieRow. */
  sitelinks: number;
}

export interface Round {
  currentId: number;
  candidateIds: number[]; // length 3, shuffled
  correctId: number;
  matches: Record<string, string[]>; // conn_type -> shared values, current<->correct
  /**
   * Connection type to name up front as an easy-mode hint, or null for no
   * hint (regular mode, or a round whose only match is non-hintable). Stored
   * on the round rather than derived at render time so it stays stable
   * across re-renders and survives a save/reload.
   */
  hintType: string | null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Everything about the dataset that depends on which mode is being played:
 * which movies exist, and which connections count. Built once per mode and
 * cached (see MovieLadder.forMode) -- both are pure functions of the data
 * plus the mode config, so they never need invalidating.
 */
export class ModeEngine {
  readonly mode: Mode;
  readonly config: ModeConfig;
  private base: MovieLadder;
  private connections: Record<string, Record<string, number[]>>;
  /** movieId -> connType -> Set(values) it belongs to, across every group of size >= 2. */
  private movieValues: Map<number, Map<string, Set<string>>>;
  /** Movie IDs playable in this mode, i.e. passing the sitelink floor. */
  private pool: number[];
  private poolSet: Set<number>;

  constructor(base: MovieLadder, mode: Mode, connections: ConnectionsData['connections'], movieCount: number, sitelinksOf: (id: number) => number) {
    this.base = base;
    this.mode = mode;
    this.config = MODE_CONFIG[mode];
    this.connections = connections;

    this.movieValues = new Map();
    for (const [connType, groupMap] of Object.entries(connections)) {
      if (!this.config.connectionTypes.has(connType)) continue;
      for (const [value, idList] of Object.entries(groupMap)) {
        if (idList.length < 2) continue;
        for (const mid of idList) {
          if (!this.movieValues.has(mid)) this.movieValues.set(mid, new Map());
          const byType = this.movieValues.get(mid)!;
          if (!byType.has(connType)) byType.set(connType, new Set());
          byType.get(connType)!.add(value);
        }
      }
    }

    this.pool = [];
    for (let id = 0; id < movieCount; id++) {
      if (sitelinksOf(id) >= this.config.minSitelinks) this.pool.push(id);
    }
    this.poolSet = new Set(this.pool);
  }

  movie(id: number): Movie {
    return this.base.movie(id);
  }

  /** How many movies are playable in this mode (not the dataset total). */
  get poolSize(): number {
    return this.pool.length;
  }

  inPool(id: number): boolean {
    return this.poolSet.has(id);
  }

  randomMovie(exclude?: Set<number>): number {
    if (!exclude || exclude.size === 0) return randomOf(this.pool);
    const available = this.pool.filter((id) => !exclude.has(id));
    // Falling back to the unfiltered pool can only happen if a run somehow
    // excluded every playable movie, which would need a >3,700-round run in
    // easy; returning something is still better than looping forever.
    return available.length > 0 ? randomOf(available) : randomOf(this.pool);
  }

  /**
   * A random movie that can actually start a run in this mode -- i.e. one
   * with at least one connection to another movie in the pool.
   *
   * Needed because the pool filter creates dead ends that don't exist in the
   * full dataset: a movie whose only connections are to movies below the
   * sitelink floor has zero playable connections (1.4% of easy's pool vs.
   * 0.4% of regular's). Those can only ever be hit as a *starting* movie --
   * any movie reached as a correct answer necessarily has a connection to
   * the movie it was reached from, and that one is in the pool by
   * construction.
   */
  randomStartMovie(maxAttempts = 50): number {
    for (let i = 0; i < maxAttempts; i++) {
      const id = this.randomMovie();
      if (this.connectedIds(id).size > 0) return id;
    }
    return this.randomMovie();
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

  /**
   * Every other movie in this mode's pool sharing >=1 connection type/value
   * with movieId. Pool-filtered here rather than at the call sites so no
   * caller can accidentally leak an out-of-pool movie into a round.
   */
  connectedIds(movieId: number): Set<number> {
    const connected = new Set<number>();
    const byType = this.movieValues.get(movieId);
    if (byType) {
      for (const [connType, values] of byType.entries()) {
        for (const value of values) {
          for (const id of this.connections[connType][value]) {
            if (this.poolSet.has(id)) connected.add(id);
          }
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

    const correctId = randomOf([...connected]);

    // Decoys: anything in the pool that is NOT connected to the current
    // movie by any of this mode's types. `connected` is exactly the set with
    // >=1 connection, so excluding it is the whole zero-connection guarantee.
    const decoyExclude = new Set(excludeSet);
    for (const id of connected) decoyExclude.add(id);
    decoyExclude.add(correctId);

    const decoys: number[] = [];
    let attempts = 0;
    while (decoys.length < 2 && attempts < maxAttempts) {
      attempts++;
      const candidate = this.randomMovie(decoyExclude);
      if (decoyExclude.has(candidate)) continue; // pool exhausted; see randomMovie
      decoyExclude.add(candidate);
      decoys.push(candidate);
    }
    if (decoys.length < 2) return null;

    const candidateIds = shuffle([correctId, ...decoys]);
    const matches = this.connectionsBetween(movieId, correctId);

    return {
      currentId: movieId,
      candidateIds,
      correctId,
      matches,
      hintType: this.config.hint ? pickHintType(matches) : null,
    };
  }
}

/**
 * Which connection type to name as the hint, given everything the round
 * matches on. Prefers a hintable type; returns null when the only matches
 * are types that would give the answer away (see NON_HINTABLE_TYPES), so
 * the round falls back to the normal no-hint prompt rather than showing a
 * hint that trivializes it.
 */
export function pickHintType(matches: Record<string, string[]>): string | null {
  const hintable = Object.keys(matches).filter((t) => !NON_HINTABLE_TYPES.has(t));
  if (hintable.length === 0) return null;
  for (const preferred of HINT_PREFERENCE) {
    if (hintable.includes(preferred)) return preferred;
  }
  // A hintable type not in the preference list (i.e. a type added to a mode
  // without updating HINT_PREFERENCE) still gets named rather than dropped.
  return hintable[0];
}

export class MovieLadder {
  private movies: MovieRow[];
  private connections: Record<string, Record<string, number[]>>;
  private modeCache = new Map<Mode, ModeEngine>();

  constructor(data: ConnectionsData) {
    this.movies = data.movies;
    this.connections = data.connections;
  }

  movie(id: number): Movie {
    const [title, year, wikidataId, imdbId, sitelinks] = this.movies[id];
    return { title, year, wikidataId, imdbId, sitelinks };
  }

  /** Recognizability proxy for one movie; see MovieRow's sitelinks note. */
  sitelinks(id: number): number {
    return this.movies[id][4];
  }

  /** Total movies in the dataset, across all modes. For a mode's playable
   * subset use forMode(mode).poolSize instead. */
  get count(): number {
    return this.movies.length;
  }

  /**
   * The engine for one difficulty mode. Cached per mode -- building one
   * walks every connection group, so this shouldn't happen on every render.
   */
  forMode(mode: Mode): ModeEngine {
    let engine = this.modeCache.get(mode);
    if (!engine) {
      engine = new ModeEngine(this, mode, this.connections, this.movies.length, (id) =>
        this.sitelinks(id)
      );
      this.modeCache.set(mode, engine);
    }
    return engine;
  }
}
