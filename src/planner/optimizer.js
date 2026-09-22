/**
 * Festival plan optimizer
 * 
 * Uses dynamic programming with constraint satisfaction to find optimal
 * festival schedules that maximize distinct films while respecting all
 * hard constraints (locked screenings, availability windows, etc.)
 */

import { getScreeningEndTime } from '../utils/festivalData'
import { INTEREST_LEVELS } from '../utils/userState'
import {
  isScreeningAvailable,
  wouldViolateMaxFilms,
  conflictsWithExisting,
  hasAdequateTransition,
  hasMealBreak,
  validatePlan
} from './constraints'
import { scorePlan, getFilmWeight, countByInterest, calculateAvailableStats } from './scoring'

/**
 * Generate an optimized festival plan
 * 
 * @param {Object} params
 * @param {Array} params.films - All festival films
 * @param {Array} params.screenings - All festival screenings  
 * @param {Object} params.interests - Film interest ratings
 * @param {Object} params.constraints - Hard constraints
 * @param {string} params.objective - Optimization objective
 * @returns {Object} Generated plan with screenings and metadata
 */
export function generatePlan(params) {
  const { films, screenings, interests, constraints, objective } = params
  
  const candidateScreenings = filterCandidateScreenings(
    screenings,
    films,
    interests,
    constraints
  )
  
  if (candidateScreenings.length === 0) {
    return {
      screenings: [],
      infeasible: constraints.requiredFilms?.length > 0,
      reason: 'No feasible screenings available with current constraints'
    }
  }
  
  const lockedScreenings = getLockedScreenings(screenings, constraints)
  
  if (lockedScreenings.conflicts.length > 0) {
    return {
      screenings: [],
      infeasible: true,
      reason: `Locked screenings conflict with each other: ${lockedScreenings.conflicts.join(', ')}`
    }
  }
  
  const result = optimizeSchedule(
    candidateScreenings,
    films,
    interests,
    constraints,
    objective,
    lockedScreenings.screenings
  )
  
  if (result.infeasible) {
    return result
  }
  
  const validation = validatePlan(result, constraints)
  if (!validation.valid) {
    console.error('Generated invalid plan:', validation.errors)
    return {
      screenings: [],
      infeasible: true,
      reason: `Plan validation failed: ${validation.errors.join(', ')}`
    }
  }
  
  const score = scorePlan(result, interests, objective)
  const interestCounts = countByInterest(result.screenings, interests)
  const availableStats = calculateAvailableStats(films, interests)
  
  const omittedHighPriority = findOmittedFilms(
    result.screenings,
    films,
    screenings,
    interests,
    candidateScreenings
  )
  
  return {
    ...result,
    score,
    interestCounts,
    availableStats,
    omittedHighPriority,
    objective
  }
}

/**
 * Helper to get film by ID from the provided films array
 */
function getFilmById(films, filmId) {
  return films.find(f => f.id === filmId)
}

/**
 * Helper to get screenings for a film
 */
function getScreeningsForFilm(screenings, filmId) {
  return screenings.filter(s => s.filmId === filmId)
}

/**
 * Filter screenings to only those that are valid candidates
 */
function filterCandidateScreenings(screenings, films, interests, constraints) {
  const {
    excludedFilms = [],
    includeSkip = false,
    includeSeen = false,
    availabilityWindows = {}
  } = constraints
  
  return screenings.filter(screening => {
    const film = getFilmById(films, screening.filmId)
    if (!film) return false
    
    if (excludedFilms.includes(film.id)) return false
    
    const interest = interests[film.id]
    if (!includeSkip && interest === INTEREST_LEVELS.SKIP) return false
    if (!includeSeen && interest === INTEREST_LEVELS.SEEN) return false
    
    if (!isScreeningAvailable(screening, availabilityWindows)) return false
    
    return true
  })
}

/**
 * Get locked screenings and check for conflicts
 */
function getLockedScreenings(allScreenings, constraints) {
  const { lockedScreenings: lockedIds = [] } = constraints
  
  const screenings = lockedIds
    .map(id => allScreenings.find(s => s.id === id))
    .filter(Boolean)
  
  const conflicts = []
  for (let i = 0; i < screenings.length; i++) {
    for (let j = i + 1; j < screenings.length; j++) {
      if (conflictsWithExisting(screenings[i], [screenings[j]])) {
        conflicts.push(`${screenings[i].id} and ${screenings[j].id}`)
      }
    }
  }
  
  return { screenings, conflicts }
}

/**
 * Main optimization algorithm
 * Uses weighted interval scheduling with additional constraints
 */
function optimizeSchedule(
  candidateScreenings,
  films,
  interests,
  constraints,
  objective,
  lockedScreenings
) {
  const sortedScreenings = [...candidateScreenings].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return a.startTime.localeCompare(b.startTime)
  })
  
  const filmToScreenings = {}
  for (const screening of sortedScreenings) {
    if (!filmToScreenings[screening.filmId]) {
      filmToScreenings[screening.filmId] = []
    }
    filmToScreenings[screening.filmId].push(screening)
  }
  
  const result = search(
    [],
    sortedScreenings,
    filmToScreenings,
    new Set(),
    interests,
    constraints,
    objective,
    lockedScreenings
  )
  
  if (!result) {
    const requiredFilms = constraints.requiredFilms || []
    if (requiredFilms.length > 0) {
      return {
        screenings: [],
        infeasible: true,
        reason: 'Cannot satisfy all required films with current constraints'
      }
    }
    return { screenings: [] }
  }
  
  return { screenings: result }
}

