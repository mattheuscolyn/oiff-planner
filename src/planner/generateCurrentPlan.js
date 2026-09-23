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
 * Remove a film from the manual requiredFilms list.
 */
export function removeRequiredFilm(requiredFilms = [], filmId) {
  return requiredFilms.filter(id => id !== filmId)
}

/**
 * When excluding a film, also clear any manual require override.
 */
export function applyExcludeFilm(constraints, filmId) {
  const excludedFilms = appendUniqueId(constraints.excludedFilms, filmId)
  const requiredFilms = removeRequiredFilm(constraints.requiredFilms, filmId)
  return { excludedFilms, requiredFilms }
}

export { resolveRequiredFilms, DEFAULT_TIME_BUDGET_MS }
