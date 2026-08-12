/**
 * Movie Ladder tutorial script, adapted from ../../TUTORIAL_FLOW.md.
 *
 * One substitution from the doc's original script: the "pick-wrong" phase
 * originally paired Kill Bill: Volume 1 with two decoys, Back to the Future
 * and The Lord of the Rings: The Return of the King. Once same_release_year
 * became a real connection type (it wasn't yet when TUTORIAL_FLOW.md's
 * decoy table was hand-verified against director/cast/screenwriter/
 * composer/company/award only), Kill Bill Vol. 1 and LOTR: ROTK turned out
 * to share one: both released in 2003. Verified against the real generated
 * data/connections.json.gz -- Home Alone (1990) has zero connections to
 * Kill Bill Vol. 1 across every connection type the generator produces, so
 * it replaces LOTR: ROTK as the second decoy. Everything else in this file
 * matches TUTORIAL_FLOW.md's script and copy as written.
 */

import { Mode, MODE_CONFIG, ModeEngine, MovieLadder } from './movieLadder';

export type Phase =
  | 'intro'
  | 'intro-detail'
  | 'pick-correct'
  | 'explain-correct'
  | 'pick-wrong'
  | 'explain-wrong'
  | 'milestone'
  | 'betting-intro'
  | 'betting-offer'
  | 'betting-round'
  | 'betting-win'
  | 'betting-lose-round'
  | 'betting-lose'
  | 'done';

export const PHASE_ORDER: Phase[] = [
  'intro',
  'intro-detail',
  'pick-correct',
  'explain-correct',
  'pick-wrong',
  'explain-wrong',
  'milestone',
  'betting-intro',
  'betting-offer',
  'betting-round',
  'betting-win',
  'betting-lose-round',
  'betting-lose',
  'done',
];

export const CONNECTION_LABELS: Record<string, string> = {
  same_director: 'Same director',
  shared_cast_member: 'Same cast member',
  same_screenwriter: 'Same screenwriter',
  same_composer: 'Same composer',
  same_company: 'Same production company',
  same_country: 'Same country',
  same_award: 'Same award',
  same_series: 'Same franchise/series',
  same_based_on: 'Same source material',
  same_release_year: 'Same release year',
  shared_title_word: 'Shared title word',
};

export function formatMatches(matches: Record<string, string[]>): string[] {
  return Object.entries(matches).map(
    ([type, values]) => `${CONNECTION_LABELS[type] ?? type} — ${values.join(', ')}`
  );
}

/**
 * Noun phrases for easy mode's up-front category hint, e.g. "WHICH MOVIE
 * SHARES A DIRECTOR WITH THE TOP TILE?". Separate from CONNECTION_LABELS
 * because those are sentence-fragment labels for the after-the-fact
 * explanation ("Same director — Quentin Tarantino"), which don't read
 * correctly in the question form.
 */
const HINT_NOUNS: Record<string, string> = {
  same_director: 'A DIRECTOR',
  shared_cast_member: 'A CAST MEMBER',
  same_screenwriter: 'A SCREENWRITER',
  same_composer: 'A COMPOSER',
  same_award: 'AN AWARD',
  same_series: 'A FRANCHISE',
};

/** The round prompt, naming the connection category when a hint applies. */
export function roundPrompt(hintType: string | null): string {
  const noun = hintType ? HINT_NOUNS[hintType] : null;
  return noun
    ? `WHICH MOVIE SHARES ${noun} WITH THE TOP TILE?`
    : 'WHICH MOVIE CONNECTS TO THE TOP TILE?';
}

function findMovie(game: MovieLadder, title: string, year: number): number {
  for (let i = 0; i < game.count; i++) {
    const m = game.movie(i);
    if (m.title === title && m.year === year) return i;
  }
  throw new Error(`Tutorial script movie not found in dataset: ${title} (${year})`);
}