/**
 * Recursive search with memoization
 * Explores the space of valid schedules to find the optimal one
 */
function search(
  currentPlan,
  remainingScreenings,
  filmToScreenings,
  usedFilms,
  interests,
  constraints,
  objective,
  lockedScreenings
) {
  if (lockedScreenings.length > 0 && currentPlan.length === 0) {
    for (const locked of lockedScreenings) {
      currentPlan.push(locked)
      usedFilms.add(locked.filmId)
    }
  }
  
  const requiredFilms = constraints.requiredFilms || []
  const allRequired = requiredFilms.every(filmId => usedFilms.has(filmId))
  
  if (allRequired && remainingScreenings.length === 0) {
    return currentPlan
  }
  
  let bestPlan = allRequired ? currentPlan : null
  let bestScore = bestPlan ? scorePlan({ screenings: bestPlan }, interests, objective).totalScore : -Infinity
  
  for (let i = 0; i < remainingScreenings.length; i++) {
    const screening = remainingScreenings[i]
    
    if (usedFilms.has(screening.filmId)) continue
    
    if (conflictsWithExisting(screening, currentPlan)) continue
    
    if (wouldViolateMaxFilms(currentPlan, screening, constraints)) continue
    
    const newPlan = [...currentPlan, screening]
    const newUsed = new Set(usedFilms)
    newUsed.add(screening.filmId)
    
    const newRemaining = remainingScreenings.slice(i + 1).filter(s => 
      !newUsed.has(s.filmId) && !conflictsWithExisting(s, newPlan)
    )
    
    const candidate = search(
      newPlan,
      newRemaining,
      filmToScreenings,
      newUsed,
      interests,
      constraints,
      objective,
      []
    )
    
    if (candidate) {
      const candidateScore = scorePlan({ screenings: candidate }, interests, objective).totalScore
      if (candidateScore > bestScore) {
        bestScore = candidateScore
        bestPlan = candidate
      }
    }
  }
  
  return bestPlan
}

/**
 * Find high-priority films that were omitted from the plan
 */
function findOmittedFilms(includedScreenings, allFilms, allScreenings, interests, candidateScreenings) {
  const includedFilmIds = new Set(includedScreenings.map(s => s.filmId))
  const candidateFilmIds = new Set(candidateScreenings.map(s => s.filmId))
  
  const omitted = allFilms
    .filter(film => {
      if (includedFilmIds.has(film.id)) return false
      if (!candidateFilmIds.has(film.id)) return false
      
      const interest = interests[film.id]
      return interest === INTEREST_LEVELS.MUST_SEE || 
             interest === INTEREST_LEVELS.WANT_TO_SEE
    })
    .map(film => {
      const filmScreenings = getScreeningsForFilm(allScreenings, film.id)
      const feasibleScreenings = filmScreenings.filter(s => 
        candidateScreenings.some(c => c.id === s.id)
      )
      
      let reason = 'No compatible screening'
      
      if (feasibleScreenings.length === 0) {
        reason = 'Not available within your time windows'
      } else {
        const allConflict = feasibleScreenings.every(s => 
          conflictsWithExisting(s, includedScreenings)
        )
        if (allConflict) {
          const conflictingFilms = new Set()
          for (const s of feasibleScreenings) {
            for (const included of includedScreenings) {
              if (conflictsWithExisting(s, [included])) {
                const conflictFilm = getFilmById(allFilms, included.filmId)
                if (conflictFilm) conflictingFilms.add(conflictFilm.title)
              }
            }
          }
          reason = conflictingFilms.size > 0 
            ? `Conflicts with: ${Array.from(conflictingFilms).slice(0, 2).join(', ')}`
            : 'Scheduling conflict'
        }
      }
      
      return {
        film,
        interest: interests[film.id],
        reason,
        screeningCount: feasibleScreenings.length
      }
    })
    .sort((a, b) => {
      if (a.interest === b.interest) {
        return a.film.title.localeCompare(b.film.title)
      }
      return a.interest === INTEREST_LEVELS.MUST_SEE ? -1 : 1
    })
  
  return omitted
}

/**
 * Replace a screening in an existing plan with an alternative
 * Returns a new optimized plan with the replacement
 */
export function replaceScreening(currentPlan, oldScreeningId, newScreeningId, params) {
  const { screenings: allScreenings, films, interests, constraints, objective } = params
  
  const newScreening = allScreenings.find(s => s.id === newScreeningId)
  if (!newScreening) {
    return { error: 'New screening not found' }
  }
  
  const planWithoutOld = currentPlan.screenings.filter(s => s.id !== oldScreeningId)
  const lockedScreenings = [...planWithoutOld, newScreening]
  
  const candidateScreenings = filterCandidateScreenings(
    allScreenings,
    films,
    interests,
    constraints
  ).filter(s => !lockedScreenings.some(locked => locked.id === s.id))
  
  const result = optimizeSchedule(
    candidateScreenings,
    films,
    interests,
    constraints,
    objective,
    lockedScreenings
  )
  
  if (result.infeasible) {
    return result
  }
  
  const score = scorePlan(result, interests, objective)
  const interestCounts = countByInterest(result.screenings, interests)
  
  return {
    ...result,
    score,
    interestCounts,
    objective
  }
}
