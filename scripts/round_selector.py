#!/usr/bin/env python3
"""
Game-round logic for movie-ladder: given the movie currently on top of the
player's stack, pick 3 candidate movies to show them -- one with a valid
connection (any type), two with zero connections by any type -- and expose
every connection type/value that ties the correct pick back to the current
movie (the "explain" modal shows all of them, not just one).

This is a full rewrite of chart-ladder's round_selector.py, not an edit.
The music game's ChartLadder picks a *tile type* (e.g. "Same Artist") and
lets the engine silently choose a next song that matches it -- the player
picks the type, not the song. Movie-ladder's mechanic is the opposite: the
player is shown 3 *movies* and has to spot which one connects *somehow*,
without ever naming or seeing a connection type up front. So there's no
tile-type selection step here at all -- see CLAUDE.md section 5b for the
full design, or README.md for a summary. This module implements only the
decoy-selection logic (section 5b's actual engineering delta); strikes,
scoring, milestones, and betting are game/session state that lives in the
app once it exists (see the punch list in CLAUDE.md section 9).

Usage as a library:

    from round_selector import MovieLadder

    game = MovieLadder("data/connections.json.gz")
    movie_id = game.random_movie()
    round_ = game.build_round(movie_id)
    # round_.candidates is a shuffled list of 3 CandidateMovie
    # round_.correct_id is the one with a real connection
    # round_.matches is {conn_type: [shared values]} explaining why

Usage as a CLI demo:

    python3 round_selector.py data/connections.json.gz --demo 5
"""

import argparse
import gzip
import json
import random
from collections import defaultdict
from dataclasses import dataclass, field

# Connection types the GAME actually uses to build chains/decoys. The
# generator still produces same_company, same_country, same_based_on,
# shared_title_word, and same_release_year (they stay in connections.json's
# schema), but they're excluded here by decision (2026-07-30): same_country
# was flagged as a genre-style broadness risk (59.4% of films share "United
# States"), same_company/same_based_on/shared_title_word were judged too
# weak/loose a signal for "these two movies are meaningfully connected,"
# and same_release_year was dropped because the year is printed right on
# every candidate tile in the app (MovieCell) -- an active connection the
# UI already displays isn't a hidden connection to spot, it's just reading
# a number off the screen. Add a type back here only if that judgment
# changes -- it doesn't require touching the generator.
#
# Verified impact of dropping same_release_year (2026-07-30): movies with
# zero remaining active connection to anything else go from 4 (0.02%) to
# 275 (1.6%) of the 17,009-film dataset -- those become unreachable as a
# chain node. Small but real; not fixed here since nothing was asked for
# beyond removing the type.
ACTIVE_CONNECTION_TYPES = {
    "same_director",
    "shared_cast_member",
    "same_screenwriter",
    "same_composer",
    "same_award",
    "same_series",
}

# Difficulty modes (CLAUDE.md section 5c, added 2026-08-08). MUST stay
# mirrored with app/src/movieLadder.ts's MODE_CONFIG -- the TS engine is a
# deliberate from-scratch port rather than an import (movie-ladder shares no
# code with chart-ladder, and the app can't import Python), so these two
# definitions are the one place a divergence would silently change what the
# game considers "connected."
#
#   min_sitelinks -- filters the ENTIRE round (current movie, correct
#     answer, and both decoys). Applying it to only the correct answer would
#     worsen the recognizability tell described under
#     match_decoy_recognizability.
#   prefer_connection_types -- steer the correct answer towards these when
#     the current movie offers a choice (easy only).
#   match_decoy_recognizability -- draw decoys from the correct answer's
#     sitelink-rank neighbourhood instead of uniformly. On in both modes:
#     without it, "pick the best-known title" wins 41-44% of rounds against
#     a 33% chance baseline, because a movie's connections skew towards
#     well-documented films while uniform decoys come from a much lower
#     median. An earlier 400-round sample put this at 34% and wrongly
#     concluded there was no tell.
#   connection_types -- easy drops screenwriter/composer, the two a player
#     is least likely to know. Measured reach in the shipped data:
#     shared_cast_member 96.2% of movies, same_director 82.7%,
#     same_series 8.4%.
#   hint -- whether the app names the connection category before the pick.
#     Python has no UI, so this is carried for parity/reference only.
#
# Easy's floor was raised 30 -> 40 on 2026-08-08 after testers found easy
# too hard: 40 keeps ~1,784 of 15,673 movies at a median degree of 84, and
# lifts median candidate recognizability from 39 to 49 sitelinks.
MODE_CONFIG = {
    "easy": {
        "min_sitelinks": 40,  # raised from 30 (2026-08-08, testers found easy too hard)
        "connection_types": {"same_director", "shared_cast_member", "same_series"},
        "hint": True,
        # Steer the correct answer towards these when the current movie
        # offers a choice -- a shared director is far easier to spot than a
        # shared cast member, and can't be an uncredited walk-on.
        "prefer_connection_types": ["same_director", "same_series"],
        "match_decoy_recognizability": True,
    },
    "regular": {
        "min_sitelinks": 0,
        "connection_types": set(ACTIVE_CONNECTION_TYPES),
        "hint": False,
        "prefer_connection_types": [],
        "match_decoy_recognizability": True,
    },
}