export interface TutorialScript {
  pulpFiction: number;
  killBill1: number;
  killBill2: number;
  harryPotter1: number;
  guardiansOfTheGalaxy: number;
  backToTheFuture: number;
  homeAlone: number;
  // Betting demo round: continues the Tarantino chain past Kill Bill Vol. 2
  // (see TUTORIAL_FLOW.md's "rounds 4-5" note) with Titanic/The Sound of
  // Music as decoys -- verified zero-connection against Kill Bill Vol. 2
  // across every implemented type, same way the earlier decoy pairs were.
  jackieBrown: number;
  titanic: number;
  soundOfMusic: number;
  // Lost-bet demo, continuing the same bet floor past Jackie Brown. The
  // correct answer connects via Samuel L. Jackson -- deliberately a
  // recognizable name, since a tutorial connection nobody could place
  // would teach the opposite of what easy mode is for. Both decoys are
  // verified zero-connection to Jackie Brown across all six types.
  jurassicPark: number;
  theMatrix: number;
  shawshank: number;
  correctRound1: Record<string, string[]>; // Pulp Fiction -> Kill Bill 1
  correctRound2: Record<string, string[]>; // Kill Bill 1 -> Kill Bill 2
  betRound: Record<string, string[]>; // Kill Bill 2 -> Jackie Brown
  loseRound: Record<string, string[]>; // Jackie Brown -> Jurassic Park
}

export function buildTutorialScript(game: MovieLadder, engine: ModeEngine): TutorialScript {
  const pulpFiction = findMovie(game, 'Pulp Fiction', 1994);
  const killBill1 = findMovie(game, 'Kill Bill: Volume 1', 2003);
  const killBill2 = findMovie(game, 'Kill Bill: Volume 2', 2004);
  const harryPotter1 = findMovie(game, "Harry Potter and the Philosopher's Stone", 2001);
  const guardiansOfTheGalaxy = findMovie(game, 'Guardians of the Galaxy', 2014);
  const backToTheFuture = findMovie(game, 'Back to the Future', 1985);
  const homeAlone = findMovie(game, 'Home Alone', 1990);
  const jackieBrown = findMovie(game, 'Jackie Brown', 1997);
  const titanic = findMovie(game, 'Titanic', 1997);
  const soundOfMusic = findMovie(game, 'The Sound of Music', 1965);
  const jurassicPark = findMovie(game, 'Jurassic Park', 1993);
  const theMatrix = findMovie(game, 'The Matrix', 1999);
  const shawshank = findMovie(game, 'The Shawshank Redemption', 1994);

  return {
    pulpFiction,
    killBill1,
    killBill2,
    harryPotter1,
    guardiansOfTheGalaxy,
    backToTheFuture,
    homeAlone,
    jackieBrown,
    titanic,
    soundOfMusic,
    jurassicPark,
    theMatrix,
    shawshank,
    // Mode-scoped deliberately: in easy mode the tutorial must not teach a
    // connection type that mode doesn't count (all three scripted pairs
    // also match on screenwriter, which easy excludes). Verified that every
    // scripted pair still has at least one qualifying connection under
    // easy's reduced type list, and that all 10 scripted movies clear
    // easy's sitelink floor, so the same script is valid in both modes.
    correctRound1: engine.connectionsBetween(pulpFiction, killBill1),
    correctRound2: engine.connectionsBetween(killBill1, killBill2),
    betRound: engine.connectionsBetween(killBill2, jackieBrown),
    loseRound: engine.connectionsBetween(jackieBrown, jurassicPark),
  };
}

/**
 * The intro opens with a TL;DR so a player who doesn't want a walkthrough
 * can read five lines, hit SKIP, and still know how to play. Everything
 * after it is detail -- the same rules stated at length, plus the live
 * demo rounds that follow.
 *
 * The summary has to stay genuinely short to be worth having; if a rule
 * can't be stated in one line it belongs in the detail section or in a
 * later phase, not here.
 */
