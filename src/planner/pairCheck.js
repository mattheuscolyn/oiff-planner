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

function currentPlanProof(currentPlan) {
  return !!currentPlan?.metadata?.maxFilmCountProven
}

function pairPlanProof(pairPlan) {
  return !!pairPlan?.metadata?.maxFilmCountProven
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

  const currentMaxFilmCountProven = currentPlanProof(currentPlan)

  if (pairPlan?.infeasible) {
    return {
      status: 'infeasible',
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
      currentMaxFilmCountProven,
      pairMaxFilmCountProven: false,
      maxFilmCountProven: false,
      preferenceOptimalityProven: false
    }
  }

  const { adds, drops } = summarizePairCheckDiff(currentPlan, pairPlan, filmMap)
  const delta = pairPlan.filmCount - currentPlan.filmCount
  const pairMaxFilmCountProven = pairPlanProof(pairPlan)
  const preferenceOptimalityProven = !!pairPlan.metadata?.preferenceOptimalityProven

  return {
    status: 'feasible',
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
    currentMaxFilmCountProven,
    pairMaxFilmCountProven,
    // Back-compat alias for pair proof
    maxFilmCountProven: pairMaxFilmCountProven,
    preferenceOptimalityProven,
    pairFilmSetKey: filmSetKey(pairPlan.filmIds || [])
  }
}

/**
 * Runtime/worker failure — distinct from optimizer infeasibility.
 */
export function shapePairCheckError({
  error,
  filmIdA,
  filmIdB,
  currentPlan
}) {
  return {
    status: 'error',
    feasible: false,
    reasonCode: 'pair-check-error',
    reason: error?.message || 'Pair check failed',
    conflict: null,
    unavailable: null,
    filmIdA,
    filmIdB,
    currentFilmCount: currentPlan?.filmCount ?? null,
    pairFilmCount: 0,
    filmCountDelta: null,
    screeningA: null,
    screeningB: null,
    adds: [],
    drops: [],
    currentMaxFilmCountProven: currentPlanProof(currentPlan),
    pairMaxFilmCountProven: false,
    maxFilmCountProven: false,
    preferenceOptimalityProven: false
  }
}

/**
 * Honest count copy for a feasible pair-check result.
 * Never claims "maximum" unless pairMaxFilmCountProven (or maxFilmCountProven).
 */
export function formatPairCheckCountCopy(pairCheck) {
  const pairCount = pairCheck.pairFilmCount
  const currentCount = pairCheck.currentFilmCount
  const delta = pairCheck.filmCountDelta
  const pairProven = !!(
    pairCheck.pairMaxFilmCountProven ?? pairCheck.maxFilmCountProven
  )
  const currentProven = !!pairCheck.currentMaxFilmCountProven

  if (pairProven) {
    if (delta === 0) {
      if (currentProven) {
        return `You can still see ${pairCount} films — the same proven maximum.`
      }
      return `You can still see ${pairCount} films. The ${pairCount}-film maximum is proven for this requirement set.`
    }
    if (delta < 0) {
      return `Both can fit. With both required, the maximum is ${pairCount} films instead of the current ${currentCount}-film plan.`
    }
    return `Both can fit. With both required, the maximum is ${pairCount} films.`
  }

  // Unproven pair count — "best found" language only
  if (delta === 0) {
    return `You can still see ${pairCount} films in the best schedule found.`
  }
  if (delta < 0) {
    return `Both can fit. The best schedule found with both has ${pairCount} films, compared with ${currentCount} in your current plan.`
  }
  return `The best schedule found with both has ${pairCount} films.`
}

/**
 * Compact proof footnotes for the pair-check card (feasible only).
 */
export function formatPairCheckProofLines(pairCheck) {
  if (!pairCheck?.feasible) return []
  const pairProven = !!(
    pairCheck.pairMaxFilmCountProven ?? pairCheck.maxFilmCountProven
  )
  const lines = []
  if (pairProven) {
    lines.push('Film count proven')
  } else {
    lines.push('Film count best found within search budget')
  }
  if (pairCheck.preferenceOptimalityProven) {
    lines.push('Best preference mix proven')
  } else if (pairProven) {
    lines.push('Best preference mix found within search budget')
  }
  return lines
}
