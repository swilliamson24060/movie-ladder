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

export type MovieRow = [string, number | null, string, string | null, number, number];
// [title, year, wikidata_id, imdb_id, sitelinks, is_us]
//
// sitelinks (Wikipedia language-edition count) is a recognizability proxy
// carried through from films.csv, added 2026-08-08 for the difficulty modes
// (CLAUDE.md section 5c). It is NOT a connection type and never groups
// anything -- purely a per-movie attribute for filtering the pool. It was
// appended as the last tuple element deliberately so movie IDs (= array
// positions) are unchanged, which keeps existing saved games valid; see the
// note in connections_generator.py.

/**
 * 'expert' was called 'regular' until 2026-08-08, when easy became the
 * default mode every player starts in and the old regular was reframed as
 * something you unlock. The key was renamed with it; saved games and
 * leaderboard rows written under the old name are mapped across rather than
 * discarded (see App.tsx's loadSavedGame and leaderboard.ts's collection
 * map).
 */
export type Mode = 'easy' | 'expert';

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
   * mode. Expert uses all six active types; easy keeps only the ones a
   * player can plausibly know off the top of their head, dropping
   * screenwriter and composer.
   *
   * Must stay mirrored with scripts/round_selector.py's MODE_CONFIG (the
   * two implementations are deliberately duplicated, not imported).
   */
  connectionTypes: Set<string>;
  /** Whether to name the connection category up front as a hint. */
  hint: boolean;
  /**
   * Connection types to steer the correct answer towards when the current
   * movie offers a choice. Empty = no steering (the correct answer is drawn
   * uniformly from everything connected, which is what expert does).
   *
   * Easy prefers director and franchise links for three separate reasons,
   * all measured:
   *  1. They're far easier to spot. Knowing who directed a film is common
   *     knowledge in a way that recalling its full cast list isn't -- the
   *     single biggest driver of "easy is too hard" feedback.
   *  2. Without steering, cast swamps everything: 80% of easy-pool movies
   *     have a director link available but only ~7% of rounds used one,
   *     because cast connections vastly outnumber the rest.
   *  3. A director credit can't be an uncredited walk-on, which sidesteps
   *     the Harrison-Ford-in-Zabriskie-Point class of bad connection
   *     entirely (see CLAUDE.md section 6 -- there is no data-side fix for
   *     it, so avoiding the type is the only lever).
   *
   * Steering is a preference, never a requirement: if the current movie has
   * no link of a preferred type, the round is built from whatever it does
   * have rather than dead-ending.
   */
  preferConnectionTypes: string[];
  /**
   * Whether decoys are drawn from the correct answer's recognizability
   * neighbourhood rather than uniformly from the pool.
   *
   * On in BOTH modes, for two different reasons.
   *
   * Easy needs it because preferring director links skews the correct answer
   * famous -- a prolific director's other films are themselves well known --
   * which pushed "correct answer is the most recognizable of the three" to
   * 40% and handed the player a "just pick the one you know" strategy.
   *
   * Expert turned out to need it too, contradicting an earlier note in
   * CLAUDE.md that declared the tell absent at 34% vs 33% by chance. That
   * figure came from a 400-round sample; at 4,000 rounds the real numbers
   * are 41-44% strictly most-famous against 21-23% strictly least, whether
   * rounds are sampled independently or walked as a chain. The cause is
   * structural: a movie's connections skew towards well-documented (hence
   * well-known) films, while uniform decoys are drawn from a pool whose
   * median is far lower. With matching on, both modes sit near symmetric.
   *
   * Trade-off worth knowing: matched decoys are equally obscure, so a player
   * can no longer eliminate a candidate purely because they've never heard
   * of it. That makes expert marginally harder as well as fairer. Flip this
   * to false for expert to restore the old behaviour.
   */
  matchDecoyRecognizability: boolean;
  /**
   * Cap on how many non-US movies a single floor may contain, or 0 for no
   * cap. The US-relevance filter in connections_generator.py already
   * decides WHICH non-US films are in the pool at all (they must connect to
   * a US film or have won a major award), but that doesn't control how they
   * CHAIN -- and they cluster hard, because a non-US director's filmography
   * and cast pool are themselves non-US. Measured in easy: a hop out of a
   * non-US movie lands on another non-US movie 31% of the time, against 4%
   * out of a US movie, so a chain that wanders in tends to stay for a whole
   * floor.
   *
   * Easy caps it; expert doesn't, since expert's pool is 35% non-US by
   * design and capping there would distort the mode rather than fix a
   * complaint about it.
   */
  maxNonUSPerFloor: number;
  /**
   * Minimum size of the connection group a correct answer should be reached
   * through, or 0 to not care. A group's size IS how many pool films that
   * person worked on, so this is a direct proxy for "would a player have
   * heard of them".
   *
   * Added after a playtester was asked to link Legends of the Fall to The
   * Doors through Karina Lombard -- 3rd-billed in the first, a walk-on in
   * the second. She isn't obscure by our notability filter (32 sitelinks,
   * well past the cast floor of 15); she's just in 6 pool films against
   * Brad Pitt's 59. Wikidata has no billing order (P1545 coverage measured
   * at 0 of 5 films), so role size can't be read directly -- how much
   * someone works is the closest usable stand-in.
   *
   * A preference, not a filter: when nothing prolific is available the
   * round is still built from what's there.
   */
  minConnectionGroupSize: number;
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
 * Easy's sitelink floor, raised 30 -> 40 on 2026-08-08 after testers found
 * easy too hard. 40 keeps ~1,784 of 15,673 movies (11%) at a median degree
 * of 84 -- still a healthy graph, per the threshold table in CLAUDE.md
 * section 5c.
 *
 * Why this helps, given what was measured: at 30 the candidates were
 * already reasonably well known (median 39 sitelinks), so the difficulty
 * was never obscure *films* -- it's that spotting a shared cast member
 * means recalling a cast list. A higher floor makes it likelier the player
 * knows all three candidates well enough to reason about them, including
 * eliminating the two decoys, which is what actually makes a round solvable
 * rather than a guess.
 *
 * The trade-off is repetition: this is under half the previous pool, so the
 * same films recur across runs sooner. If that becomes the complaint, bias
 * rounds toward director/franchise connections (section 5c) rather than
 * dropping this back down -- 80% of easy-pool movies have a director link
 * available but only ~7% of rounds currently use one.
 */