const INTRO_TLDR: Record<Mode, string[]> = {
  easy: [
    'THE SHORT VERSION',
    '• Three movies. Exactly one connects to the movie on top of the board.',
    '• In EASY, that link is a shared director, cast member, or franchise.',
    '• EASY tells you which one to look for. The prompt above the movies says so outright — e.g. “WHICH MOVIE SHARES A DIRECTOR WITH THE TOP TILE?” — so you only have to check that one thing.',
    '• Right earns points. Wrong costs a strike, and the correct movie goes on the board anyway.',
    '• Five strikes ends the run.',
    '• Tap any movie already on the board to see its details — who directed it, who was in it, and what it shares with the movie below it.',
    '',
    'Tap SKIP ✕ above to start playing. If you want a full walkthrough of everything in the game, click “NEXT” below.',
  ],
  expert: [
    'THE SHORT VERSION',
    '• Three movies. Exactly one connects to the movie on top of the board.',
    '• The link is a shared director, cast member, writer, composer, award or franchise — you’re not told which.',
    '• Right earns points. Wrong costs a strike, and the correct movie goes on the board anyway.',
    '• Five strikes ends the run.',
    '• Tap any movie already on the board to see its details — who directed it, who was in it, and what it shares with the movie below it.',
    '',
    'Tap SKIP ✕ above to start playing. If you want a full walkthrough of everything in the game, click “NEXT” below.',
  ],
};

/**
 * The detail half of the intro. The connection-type list has to match the
 * mode actually being played -- easy counts only three of the six types (expert counts all six), so
 * listing all six would teach a rule the game isn't using. Everything else
 * in the script is mode-independent (the scoring, betting and strike rules
 * are identical in both modes -- see CLAUDE.md section 5c, which
 * deliberately scoped the modes to *which rounds get built*, not to the
 * run's economy).
 */
const INTRO_DETAIL: Record<Mode, string[]> = {
  easy: [
    'IN FULL',
    'Every ladder starts with one movie already on the board. Your job: keep picking movies that connect to the one on top, for as long as you can.',
    '',
    'In EASY mode, connections come from:',
    '• Same director',
    '• Shared cast member',
    '• Same franchise/series',
    '',
    'Easy mode sticks to well-known movies, and — unlike EXPERT — it never makes you guess which kind of link you’re hunting for. Every round names the category in the prompt above the three movies:',
    '   “WHICH MOVIE SHARES A DIRECTOR WITH THE TOP TILE?”',
    '   “WHICH MOVIE SHARES A CAST MEMBER WITH THE TOP TILE?”',
    'So you never have to check all three kinds at once — just the one it asks for.',
    '',
    '💡 Tap any movie already on the board to see its details — who directed it, who was in it, and what it shares with the movie below it.',
    '',
    'Movies range from 1950 to 2026.',
  ],
  expert: [
    'IN FULL',
    'Every ladder starts with one movie already on the board. Your job: keep picking movies that connect to the one on top, for as long as you can.',
    '',
    'Connections come from:',
    '• Same director',
    '• Shared cast member',
    '• Same screenwriter',
    '• Same composer',
    '• Same award (Academy Awards, AFI, BAFTA, Cannes, Golden Globe, Golden Raspberry, Palme d’Or, Screen Actors Guild, Sundance, or Writers Guild of America)',
    '• Same franchise/series',
    '',
    'You don’t need to know which one applies — just that one exists.',
    '',
    '💡 Tap any movie already on the board to see its details — who directed it, who was in it, and what it shares with the movie below it.',
    '',
    'Movies range from 1950 to 2026.',
  ],
};

const INTRO_BODY: Record<Mode, string> = {
  easy: INTRO_TLDR.easy.join('\n'),
  expert: INTRO_TLDR.expert.join('\n'),
};

/** Page two: the same rules at length, for a player who tapped NEXT. */
const INTRO_DETAIL_BODY: Record<Mode, string> = {
  easy: INTRO_DETAIL.easy.join('\n'),
  expert: INTRO_DETAIL.expert.join('\n'),
};

/**
 * The scripted round in 'pick-correct' shows a hint line in easy mode, so
 * the copy explaining that round has to acknowledge it -- otherwise the
 * tutorial demonstrates a UI element it never mentions.
 */
const PICK_CORRECT_BODY: Record<Mode, string> = {
  easy:
    'Each round shows you three movies. Exactly one connects to the movie on top of your stack — the other two share nothing with it at all. The prompt above the movies names the category to look for. Here, Kill Bill: Volume 1 (highlighted) is the right pick.',
  expert:
    'Each round shows you three movies. Exactly one connects to the movie on top of your stack — the other two share nothing with it at all. Here, Kill Bill: Volume 1 (highlighted) is the right pick.',
};

