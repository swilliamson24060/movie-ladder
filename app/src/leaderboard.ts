/**
 * Persistent top-10 high-score leaderboard, backed by Firestore.
 *
 * Every function here fails silently (empty list / false / no-op) rather
 * than throwing -- the leaderboard is a nice-to-have layered on top of the
 * actual game, which must keep working even if Firebase isn't configured
 * yet, the project's Firestore rules reject a write, or the player is
 * offline. Never let a leaderboard failure break the game loop.
 *
 * Data model: one Firestore collection PER DIFFICULTY MODE, one document
 * per submitted score -- {name, score, createdAt}. Simpler than maintaining
 * a single top-10 array document under concurrent writes; the top-10 query
 * (`orderBy('score', 'desc').limit(10)`) does the ranking, so a collection
 * can grow unbounded with non-qualifying scores over time without needing
 * to prune it for the leaderboard itself to stay correct.
 *
 * Why a collection per mode rather than one collection with a `mode` field
 * (decided 2026-08-08, when easy mode was added): easy and regular scores
 * aren't comparable -- easy restricts the pool to well-known movies, cuts
 * the connection types to the three most recognizable, and names the
 * category outright -- so they need separate boards either way. Given that,
 * separate collections win on two counts. A `mode` field would need a
 * composite index (`where('mode','==',x)` + `orderBy('score')`) created by
 * hand in the Firebase console before the leaderboard worked at all, and
 * every score submitted before the modes existed has no `mode` field, so a
 * filtered query would silently drop the entire existing leaderboard.
 * Keeping `highscores` as regular's collection preserves those rows
 * untouched, with zero migration.
 *
 * Security model: Firestore Security Rules (see /firestore.rules at the
 * repo root) allow public read, and a narrowly-shaped create (3-letter
 * name, a bounded numeric score, a server-set timestamp), with no
 * update/delete from the client. There is no server-side verification that
 * a submitted score was actually earned by real gameplay -- this is a
 * client-only game with no backend, so a determined player could still
 * write a fake (but rules-shaped) score directly. Acceptable for a casual
 * hobby leaderboard; revisit with Cloud Functions verification if that
 * ever becomes a real problem.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  addDoc,
  collection,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';

import { firebaseConfig } from './firebaseConfig';
import type { Mode } from './movieLadder';

export const LEADERBOARD_SIZE = 10;

/**
 * Regular deliberately keeps the original `highscores` name so every score
 * submitted before difficulty modes existed stays on the regular board --
 * those were all played under regular's rules. Renaming it would orphan
 * them. See the module docs for why this is a collection split rather than
 * a `mode` field.
 */
const COLLECTION_BY_MODE: Record<Mode, string> = {
  regular: 'highscores',
  easy: 'highscores_easy',
};

function collectionFor(mode: Mode): string {
  return COLLECTION_BY_MODE[mode];
}

export interface LeaderboardEntry {
  name: string;
  score: number;
}

let app: FirebaseApp | null = null;

function getApp(): FirebaseApp {
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

// A network call against an unreachable/misconfigured Firebase project
// (unset config, wrong project, offline) doesn't necessarily reject quickly
// -- observed hanging well past 30s against a placeholder config rather
// than failing fast. Every call below races against this timeout so the
// UI (the qualify-check effect, the leaderboard modal's loading state)
// never hangs indefinitely regardless of why Firestore is unreachable.
const TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TIMEOUT_MS)),
  ]);
}

/** Top 10 scores for one mode, highest first. Empty array on any failure or
 * timeout. */
export async function fetchTopScores(mode: Mode): Promise<LeaderboardEntry[]> {
  return withTimeout(
    (async () => {
      try {
        const db = getFirestore(getApp());
        const q = query(
          collection(db, collectionFor(mode)),
          orderBy('score', 'desc'),
          limit(LEADERBOARD_SIZE)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map((doc) => {
          const data = doc.data();
          return { name: String(data.name ?? '???'), score: Number(data.score ?? 0) };
        });
      } catch {
        return [];
      }
    })(),
    []
  );
}

/** Whether `score` would land in that mode's top 10 right now. A score of 0
 * never qualifies, even against an empty board -- not worth prompting a
 * brand new player who bounced immediately for a name entry. */
export async function wouldQualify(score: number, mode: Mode): Promise<boolean> {
  if (score <= 0) return false;
  const top = await fetchTopScores(mode);
  if (top.length < LEADERBOARD_SIZE) return true;
  const lowest = top[top.length - 1].score;
  return score > lowest;
}

/** Submit a score to one mode's board. `name` is truncated/upper-cased to
 * the 3-letter arcade format this leaderboard uses; failures/timeouts are
 * swallowed (see module docs). */
export async function submitScore(name: string, score: number, mode: Mode): Promise<void> {
  return withTimeout(
    (async () => {
      try {
        const db = getFirestore(getApp());
        await addDoc(collection(db, collectionFor(mode)), {
          name: name.toUpperCase().slice(0, 3),
          score,
          createdAt: serverTimestamp(),
        });
      } catch {
        // Swallowed -- see module docs.
      }
    })(),
    undefined
  );
}