# How many sitelink-ranked neighbours either side of the correct answer the
# decoys come from when match_decoy_recognizability is on. Matching by RANK
# rather than by sitelink value matters: the pool is right-skewed, so a value
# band around a famous film still yields mostly less-famous decoys and leaves
# the tell in place (measured: 41% vs the 33% chance baseline).
DECOY_RANK_WINDOW = 200

# Naming this type in a hint would give the answer away rather than narrow
# the search (a franchise is usually obvious from the title alone), so a
# round whose only match is this shows no hint at all.
NON_HINTABLE_TYPES = {"same_series"}

# When a round matches on more than one hintable type, name the rarest --
# it narrows the search most. Ordered by measured reach in the shipped data
# (ascending): same_award 7.4% of movies, same_screenwriter 75.0%,
# same_composer 78.0%, same_director 82.7%, shared_cast_member 96.2%.
# Picking at random instead made the hint read "a cast member" in 93% of
# easy rounds (measured over 800), since nearly every connected pair shares
# cast. Mirrors HINT_PREFERENCE in app/src/movieLadder.ts.
HINT_PREFERENCE = [
    "same_award",
    "same_screenwriter",
    "same_composer",
    "same_director",
    "shared_cast_member",
]


@dataclass
class CandidateMovie:
    movie_id: int
    is_correct: bool = field(default=False, compare=False)


@dataclass
class Round:
    current_id: int
    candidates: list  # list of CandidateMovie, length 3, shuffled
    correct_id: int
    matches: dict  # {conn_type: [shared values]} between current_id and correct_id
    # Connection type to name up front as an easy-mode hint, or None for no
    # hint (regular mode, or a round whose only match is non-hintable).
    hint_type: str = None


