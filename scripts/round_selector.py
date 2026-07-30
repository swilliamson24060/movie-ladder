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


class MovieLadder:
    def __init__(self, connections_path):
        self.movies, self.movie_fields, self.connections = self._load(connections_path)
        # movie_id -> {conn_type: set(values)} -- every group this movie belongs to,
        # across every connection type, keyed by the exact display value (e.g. a
        # director's name) so it can be shown to the player as-is.
        self._movie_values = self._build_movie_values()

    @staticmethod
    def _load(path):
        opener = gzip.open if path.endswith(".gz") else open
        with opener(path, "rt", encoding="utf-8") as f:
            data = json.load(f)
        return data["movies"], data["movie_fields"], data["connections"]

    def _build_movie_values(self):
        movie_values = defaultdict(lambda: defaultdict(set))
        for conn_type, group_map in self.connections.items():
            if conn_type not in ACTIVE_CONNECTION_TYPES:
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

    def random_movie(self, rng=None, exclude=None):
        rng = rng or random
        exclude = exclude or set()
        while True:
            mid = rng.randrange(len(self.movies))
            if mid not in exclude:
                return mid

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
        """Every other movie sharing at least one connection type/value with
        movie_id -- the 'has a real connection, don't care which kind' set
        the decoy logic needs. Built lazily per movie (not precomputed for
        all 17k movies), since only the current movie's footprint matters
        per round."""
        connected = set()
        for conn_type, values in self._movie_values.get(movie_id, {}).items():
            for value in values:
                connected |= set(self.connections[conn_type][value])
        connected.discard(movie_id)
        return connected

    def build_round(self, movie_id, rng=None, exclude=None, max_attempts=200):
        """Build a 3-candidate round for the movie on top of the stack:
        1 with a real connection (any type), 2 with zero connections by any
        type. Returns None if the movie has no valid next move at all (dead
        end -- caller should pick a different movie to restart from)."""
        rng = rng or random
        exclude = set(exclude or set()) | {movie_id}

        connected = self.connected_ids(movie_id) - exclude
        if not connected:
            return None

        correct_id = rng.choice(sorted(connected))

        decoys = []
        attempts = 0
        while len(decoys) < 2 and attempts < max_attempts:
            attempts += 1
            candidate = self.random_movie(rng, exclude=exclude | connected | set(decoys) | {correct_id})
            decoys.append(candidate)

        if len(decoys) < 2:
            return None  # dataset too small/too connected to find 2 clean decoys -- rare, but possible for niche movies

        candidates = [CandidateMovie(correct_id, is_correct=True)] + \
                     [CandidateMovie(d, is_correct=False) for d in decoys]
        rng.shuffle(candidates)

        matches = self.connections_between(movie_id, correct_id)

        return Round(current_id=movie_id, candidates=candidates, correct_id=correct_id, matches=matches)

    def build_chain(self, length, start_movie_id=None, rng=None, max_attempts=500):
        """Convenience: build an open-ended chain of `length` movies,
        restarting the current movie if it's a dead end. Movie-ladder's run
        structure has no fixed endpoint in the real game (see CLAUDE.md
        section 5b) -- this is just for demoing/testing a sequence of
        rounds, not a shipped game mechanic. Returns a list of
        (movie_id, matches_used_to_reach_it) tuples; the first entry has
        matches=None since there's no prior connection."""
        rng = rng or random
        chain = [(start_movie_id if start_movie_id is not None else self.random_movie(rng), None)]
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
                    chain[0] = (self.random_movie(rng), None)
                    seen = {chain[0][0]}
                    continue
            chain.append((round_.correct_id, round_.matches))
            seen.add(round_.correct_id)

        return chain


def _demo(path, n):
    game = MovieLadder(path)
    print(f"Loaded {len(game.movies)} movies\n")
    chain = game.build_chain(n)
    for i, (movie_id, matches) in enumerate(chain):
        m = game.movie(movie_id)
        if matches:
            match_str = "; ".join(f"{k}: {', '.join(v)}" for k, v in matches.items())
            print(f"  --[{match_str}]-->  {m['title']} ({m['year']})")
        else:
            print(f"{m['title']} ({m['year']})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("connections_path")
    ap.add_argument("--demo", type=int, default=5, metavar="N",
                     help="Print a demo chain of N movies")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()
    if args.seed is not None:
        random.seed(args.seed)
    _demo(args.connections_path, args.demo)
