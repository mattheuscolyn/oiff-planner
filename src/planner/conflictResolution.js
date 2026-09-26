/**
 * Apply a conflict-resolution choice via ratings only.
 * Never excludes the losing film — only relaxes Must → Want.
 */

import { INTEREST_LEVELS } from '../utils/userState'

/**
 * @param {'prioritize'|'relax'} mode
 * @param {string} targetFilmId - film to keep as Must (prioritize) or relax (relax)
 * @param {string[]} conflictFilmIds
 * @param {object} interests
 */
export function resolveConflictChoice({
  mode,
  targetFilmId,
  conflictFilmIds,
  interests = {},
  constraints: _constraints = {}
}) {
  const interestUpdates = { ...interests }
  const explanations = []
  const others = conflictFilmIds.filter(id => id !== targetFilmId)

  if (mode === 'relax') {
    if (interests[targetFilmId] === INTEREST_LEVELS.MUST_SEE) {
      interestUpdates[targetFilmId] = INTEREST_LEVELS.WANT_TO_SEE
      explanations.push('Moved from Must to Want (no longer required).')
    }
    return {
      interestUpdates,
      constraintUpdates: { requiredFilms: [], excludedFilms: [] },
      explanations
    }
  }

  // prioritize — keep target as Must; demote other Musts to Want
  if (interests[targetFilmId] !== INTEREST_LEVELS.MUST_SEE) {
    interestUpdates[targetFilmId] = INTEREST_LEVELS.MUST_SEE
    explanations.push('Marked as Must (required in the plan).')
  } else {
    explanations.unshift('Keeping this film as Must (still required).')
  }

  for (const otherId of others) {
    if (interests[otherId] === INTEREST_LEVELS.MUST_SEE) {
      interestUpdates[otherId] = INTEREST_LEVELS.WANT_TO_SEE
      explanations.push('Moved the other Must to Want so this one can fit.')
    }
  }

  return {
    interestUpdates,
    // Always clear legacy constraint lists
    constraintUpdates: { requiredFilms: [], excludedFilms: [] },
    explanations
  }
}

/**
 * Human-readable preview copy before confirming a pairwise prioritize action.
 */
export function describePrioritizeChoice({
  chosenFilm,
  otherFilm,
  interests = {}
}) {
  const chosenIsMust = interests[chosenFilm.id] === INTEREST_LEVELS.MUST_SEE
  const otherIsMust = interests[otherFilm.id] === INTEREST_LEVELS.MUST_SEE

  if (chosenIsMust && otherIsMust) {
    return {
      headline: `Prioritize ${chosenFilm.title}`,
      detail: `Keep ${chosenFilm.title} as Must. ${otherFilm.title} will move to Want and may still be included if it fits.`
    }
  }
  if (chosenIsMust && !otherIsMust) {
    return {
      headline: `Prioritize ${chosenFilm.title}`,
      detail: `Keep ${chosenFilm.title} as Must.`
    }
  }
  if (!chosenIsMust && otherIsMust) {
    return {
      headline: `Prioritize ${chosenFilm.title}`,
      detail: `Mark ${chosenFilm.title} as Must. ${otherFilm.title} will move from Must to Want.`
    }
  }
  return {
    headline: `Prioritize ${chosenFilm.title}`,
    detail: `Mark ${chosenFilm.title} as Must.`
  }
}