class MovieLadder:
    def __init__(self, connections_path, mode="regular"):
        if mode not in MODE_CONFIG:
            raise ValueError(f"unknown mode {mode!r}; expected one of {sorted(MODE_CONFIG)}")
        self.mode = mode
        self.config = MODE_CONFIG[mode]
        self.movies, self.movie_fields, self.connections = self._load(connections_path)
        # movie_id -> {conn_type: set(values)} -- every group this movie belongs to,
        # across the modes's connection types, keyed by the exact display value
        # (e.g. a director's name) so it can be shown to the player as-is.
        self._movie_values = self._build_movie_values()
        # Movie IDs playable in this mode. Regular's floor is 0, so this is
        # every movie; easy's floor drops it to the recognizable subset.
        sitelinks_idx = self.movie_fields.index("sitelinks")
        floor = self.config["min_sitelinks"]
        self._pool = [i for i, row in enumerate(self.movies) if row[sitelinks_idx] >= floor]
        self._pool_set = set(self._pool)
        self._sitelinks = {i: self.movies[i][sitelinks_idx] for i in self._pool}
        self._pool_by_sitelinks = sorted(self._pool, key=lambda i: self._sitelinks[i])
        self._rank = {mid: r for r, mid in enumerate(self._pool_by_sitelinks)}

    @staticmethod
    def _load(path):
        opener = gzip.open if path.endswith(".gz") else open
        with opener(path, "rt", encoding="utf-8") as f:
            data = json.load(f)
        return data["movies"], data["movie_fields"], data["connections"]

    def _build_movie_values(self):
        movie_values = defaultdict(lambda: defaultdict(set))
        for conn_type, group_map in self.connections.items():
            if conn_type not in self.config["connection_types"]:
                continue
            for value, id_list in group_map.items():
                if len(id_list) < 2:
                    continue
                for mid in id_list:
                    movie_values[mid][conn_type].add(value)
        return movie_values

    def movie(self, movie_id):
        """Return the movie as a dict, e.g. {'title': ..., 'year': ..., ...}"""
        return dict(zip(self.movie_fields, self.movies[movie_id]))

    @property
    def pool_size(self):
        """How many movies are playable in this mode (not the dataset total)."""
        return len(self._pool)

    def random_movie(self, rng=None, exclude=None):
        rng = rng or random
        exclude = exclude or set()
        available = [mid for mid in self._pool if mid not in exclude]
        if not available:
            return rng.choice(self._pool)
        return rng.choice(available)

    def random_start_movie(self, rng=None, max_attempts=50):
        """A random movie that can actually start a run in this mode -- one
        with at least one connection to another movie in the pool.

        The pool filter creates dead ends the full dataset doesn't have: a
        movie whose only connections are to movies below the sitelink floor
        has zero playable connections (1.4% of easy's pool vs 0.4% of
        regular's). Those can only ever be hit as a STARTING movie -- any
        movie reached as a correct answer necessarily connects to the movie
        it was reached from, which is in the pool by construction."""
        rng = rng or random
        for _ in range(max_attempts):
            mid = self.random_movie(rng)
            if self.connected_ids(mid):
                return mid
        return self.random_movie(rng)

    def connections_between(self, a, b):
        """{conn_type: [shared values]} for every connection type that ties
        a and b together -- movie-ladder shows ALL matches, not just one, so
        this doesn't stop at the first hit."""
        a_values = self._movie_values.get(a, {})
        b_values = self._movie_values.get(b, {})
        matches = {}
        for conn_type, a_vals in a_values.items():
            shared = a_vals & b_values.get(conn_type, set())
            if shared:
                matches[conn_type] = sorted(shared)
        return matches

    def connected_ids(self, movie_id):
        """Every other movie IN THIS MODE'S POOL sharing at least one
        connection type/value with movie_id -- the 'has a real connection,
        don't care which kind' set the decoy logic needs. Built lazily per
        movie (not precomputed for all 15k movies), since only the current
        movie's footprint matters per round.

        Pool-filtered here rather than at the call sites so no caller can
        accidentally leak an out-of-pool movie into a round."""
        connected = set()
        for conn_type, values in self._movie_values.get(movie_id, {}).items():
            for value in values:
                connected |= self._pool_set & set(self.connections[conn_type][value])
        connected.discard(movie_id)
        return connected

    def hint_type(self, matches, rng=None):
        """Which connection type to name as an up-front hint, or None for no
        hint (regular mode, or a round whose only matches would give the
        answer away -- see NON_HINTABLE_TYPES). Prefers the rarest applicable
        type; see HINT_PREFERENCE."""
        if not self.config["hint"]:
            return None
        hintable = set(matches) - NON_HINTABLE_TYPES
        if not hintable:
            return None
        for preferred in HINT_PREFERENCE:
            if preferred in hintable:
                return preferred
        return sorted(hintable)[0]

    def mates_of_type(self, movie_id, conn_type):
        """Every movie in the pool sharing a connection of one type with this
        one. Used both to cap hops of a type and to steer towards one.
        Mirrors matesOfType() in movieLadder.ts."""
        mates = set()
        for value in self._movie_values.get(movie_id, {}).get(conn_type, set()):
            mates |= self._pool_set & set(self.connections[conn_type][value])
        mates.discard(movie_id)
        return mates

    def series_mates(self, movie_id):
        """Franchise-mates specifically; see mates_of_type."""
        return self.mates_of_type(movie_id, "same_series")

    def build_round(self, movie_id, rng=None, exclude=None, max_attempts=200,
                    block_series_links=False, block_director_links=False):
        """Build a 3-candidate round for the movie on top of the stack:
        1 with a real connection (any type), 2 with zero connections by any
        type. Returns None if the movie has no valid next move at all (dead
        end -- caller should pick a different movie to restart from).

        block_series_links steers the correct answer away from franchise-
        mates of the current movie; the caller sets it once a floor has used
        its allowance of franchise hops (MAX_SERIES_LINKS_PER_FLOOR in
        App.tsx -- the floor/scoring layer lives in the app, not here). It's
        a preference, not a hard constraint: if every candidate is a
        franchise-mate the round is still built, since refusing would end
        the run outright."""
        rng = rng or random
        exclude = set(exclude or set()) | {movie_id}

        connected = self.connected_ids(movie_id) - exclude
        if not connected:
            return None

        correct_pool = connected
        blocked_types = []
        if block_series_links:
            blocked_types.append("same_series")
        if block_director_links:
            blocked_types.append("same_director")
        for conn_type in blocked_types:
            non_mates = correct_pool - self.mates_of_type(movie_id, conn_type)
            if non_mates:
                correct_pool = non_mates

        preferred = [t for t in self.config["prefer_connection_types"]
                     if t not in blocked_types]
        if preferred:
            wanted = set()
            for conn_type in preferred:
                wanted |= self.mates_of_type(movie_id, conn_type)
            preferred_pool = correct_pool & wanted
            if preferred_pool:
                correct_pool = preferred_pool

        correct_id = rng.choice(sorted(correct_pool))

        decoy_exclude = exclude | connected | {correct_id}
        decoy_source = self._pool
        if self.config["match_decoy_recognizability"]:
            rank = self._rank.get(correct_id, 0)
            lo = max(0, rank - DECOY_RANK_WINDOW)
            hi = min(len(self._pool_by_sitelinks), rank + DECOY_RANK_WINDOW + 1)
            neighbours = [i for i in self._pool_by_sitelinks[lo:hi] if i not in decoy_exclude]
            if len(neighbours) >= 2:
                decoy_source = neighbours

        decoys = []
        attempts = 0
        while len(decoys) < 2 and attempts < max_attempts:
            attempts += 1
            candidate = rng.choice(decoy_source)
            if candidate in decoy_exclude or candidate in decoys:
                continue
            decoys.append(candidate)

        if len(decoys) < 2:
            return None  # dataset too small/too connected to find 2 clean decoys -- rare, but possible for niche movies

        candidates = [CandidateMovie(correct_id, is_correct=True)] + \
                     [CandidateMovie(d, is_correct=False) for d in decoys]
        rng.shuffle(candidates)

        matches = self.connections_between(movie_id, correct_id)

        return Round(current_id=movie_id, candidates=candidates, correct_id=correct_id,
                     matches=matches, hint_type=self.hint_type(matches, rng))

    def build_chain(self, length, start_movie_id=None, rng=None, max_attempts=500):
        """Convenience: build an open-ended chain of `length` movies,
        restarting the current movie if it's a dead end. Movie-ladder's run
        structure has no fixed endpoint in the real game (see CLAUDE.md
        section 5b) -- this is just for demoing/testing a sequence of
        rounds, not a shipped game mechanic. Returns a list of
        (movie_id, matches_used_to_reach_it) tuples; the first entry has
        matches=None since there's no prior connection."""
        rng = rng or random
        start = start_movie_id if start_movie_id is not None else self.random_start_movie(rng)
        chain = [(start, None)]
        seen = {chain[0][0]}

        attempts = 0
        while len(chain) < length and attempts < max_attempts:
            attempts += 1
            current = chain[-1][0]
            round_ = self.build_round(current, rng=rng, exclude=seen)
            if round_ is None:
                if len(chain) > 1:
                    chain.pop()
                    continue
                else:
                    chain[0] = (self.random_start_movie(rng), None)
                    seen = {chain[0][0]}
                    continue
            chain.append((round_.correct_id, round_.matches))
            seen.add(round_.correct_id)

        return chain


def _demo(path, n, mode):
    game = MovieLadder(path, mode=mode)
    print(f"Loaded {len(game.movies)} movies; mode={mode}, "
          f"playable pool={game.pool_size}, "
          f"types={sorted(game.config['connection_types'])}\n")
    chain = game.build_chain(n)
    for i, (movie_id, matches) in enumerate(chain):
        m = game.movie(movie_id)
        if matches:
            match_str = "; ".join(f"{k}: {', '.join(v)}" for k, v in matches.items())
            print(f"  --[{match_str}]-->  {m['title']} ({m['year']}) [{m['sitelinks']} sitelinks]")
        else:
            print(f"{m['title']} ({m['year']}) [{m['sitelinks']} sitelinks]")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("connections_path")
    ap.add_argument("--demo", type=int, default=5, metavar="N",
                     help="Print a demo chain of N movies")
    ap.add_argument("--mode", choices=sorted(MODE_CONFIG), default="regular",
                     help="Difficulty mode to build the chain under (see MODE_CONFIG)")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()
    if args.seed is not None:
        random.seed(args.seed)
    _demo(args.connections_path, args.demo, args.mode)
