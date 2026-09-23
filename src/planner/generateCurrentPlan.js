import { generatePlanV3 } from './optimizerV3'
import { deriveFestivalAvailability } from '../utils/festivalAvailability'
import { getFerries } from '../utils/ferryData'

/**
 * Single shared path for every planner regeneration.
 * Always re-derives attendance from current arrival/departure + ferries.
 *
 * @param {object} options
 * @param {Array} options.films
 * @param {Array} options.screenings
 * @param {object} options.interests
 * @param {object} options.constraints - current planner constraints
 * @param {object} options.arrival
 * @param {object} options.departure
 * @param {object} [options.constraintOverrides={}] - merged over constraints for this run
 * @param {number} [options.timeBudgetMs=750]
 * @returns {object} generatePlanV3 result
 */
export function generateCurrentPlan({
  films,
  screenings,
  interests,
  constraints,
  arrival,
  departure,
  constraintOverrides = {},
  timeBudgetMs = 750
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

  return generatePlanV3({
    films,
    screenings,
    interests,
    constraints: mergedConstraints,
    attendanceConstraints: {
      attendanceDays,
      availabilityByDate
    },
    timeBudgetMs
  })
}

/**
 * Append an id to a list without duplicates.
 * @param {string[]} list
 * @param {string} id
 * @returns {string[]}
 */
export function appendUniqueId(list = [], id) {
  if (list.includes(id)) return [...list]
  return [...list, id]
}

/**
 * Remove locked screenings that belong to the given film (Exclude wins).
 * @param {string[]} lockedScreenings
 * @param {string} filmId
 * @param {Array} allScreenings
 * @returns {string[]}
 */
export function removeLocksForFilm(lockedScreenings = [], filmId, allScreenings) {
  const screeningMap = new Map(allScreenings.map(s => [s.id, s]))
  return lockedScreenings.filter(id => {
    const screening = screeningMap.get(id)
    return screening && screening.filmId !== filmId
  })
}
