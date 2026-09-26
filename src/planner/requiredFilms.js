/**
 * Film-level required-set helpers for the OIFF planner.
 *
 * Required = every Must rating only.
 * Skip/Seen are omitted from candidates by the optimizer (not a separate exclude list).
 */

import { INTEREST_LEVELS } from '../utils/userState'

/**
 * @returns {{
 *   requiredFilmIds: string[],
 *   manualRequiredIds: string[],
 *   mustFilmIds: string[],
 *   contradiction: null | { type: string, filmIds: string[], reason: string }
 * }}
 */
export function resolveRequiredFilms(interests = {}, _constraints = {}) {
  const mustFilmIds = []
  for (const [filmId, interest] of Object.entries(interests)) {
    if (interest === INTEREST_LEVELS.MUST_SEE) {
      mustFilmIds.push(filmId)
    }
  }

  return {
    requiredFilmIds: [...mustFilmIds],
    // Kept empty for back-compat with older UI/tests — manual require list removed.
    manualRequiredIds: [],
    mustFilmIds,
    contradiction: null
  }
}

/**
 * Interest rank for lexicographic scoring (higher is better).
 */
export function interestRank(interest) {
  switch (interest) {
    case INTEREST_LEVELS.MUST_SEE:
      return 4
    case INTEREST_LEVELS.WANT_TO_SEE:
      return 3
    case INTEREST_LEVELS.MAYBE:
      return 2
    case INTEREST_LEVELS.SKIP:
    case INTEREST_LEVELS.SEEN:
      return 0
    default:
      return 1 // unrated
  }
}

/**
 * Stable film-set key for alternative deduplication.
 */
export function filmSetKey(filmIds) {
  return Array.from(filmIds).sort().join('|')
}

/**
 * Lexicographic score tuple:
 * [filmCount, must, want, maybe, unrated]
 */
export function preferenceScore(filmIds, interests = {}) {
  let must = 0
  let want = 0
  let maybe = 0
  let unrated = 0

  for (const id of filmIds) {
    const interest = interests[id]
    if (interest === INTEREST_LEVELS.MUST_SEE) must++
    else if (interest === INTEREST_LEVELS.WANT_TO_SEE) want++
    else if (interest === INTEREST_LEVELS.MAYBE) maybe++
    else if (
      interest !== INTEREST_LEVELS.SKIP &&
      interest !== INTEREST_LEVELS.SEEN
    ) {
      unrated++
    }
  }

  return {
    filmCount: filmIds.size ?? filmIds.length,
    mustSeeCount: must,
    wantToSeeCount: want,
    maybeCount: maybe,
    unratedCount: unrated,
    tuple: [
      filmIds.size ?? filmIds.length,
      must,
      want,
      maybe,
      unrated
    ]
  }
}

export function comparePreferenceTuples(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}
