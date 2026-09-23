/**
 * Temporary "Can I See Both?" pair check + Require Both helpers.
 * Does not mutate saved state — callers apply results explicitly.
 */

import { INTEREST_LEVELS } from '../utils/userState'
import { appendUniqueId } from './generateCurrentPlan'
import { summarizePairCheckDiff } from './slotOptions'
import { filmSetKey } from './requiredFilms'

/**
 * Build requiredFilms list that includes both films (film-level).
 */
export function buildRequireBothUpdates(constraints = {}, filmIdA, filmIdB, interests = {}) {
  let requiredFilms = [...(constraints.requiredFilms || [])]
  for (const id of [filmIdA, filmIdB]) {
    if (interests[id] === INTEREST_LEVELS.MUST_SEE) continue
    requiredFilms = appendUniqueId(requiredFilms, id)
  }
  return { requiredFilms }
}

/**
 * Constraint overrides for a temporary pair probe (no persisted mutation).
 */
export function buildPairCheckConstraintOverrides(constraints = {}, filmIdA, filmIdB, interests = {}) {
  return buildRequireBothUpdates(constraints, filmIdA, filmIdB, interests)
}

/**
 * Shape a user-facing pair-check result from optimizer output vs current plan.
 */
export function shapePairCheckResult({
  currentPlan,
  pairPlan,
  filmIdA,
  filmIdB,
  filmMap
}) {
  const screeningFor = (plan, filmId) =>
    (plan.screenings || []).find(s => s.filmId === filmId) || null

  if (pairPlan?.infeasible) {
    return {
      feasible: false,
      reasonCode: pairPlan.reasonCode || 'infeasible',
      reason: pairPlan.reason || 'No feasible schedule contains both films.',
      conflict: pairPlan.conflict || null,
      unavailable: pairPlan.unavailable || null,
      filmIdA,
      filmIdB,
      currentFilmCount: currentPlan.filmCount,
      pairFilmCount: 0,
      filmCountDelta: null,
      screeningA: null,
      screeningB: null,
      adds: [],
      drops: [],
      maxFilmCountProven: false,
      preferenceOptimalityProven: false
    }
  }

  const { adds, drops } = summarizePairCheckDiff(currentPlan, pairPlan, filmMap)
  const delta = pairPlan.filmCount - currentPlan.filmCount

  return {
    feasible: true,
    reasonCode: null,
    reason: null,
    conflict: null,
    unavailable: null,
    filmIdA,
    filmIdB,
    currentFilmCount: currentPlan.filmCount,
    pairFilmCount: pairPlan.filmCount,
    filmCountDelta: delta,
    screeningA: screeningFor(pairPlan, filmIdA),
    screeningB: screeningFor(pairPlan, filmIdB),
    adds,
    drops,
    maxFilmCountProven: !!pairPlan.metadata?.maxFilmCountProven,
    preferenceOptimalityProven: !!pairPlan.metadata?.preferenceOptimalityProven,
    pairFilmSetKey: filmSetKey(pairPlan.filmIds || [])
  }
}
