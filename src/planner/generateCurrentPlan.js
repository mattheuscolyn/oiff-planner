import { generatePlanV3, DEFAULT_TIME_BUDGET_MS } from './optimizerV3'
import { deriveFestivalAvailability } from '../utils/festivalAvailability'
import { getFerries } from '../utils/ferryData'
import { resolveRequiredFilms } from './requiredFilms'

/**
 * Single shared path for every planner regeneration.
 */
export function generateCurrentPlan({
  films,
  screenings,
  interests,
  constraints,
  arrival,
  departure,
  constraintOverrides = {},
  timeBudgetMs = DEFAULT_TIME_BUDGET_MS,
  onProgress = null
}) {
  const ferries = getFerries()
  const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(
    arrival,
    departure,
    ferries
  )

  const mergedConstraints = {
    ...constraints,
    ...constraintOverrides
  }

  // Drop obsolete screening locks if somehow still present
  delete mergedConstraints.lockedScreenings

  return generatePlanV3({
    films,
    screenings,
    interests,
    constraints: mergedConstraints,
    attendanceConstraints: {
      attendanceDays,
      availabilityByDate
    },
    timeBudgetMs,
    onProgress
  })
}

export function appendUniqueId(list = [], id) {
  if (list.includes(id)) return [...list]
  return [...list, id]
}

/**
 * @deprecated Manual exclude list removed — use Skip rating instead.
 * Kept as a no-op clearer for migration/tests.
 */
export function removeRequiredFilm(requiredFilms = [], _filmId) {
  void _filmId
  return requiredFilms.filter(() => false)
}

/**
 * @deprecated Manual exclude list removed — use Skip rating instead.
 * Clears legacy lists only.
 */
export function applyExcludeFilm(_constraints, _filmId) {
  void _constraints
  void _filmId
  return { excludedFilms: [], requiredFilms: [] }
}

export { resolveRequiredFilms, DEFAULT_TIME_BUDGET_MS }
