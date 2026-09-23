/**
 * Apply a conflict-resolution choice to interests + constraints.
 * Never excludes the losing film — only relaxes requirement.
 */

import { INTEREST_LEVELS } from '../utils/userState'
import { removeRequiredFilm } from './generateCurrentPlan'

/**
 * @param {'prioritize'|'relax'} mode
 * @param {string} targetFilmId - film to keep required (prioritize) or relax (relax)
 * @param {string[]} conflictFilmIds
 * @param {object} interests
 * @param {object} constraints
 */
export function resolveConflictChoice({
  mode,
  targetFilmId,
  conflictFilmIds,
  interests = {},
  constraints = {}
}) {
  const interestUpdates = { ...interests }
  let requiredFilms = [...(constraints.requiredFilms || [])]
  const explanations = []

  const others = conflictFilmIds.filter(id => id !== targetFilmId)

  if (mode === 'relax') {
    // Explicitly relax only the target film
    const rating = interests[targetFilmId]
    if (rating === INTEREST_LEVELS.MUST_SEE) {
      interestUpdates[targetFilmId] = INTEREST_LEVELS.WANT_TO_SEE
      explanations.push('Moved from Must to Want (no longer automatically required).')
    }
    requiredFilms = removeRequiredFilm(requiredFilms, targetFilmId)
    if (rating !== INTEREST_LEVELS.MUST_SEE) {
      explanations.push('Removed manual Require; rating preserved.')
    }
    return {
      interestUpdates,
      constraintUpdates: { requiredFilms },
      explanations
    }
  }

  // mode === 'prioritize' — keep targetFilmId required; relax each other film
  const targetRating = interests[targetFilmId]
  if (targetRating !== INTEREST_LEVELS.MUST_SEE) {
    // Ensure chosen film stays in manual required list
    if (!requiredFilms.includes(targetFilmId)) {
      requiredFilms = [...requiredFilms, targetFilmId]
    }
  }

  for (const otherId of others) {
    const otherRating = interests[otherId]
    if (otherRating === INTEREST_LEVELS.MUST_SEE) {
      interestUpdates[otherId] = INTEREST_LEVELS.WANT_TO_SEE
      explanations.push(
        `“${otherId}” moves from Must to Want and may still appear if it fits.`
      )
    }
    requiredFilms = removeRequiredFilm(requiredFilms, otherId)
  }

  // If user prioritizes a manual Want over a Must, Musts already demoted above.
  if (targetRating === INTEREST_LEVELS.MUST_SEE) {
    explanations.unshift('Keeping this film as Must (still required).')
  } else {
    explanations.unshift('Keeping this film Required.')
  }

  return {
    interestUpdates,
    constraintUpdates: { requiredFilms },
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
      detail: `Keep ${chosenFilm.title} as Must. Remove the manual Require on ${otherFilm.title} (rating stays ${formatInterest(interests[otherFilm.id])}).`
    }
  }
  if (!chosenIsMust && otherIsMust) {
    return {
      headline: `Prioritize ${chosenFilm.title}`,
      detail: `Keep ${chosenFilm.title} Required. ${otherFilm.title} will move from Must to Want because Must always means required.`
    }
  }
  return {
    headline: `Prioritize ${chosenFilm.title}`,
    detail: `Keep ${chosenFilm.title} Required. Remove the manual Require on ${otherFilm.title} (ratings preserved).`
  }
}

function formatInterest(level) {
  switch (level) {
    case INTEREST_LEVELS.MUST_SEE:
      return 'Must'
    case INTEREST_LEVELS.WANT_TO_SEE:
      return 'Want'
    case INTEREST_LEVELS.MAYBE:
      return 'Maybe'
    default:
      return 'its current rating'
  }
}
