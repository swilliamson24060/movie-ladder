/**
 * Firebase Web SDK config for the high-score leaderboard.
 *
 * This is NOT a secret -- Firebase web config values are meant to be public
 * in client-side apps; access control is enforced by Firestore Security
 * Rules (see /firestore.rules at the repo root), not by hiding these
 * values. Safe to commit.
 *
 * Fill in with your Firebase project's own web app config: Firebase
 * Console -> Project Settings -> General -> "Your apps" -> Web app (add one
 * if this project doesn't have one registered yet) -> the `firebaseConfig`
 * object shown there. Until these are filled in, every leaderboard call
 * fails silently and the game plays normally with no leaderboard (see
 * leaderboard.ts) -- there's no placeholder-detection needed here, invalid
 * config just fails the same way a real but wrong config would.
 */
export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.appspot.com',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};