export type CopyBook = Record<Phase, { title?: string; body: string; button: string }>;

export function buildCopy(mode: Mode): CopyBook {
  return {
    ...COPY,
    intro: { ...COPY.intro, body: INTRO_BODY[mode] },
    'intro-detail': { ...COPY['intro-detail'], body: INTRO_DETAIL_BODY[mode] },
    'pick-correct': { ...COPY['pick-correct'], body: PICK_CORRECT_BODY[mode] },
  };
}

const COPY: CopyBook = {
  intro: {
    body: INTRO_BODY.expert,
    button: 'NEXT ▶',
  },
  'intro-detail': {
    body: INTRO_DETAIL_BODY.expert,
    button: 'NEXT ▶',
  },
  'pick-correct': {
    body: PICK_CORRECT_BODY.expert,
    button: 'NEXT ▶',
  },
  'explain-correct': {
    title: 'Correct!',
    body: '', // filled in per-round from formatMatches()
    button: 'NEXT ▶',
  },
  'pick-wrong': {
    body: 'This time, let’s pick wrong on purpose so you know what happens.',
    button: 'SEE WHAT HAPPENS ▶',
  },
  'explain-wrong': {
    title: 'Not quite.',
    body: '', // filled in per-round
    button: 'CONTINUE ▶',
  },
  milestone: {
    body:
      'Fill the board with 5 movies and the floor is complete: the stack clears off the board, leaving just the top tile to keep building from. Getting one wrong doesn’t stop a floor finishing — the correct movie is placed for you either way. Scoring climbs every floor:\n• Floor 1 pays 5 points per correct movie, Floor 2 pays 10, Floor 3 pays 15 — 5 more per tile each floor (as you just saw)\n• Completing a floor pays a bonus too: 2 points per correct answer that floor, doubling to 4 on Floor 2, 6 on Floor 3 — 2 more per correct answer each floor. A miss doesn’t earn its share, even though the correct movie still gets placed for you.\n• Zero strikes on a floor adds +10 more on top of that floor’s bonus\n\nA strike anywhere in the floor still lets you finish it — you just miss out on the strike’s own bonus share and the +10.',
    button: 'NEXT ▶',
  },
  'betting-intro': {
    body:
      'Right after you clear a floor, you’ll usually get the option to bet — you can always decline. It’s skipped after your very first floor, at a 4-floor checkpoint, and whenever you’re too close to striking out to risk it. Let’s see it in action.',
    button: 'NEXT ▶',
  },
  'betting-offer': {
    body:
      'A bet stakes your entire next floor:\n• Win → finish that floor with zero strikes and its completion bonus doubles\n• Lose → miss even once and it costs you: that floor’s completion bonus is gone, and every wrong answer on the floor subtracts double its point value\n\nStrikes themselves still cost their normal amount either way — the penalty is in points, not lives.\n\nLet’s take the bet.',
    button: 'TAKE THE BET ▶',
  },
  'betting-round': {
    body:
      'Every pick in a bet floor is marked gold, so the raised stakes are never a surprise. Here, Jackie Brown (highlighted) is the right pick.',
    button: 'SEE WHAT HAPPENS ▶',
  },
  'betting-win': {
    title: 'Correct!',
    body: '', // filled in per-round from formatMatches()
    button: 'NEXT ▶',
  },
  'betting-lose-round': {
    body:
      'A bet rides on the whole floor, not just one pick — so it isn’t safe yet. Let’s get this one wrong on purpose and see what a lost bet actually costs.',
    button: 'SEE WHAT HAPPENS ▶',
  },
  'betting-lose': {
    title: 'Not quite.',
    body: '', // filled in per-round
    button: 'CONTINUE ▶',
  },
  done: {
    body:
      'Clear 4 floors and the run pauses: you bank 2 points for every strike you have left, then choose whether to keep going on a brand new chain. Your score and floor value carry over — your strikes do not reset.\n\nMiss 5 times total and the run ends. From there: your score is checked against the leaderboard, you can review the full connection chain you built, or start a new run.\n\nThat’s the idea! Tap 🔗 VIEW CONNECTION CHAIN any time during a real run to review your path like this again.',
    button: 'START PLAYING',
  },
};