const EASY_MIN_SITELINKS = 40;

/**
 * How many pool films a person must have worked on for a connection through
 * them to be preferred. Tuned against the reported case: Karina Lombard has
 * 6, which should lose; the median connecting person in a real round has
 * ~33, which should win comfortably.
 */
const MIN_PROLIFIC_GROUP = 12;

/**
 * Score in a single run that unlocks expert mode. Lives here rather than in
 * App.tsx so the number and the copy that quotes it can't drift apart --
 * the mode blurb below interpolates it.
 *
 * Raised 300 -> 500 on 2026-08-08: 300 arrives early in the second floor at
 * escalating rates, so nearly anyone who finished a couple of floors would
 * have unlocked it, making it a formality rather than something earned.
 * Untested against real players either way.
 */
export const EXPERT_UNLOCK_SCORE = 500;

export const MODE_CONFIG: Record<Mode, ModeConfig> = {
  easy: {
    label: 'EASY',
    blurb:
      'Well-known movies, the three most recognizable kinds of connection, and every round tells you which one to look for.',
    minSitelinks: EASY_MIN_SITELINKS,
    connectionTypes: new Set(EASY_CONNECTION_TYPES),
    hint: true,
    preferConnectionTypes: ['same_director', 'same_series'],
    matchDecoyRecognizability: true,
    maxNonUSPerFloor: 2,
    minConnectionGroupSize: MIN_PROLIFIC_GROUP,
  },
  expert: {
    label: 'EXPERT',
    blurb:
      `Every movie in the dataset, all six kinds of connection, and you’re never told which one links them. Unlocked by scoring ${EXPERT_UNLOCK_SCORE}.`,
    minSitelinks: 0,
    connectionTypes: new Set(REGULAR_CONNECTION_TYPES),
    hint: false,
    preferConnectionTypes: [],
    matchDecoyRecognizability: true,
    maxNonUSPerFloor: 0,
    minConnectionGroupSize: MIN_PROLIFIC_GROUP,
  },
};

export const MODES: Mode[] = ['easy', 'expert'];

export function isMode(value: unknown): value is Mode {
  return value === 'easy' || value === 'expert';
}

/** The mode every player starts in, and the only one available until
 * expert is unlocked. */
