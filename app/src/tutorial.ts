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

import { MovieLadder } from './movieLadder';

export type Phase =
  | 'intro'
  | 'pick-correct'
  | 'explain-correct'
  | 'pick-wrong'
  | 'explain-wrong'
  | 'milestone'
  | 'betting-intro'
  | 'betting-offer'
  | 'betting-round'
  | 'betting-win'
  | 'strikes'
  | 'done';

export const PHASE_ORDER: Phase[] = [
  'intro',
  'pick-correct',
  'explain-correct',
  'pick-wrong',
  'explain-wrong',
  'milestone',
  'betting-intro',
  'betting-offer',
  'betting-round',
  'betting-win',
  'strikes',
  'done',
];

const CONNECTION_LABELS: Record<string, string> = {
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
  correctRound1: Record<string, string[]>; // Pulp Fiction -> Kill Bill 1
  correctRound2: Record<string, string[]>; // Kill Bill 1 -> Kill Bill 2
  betRound: Record<string, string[]>; // Kill Bill 2 -> Jackie Brown
}

export function buildTutorialScript(game: MovieLadder): TutorialScript {
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
    correctRound1: game.connectionsBetween(pulpFiction, killBill1),
    correctRound2: game.connectionsBetween(killBill1, killBill2),
    betRound: game.connectionsBetween(killBill2, jackieBrown),
  };
}

export const COPY: Record<Phase, { title?: string; body: string; button: string }> = {
  intro: {
    body:
      'Every ladder starts with one movie already on the board. Your job: keep picking movies that connect to the one on top, for as long as you can. Connections come straight from the data — shared director, cast member, award, and more. You don’t need to know which connection it is, just that one exists.',
    button: 'NEXT ▶',
  },
  'pick-correct': {
    body:
      'Each round shows you three movies. Exactly one connects to the movie on top of your stack — the other two share nothing with it at all. Here, Kill Bill: Volume 1 (highlighted) is the right pick.',
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
      'Land 5 correct movies in a row without a strike and the stack clears off the board, leaving just the top tile to keep building from. Every group of 5 also pays a bonus:\n• +1 point per correct movie (as you just saw)\n• +5 points for completing a group of 5\n• +10 points more if that group of 5 had zero strikes\n\nA strike anywhere in the group still lets you finish it — you just miss out on that +10.',
    button: 'NEXT ▶',
  },
  'betting-intro': {
    body:
      'Right after you clear a group of 5, you’ll sometimes get the option to bet — you can decline any time. Let’s see it in action.',
    button: 'NEXT ▶',
  },
  'betting-offer': {
    body:
      'A bet stakes one of your strikes on your very next pick:\n• Win → a big bonus payout on top of normal scoring\n• Lose → that miss costs you 2 strikes instead of 1\n\nLet’s take the bet.',
    button: 'TAKE THE BET ▶',
  },
  'betting-round': {
    body:
      'Bet rounds are marked gold so the raised stakes are never a surprise. Here, Jackie Brown (highlighted) is the right pick.',
    button: 'SEE WHAT HAPPENS ▶',
  },
  'betting-win': {
    title: 'Correct!',
    body: '', // filled in per-round from formatMatches()
    button: 'NEXT ▶',
  },
  strikes: {
    body:
      'Miss 5 times total and the run ends. From there: your score is checked against the leaderboard, you can review the full connection chain you built, or start a new run.',
    button: 'NEXT ▶',
  },
  done: {
    body: 'That’s the idea! Tap 🔗 VIEW CONNECTION CHAIN any time during a real run to review your path like this again.',
    button: 'START PLAYING',
  },
};