export const DEFAULT_MODE: Mode = 'easy';


/** Maps a mode name read from storage, tolerating the pre-rename value so a
 * run or a leaderboard entry saved as 'regular' still resolves. */
export function normalizeMode(value: unknown): Mode | null {
  if (value === 'regular') return 'expert';
  return isMode(value) ? value : null;
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
 * How many sitelink-ranked neighbours either side of the correct answer the
 * decoys are drawn from. Wide enough that decoys still vary run to run,
 * narrow enough that all three candidates are comparably well known -- which
 * both closes the recognizability tell and makes elimination a viable way to
 * solve a round.
 */
const DECOY_RANK_WINDOW = 200;

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
  /** Whether the United States is one of the film's countries. */
  isUS: boolean;
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
  /** Pool ordered by sitelinks, plus each movie's index in it -- lets decoys
   * be drawn from the correct answer's recognizability neighbourhood. */
  private poolBySitelinks: number[];
  private rankBySitelinks: Map<number, number>;

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

    this.poolBySitelinks = this.pool.slice().sort((a, b) => sitelinksOf(a) - sitelinksOf(b));
    this.rankBySitelinks = new Map();
    this.poolBySitelinks.forEach((id, i) => this.rankBySitelinks.set(id, i));
  }

  movie(id: number): Movie {
    return this.base.movie(id);
  }

  sitelinksOf(id: number): number {
    return this.base.sitelinks(id);
  }

  isUS(id: number): boolean {
    return this.base.isUS(id);
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
   * Build a round, relaxing constraints in order rather than dead-ending.
   *
   * A dead end used to leave the run stuck on a board with no playable
   * move -- measured at 135 of 300 simulated runs, sometimes as early as
   * the second pick, because `exclude` grows for the whole run and easy's
   * pool is only ~1,800 movies. Rather than end someone's run on an engine
   * limitation, the constraints are dropped one at a time, weakest promise
   * first:
   *
   *   1. Everything asked for (no repeats, all caps respected).
   *   2. Same, but caps ignored -- a repeated franchise beats a dead end.
   *   3. Allow revisiting movies from earlier in the run, excluding only
   *      what's currently on the board. The chain stays truthful (every
   *      link is still a real connection); a movie can just appear twice.
   *
   * Returns null only if even (3) fails, which means this movie has no
   * playable connection at all and the caller should restart from a new
   * one.
   */
  buildRoundWithFallback(
    movieId: number,
    history: Set<number>,
    onBoard: Set<number>,
    options: { blockSeriesLinks?: boolean; blockDirectorLinks?: boolean; blockNonUS?: boolean }
  ): Round | null {
    const decoyExclude = onBoard;
    return (
      this.buildRound(movieId, history, { ...options, decoyExclude }) ??
      this.buildRound(movieId, history, { decoyExclude }) ??
      this.buildRound(movieId, onBoard, { decoyExclude })
    );
  }

  /**
   * A random movie that can actually start a run in this mode -- i.e. one
   * with at least one connection to another movie in the pool.
   *
   * Needed because the pool filter creates dead ends that don't exist in the
   * full dataset: a movie whose only connections are to movies below the
   * sitelink floor has zero playable connections (1.4% of easy's pool vs.
   * 0.4% of expert's). Those can only ever be hit as a *starting* movie --
   * any movie reached as a correct answer necessarily has a connection to
   * the movie it was reached from, and that one is in the pool by
   * construction.
   */
  randomStartMovie(maxAttempts = 50, avoid?: Set<number>): number {
    // Two passes: first insisting the start is unused, then accepting any
    // playable movie. A new chain should avoid movies already seen this run
    // "if possible" -- reusing one occasionally is acceptable and beats
    // failing to start a chain at all.
    for (const respectAvoid of [true, false]) {
      for (let i = 0; i < maxAttempts; i++) {
        const id = this.randomMovie();
        if (this.connectedIds(id).size === 0) continue;
        if (respectAvoid && avoid?.has(id)) continue;
        return id;
      }
      if (!avoid) break;
    }
    return this.randomMovie();
  }

  /**
   * Everything this movie is on record for, under the types this mode
   * counts -- its directors, cast, franchise and so on. Used by the
   * tap-a-tile details view; connectionsBetween answers "why are these two
   * linked", this answers "what is this movie".
   */
  attributesOf(movieId: number): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const byType = this.movieValues.get(movieId);
    if (!byType) return out;
    for (const [connType, values] of byType.entries()) {
      out[connType] = [...values].sort();
    }
    return out;
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
   * Every movie in the pool sharing a connection of one specific type with
   * this one -- e.g. every film by the same director, or in the same
   * franchise. Used both to cap hops of a type (blockSeriesLinks /
   * blockDirectorLinks) and to steer towards one (preferConnectionTypes).
   */
  matesOfType(movieId: number, connType: string): Set<number> {
    const mates = new Set<number>();
    const values = this.movieValues.get(movieId)?.get(connType);
    if (values) {
      for (const value of values) {
        for (const id of this.connections[connType][value]) {
          if (this.poolSet.has(id)) mates.add(id);
        }
      }
    }
    mates.delete(movieId);
    return mates;
  }

  /**
   * Every movie reachable from this one through a connection group of at
   * least `minSize` members -- i.e. through someone who worked on that many
   * pool films. Used to steer away from links through people a player has
   * little chance of knowing; see minConnectionGroupSize.
   */
  prolificMates(movieId: number, minSize: number): Set<number> {
    const mates = new Set<number>();
    const byType = this.movieValues.get(movieId);
    if (!byType) return mates;
    for (const [connType, values] of byType.entries()) {
      for (const value of values) {
        const group = this.connections[connType][value];
        if (group.length < minSize) continue;
        for (const id of group) if (this.poolSet.has(id)) mates.add(id);
      }
    }
    mates.delete(movieId);
    return mates;
  }

  /** Franchise-mates specifically; see matesOfType. */
  seriesMates(movieId: number): Set<number> {
    return this.matesOfType(movieId, 'same_series');
  }

  /**
   * Build a 3-candidate round for the movie on top of the stack.
   * Returns null if the movie has no valid next move at all (a dead end --
   * caller should restart from a different movie).
   *
   * `blockSeriesLinks` / `blockDirectorLinks` steer the correct answer AWAY
   * from franchise- or director-mates of the current movie -- the caller
   * sets each once a floor has used its allowance of that hop type, so a
   * floor can't become a walk through one franchise or one filmography.
   *
   * The mode's `preferConnectionTypes` then steers TOWARDS whatever's left
   * of the preferred types (easy: director and franchise, which are much
   * easier to spot than a shared cast member).
   *
   * Every one of these is a preference, never a hard constraint: each step
   * keeps its filtered pool only if that pool is non-empty, so a movie whose
   * only remaining option is the discouraged kind still gets a round rather
   * than dead-ending the run. Blocks are applied before preferences, so a
   * capped type can't be steered back in.
   */
  buildRound(
    movieId: number,
    exclude?: Set<number>,
    options?: {
      blockSeriesLinks?: boolean;
      blockDirectorLinks?: boolean;
      blockNonUS?: boolean;
      /**
       * Movies that must not appear as decoys -- normally just what's
       * currently on the board. Deliberately separate from `exclude`: that
       * one grows for the whole run to stop the CHAIN revisiting a movie,
       * but a decoy reappearing is invisible to the player (it was never
       * placed), and reusing decoys freely keeps the pool from thinning as
       * a run gets long.
       */
      decoyExclude?: Set<number>;
    },
    maxAttempts = 200
  ): Round | null {
    const excludeSet = new Set(exclude ?? []);
    excludeSet.add(movieId);

    // Two sets, and the difference matters. `connectedAll` is everything
    // linked to this movie; `connected` is only what's still eligible as the
    // correct answer once the run's history is excluded.
    //
    // Decoys must be checked against connectedAll, NOT connected. Removing
    // history from a single shared set (as this did until the decoy pool was
    // freed from the history exclusion) quietly made every
    // previously-visited connected movie eligible as a decoy -- a decoy that
    // genuinely connects to the current movie, i.e. a round with two right
    // answers. Caught by the decoy invariant at 169 failures per 6,000 easy
    // rounds; it was invisible before because decoys used to inherit the
    // history exclusion and so skipped those movies anyway.
    const connectedAll = this.connectedIds(movieId);
    const connected = new Set(connectedAll);
    for (const id of excludeSet) connected.delete(id);
    if (connected.size === 0) return null;

    let correctPool = [...connected];

    // Keep the chain from settling into a run of non-US cinema once a floor
    // has had its share (see maxNonUSPerFloor). Like every other steer here
    // it yields rather than dead-ends if nothing US is available.
    if (options?.blockNonUS) {
      const usOnly = correctPool.filter((id) => this.isUS(id));
      if (usOnly.length > 0) correctPool = usOnly;
    }

    const blockedTypes: string[] = [];
    if (options?.blockSeriesLinks) blockedTypes.push('same_series');
    if (options?.blockDirectorLinks) blockedTypes.push('same_director');
    for (const connType of blockedTypes) {
      const mates = this.matesOfType(movieId, connType);
      const nonMates = correctPool.filter((id) => !mates.has(id));
      if (nonMates.length > 0) correctPool = nonMates;
    }

    const preferred = this.config.preferConnectionTypes.filter(
      (t) => !blockedTypes.includes(t)
    );
    if (preferred.length > 0) {
      const wanted = new Set<number>();
      for (const connType of preferred) {
        for (const id of this.matesOfType(movieId, connType)) wanted.add(id);
      }
      const preferredPool = correctPool.filter((id) => wanted.has(id));
      if (preferredPool.length > 0) correctPool = preferredPool;
    }

    // Applied last, so it narrows within whatever the type preference left
    // rather than competing with it: a director link is still preferred
    // over a cast link, but among equals the better-known person wins.
    if (this.config.minConnectionGroupSize > 0) {
      const prolific = this.prolificMates(movieId, this.config.minConnectionGroupSize);
      const prolificPool = correctPool.filter((id) => prolific.has(id));
      if (prolificPool.length > 0) correctPool = prolificPool;
    }

    const correctId = randomOf(correctPool);

    // Decoys: anything in the pool that is NOT connected to the current
    // movie by any of this mode's types. `connected` is exactly the set with
    // >=1 connection, so excluding it is the whole zero-connection guarantee.
    // Only the current board and this round's own movies are off-limits as
    // decoys -- not the run's whole history. See the decoyExclude option.
    const decoyExclude = new Set(options?.decoyExclude ?? []);
    decoyExclude.add(movieId);
    for (const id of connectedAll) decoyExclude.add(id);
    decoyExclude.add(correctId);

    // Decoys are matched to the correct answer's recognizability rather than
    // drawn uniformly, for two reasons.
    //
    // 1. It closes a tell that steering towards director links opens up.
    //    Uniform decoys were safe while the correct answer was also uniform
    //    (measured at 34% "correct answer is the most famous of the three"
    //    vs 33% by chance). But a prolific director's other films skew
    //    famous, so preferring director links pushed that to 40% -- a real
    //    edge for a player who just picks whichever title they know best.
    // 2. It makes the decoys eliminable. A round is only solvable by
    //    reasoning if the player recognizes all three candidates; one
    //    obscure decoy turns it back into a guess.
    // Matched by RANK, not by sitelink value. A value band (e.g. 0.6x-1.7x
    // the correct answer's count) looks equivalent but isn't: the pool is
    // heavily right-skewed, so a band around a famous film contains mostly
    // less-famous films and the decoys still come out systematically weaker.
    // Measured: the value-band version left the tell at 41%, barely moving
    // it from the 40% it was introduced at. Taking the correct answer's
    // neighbours in sitelink-sorted order is symmetric by construction --
    // roughly as many candidates above it as below.
    let decoySource = this.pool;
    if (this.config.matchDecoyRecognizability) {
      const rank = this.rankBySitelinks.get(correctId) ?? 0;
      const lo = Math.max(0, rank - DECOY_RANK_WINDOW);
      const hi = Math.min(this.poolBySitelinks.length, rank + DECOY_RANK_WINDOW + 1);
      const neighbours = this.poolBySitelinks.slice(lo, hi).filter((id) => !decoyExclude.has(id));
      if (neighbours.length >= 2) decoySource = neighbours;
    }

    const decoys: number[] = [];
    let attempts = 0;
    while (decoys.length < 2 && attempts < maxAttempts) {
      attempts++;
      const candidate = randomOf(decoySource);
      if (decoyExclude.has(candidate)) continue;
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
    const [title, year, wikidataId, imdbId, sitelinks, isUS] = this.movies[id];
    return { title, year, wikidataId, imdbId, sitelinks, isUS: isUS === 1 };
  }

  isUS(id: number): boolean {
    return this.movies[id][5] === 1;
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
