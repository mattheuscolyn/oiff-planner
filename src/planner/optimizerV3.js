/**
 * Festival Plan Optimizer V3
 * 
 * Architecture: Daily Schedule Enumeration + Global Combination
 * 
 * Primary objective: Maximize distinct film count
 * Secondary objectives: Must See > Want to See > Maybe
 * 
 * Strategy:
 * 1. For each festival day, enumerate all valid non-overlapping schedules
 * 2. Prune dominated schedules (fewer films with same constraints)
 * 3. Combine daily schedules ensuring each film appears at most once globally
 * 4. Select best combination using lexicographic objective
 */

import { INTEREST_LEVELS } from '../utils/userState'

/**
 * Generate plan using daily enumeration approach
 */
export function generatePlanV3(config) {
  const {
    films,
    screenings,
    interests = {},
    constraints = {},
    attendanceConstraints = {},
    timeBudgetMs = 3000 // More generous for exact solving
  } = config

  const startTime = performance.now()

  // Precompute data structures
  const data = precomputeData(films, screenings, interests, constraints, attendanceConstraints)

  console.log(`[OptimizerV3] Candidate films: ${data.candidateFilms.length}`)
  console.log(`[OptimizerV3] Candidate screenings: ${data.candidateScreenings.length}`)

  // Enumerate valid daily schedules
  const dailySchedules = enumerateDailySchedules(data, interests)
  
  // Combine across days to find global maximum
  const result = findOptimalGlobalCombination(dailySchedules, data, interests, timeBudgetMs - (performance.now() - startTime))

  const totalMs = performance.now() - startTime
  console.log(`[OptimizerV3] Total time: ${totalMs.toFixed(1)}ms`)

  return result
}

/**
 * Precompute data structures
 */
function precomputeData(films, screenings, interests, constraints, attendanceConstraints) {
  const {
    excludedFilms = [],
    lockedScreenings = [],
    includeSkip = false,
    includeSeen = false
  } = constraints

  const { attendanceDays = {}, availabilityByDate = {} } = attendanceConstraints

  // Build maps
  const filmMap = new Map()
  films.forEach(f => filmMap.set(f.id, f))

  const screeningMap = new Map()
  const filmToScreenings = new Map()
  screenings.forEach(s => {
    screeningMap.set(s.id, s)
    if (!filmToScreenings.has(s.filmId)) {
      filmToScreenings.set(s.filmId, [])
    }
    filmToScreenings.get(s.filmId).push(s)
  })

  // Filter candidate films and build feasible screenings by day
  const candidateFilms = []
  const screeningsByDay = new Map()
  const filmToFeasibleScreenings = new Map()
  const lockedScreeningSet = new Set(lockedScreenings)

  for (const film of films) {
    // Skip excluded films
    if (excludedFilms.includes(film.id)) continue

    const interest = interests[film.id]
    if (!includeSkip && interest === INTEREST_LEVELS.SKIP) continue
    if (!includeSeen && interest === INTEREST_LEVELS.SEEN) continue

    // Get feasible screenings
    const filmScreenings = filmToScreenings.get(film.id) || []
    const feasibleScreenings = filmScreenings.filter(s => {
      // Locked screenings are always feasible
      if (lockedScreeningSet.has(s.id)) return true
      
      // Check attendance day
      if (!attendanceDays[s.date]) return false

      // Check time availability - enforce EACH constraint independently
      const dayAvail = availabilityByDate[s.date]
      if (dayAvail) {
        const screeningStart = getScreeningStartMinutes(s)
        const screeningEnd = getScreeningEndMinutes(s, film)
        
        // Check 'from' constraint if present
        if (dayAvail.from) {
          const availFrom = parseTimeToMinutes(dayAvail.from)
          if (screeningStart < availFrom) {
            return false
          }
        }
        
        // Check 'until' constraint if present
        if (dayAvail.until) {
          const availUntil = parseTimeToMinutes(dayAvail.until)
          if (screeningEnd > availUntil) {
            return false
          }
        }
      }

      return true
    })

    if (feasibleScreenings.length > 0) {
      candidateFilms.push(film)
      filmToFeasibleScreenings.set(film.id, feasibleScreenings)

      // Group by day
      feasibleScreenings.forEach(s => {
        if (!screeningsByDay.has(s.date)) {
          screeningsByDay.set(s.date, [])
        }
        screeningsByDay.get(s.date).push(s)
      })
    }
  }

  return {
    filmMap,
    screeningMap,
    filmToScreenings,
    filmToFeasibleScreenings,
    candidateFilms,
    candidateScreenings: Array.from(screeningsByDay.values()).flat(),
    screeningsByDay,
    lockedScreeningSet,
    attendanceDays,
    interests
  }
}

/**
 * Enumerate all valid non-overlapping schedules for each day
 */
function enumerateDailySchedules(data, interests) {
  const dailySchedules = new Map()

  for (const [date, dayScreenings] of data.screeningsByDay.entries()) {
    console.log(`[OptimizerV3] Enumerating schedules for ${date} (${dayScreenings.length} screenings)...`)
    
    // Sort screenings by start time (use HH:MM minute arithmetic)
    const sorted = dayScreenings.slice().sort((a, b) => 
      getScreeningStartMinutes(a) - getScreeningStartMinutes(b)
    )

    const schedules = []
    
    // Enumerate all valid non-overlapping combinations
    function enumerate(index, current, usedFilms) {
      // Save valid schedule (including empty one for the skip-all-day option)
      schedules.push({
        screenings: current.slice(),
        films: new Set(usedFilms),
        filmCount: usedFilms.size
      })

      // Try adding each remaining screening
      for (let i = index; i < sorted.length; i++) {
        const screening = sorted[i]
        const film = data.filmMap.get(screening.filmId)

        // Skip if film already in schedule
        if (usedFilms.has(screening.filmId)) continue

        // Check if this screening overlaps with any current screening (HH:MM arithmetic)
        const screeningStart = getScreeningStartMinutes(screening)
        const screeningEnd = getScreeningEndMinutes(screening, film)

        let overlaps = false
        for (const existingScreening of current) {
          const existingFilm = data.filmMap.get(existingScreening.filmId)
          const existingStart = getScreeningStartMinutes(existingScreening)
          const existingEnd = getScreeningEndMinutes(existingScreening, existingFilm)

          // Overlap if: screeningStart < existingEnd AND existingStart < screeningEnd
          if (screeningStart < existingEnd && existingStart < screeningEnd) {
            overlaps = true
            break
          }
        }

        if (!overlaps) {
          // Include this screening and continue
          current.push(screening)
          usedFilms.add(screening.filmId)
          enumerate(i + 1, current, usedFilms)
          current.pop()
          usedFilms.delete(screening.filmId)
        }
      }
    }

    enumerate(0, [], new Set())

    // Prune dominated schedules
    const pruned = pruneDominatedSchedules(schedules, data, interests)
    
    console.log(`[OptimizerV3]   ${schedules.length} schedules found, ${pruned.length} after pruning`)
    dailySchedules.set(date, pruned)
  }

  return dailySchedules
}

/**
 * Prune schedules that are strictly dominated
 * Schedule A dominates B if A contains all of B's films plus more
 */
function pruneDominatedSchedules(schedules, data, interests) {
  const nonDominated = []

  for (const schedule of schedules) {
    let isDominated = false

    for (const other of schedules) {
      if (schedule === other) continue

      // Check if 'other' dominates 'schedule'
      if (other.filmCount > schedule.filmCount) {
        // Check if all of schedule's films are in other
        const allIncluded = Array.from(schedule.films).every(filmId => other.films.has(filmId))
        if (allIncluded) {
          isDominated = true
          break
        }
      }
    }

    if (!isDominated) {
      nonDominated.push(schedule)
    }
  }

  return nonDominated
}

/**
 * Find optimal global combination across all days
 */
function findOptimalGlobalCombination(dailySchedules, data, interests, timeBudgetMs) {
  const startTime = performance.now()
  const deadline = startTime + timeBudgetMs

  const days = Array.from(dailySchedules.keys()).sort()
  
  console.log(`[OptimizerV3] Finding optimal global combination...`)
  console.log(`[OptimizerV3] Days to combine: ${days.length}`)

  let bestSolution = null
  let bestScore = null
  let combinationsExplored = 0
  let timedOut = false

  // Recursive combination search
  function combine(dayIndex, globalScreenings, globalFilms) {
    combinationsExplored++

    if (performance.now() >= deadline) {
      timedOut = true
      return
    }

    // Base case: all days combined
    if (dayIndex >= days.length) {
      const solution = evaluateSolution(globalScreenings, interests, data)
      const score = solutionScore(solution)

      if (!bestSolution || compareSolutionScores(score, bestScore) > 0) {
        bestSolution = solution
        bestScore = score
      }
      return
    }

    const date = days[dayIndex]
    const daySchedules = dailySchedules.get(date)

    // Try each daily schedule for this day
    for (const daySchedule of daySchedules) {
      // Check if any films conflict with already selected films
      let hasConflict = false
      for (const filmId of daySchedule.films) {
        if (globalFilms.has(filmId)) {
          hasConflict = true
          break
        }
      }

      if (!hasConflict) {
        // Add this day's schedule
        const newScreenings = [...globalScreenings, ...daySchedule.screenings]
        const newFilms = new Set([...globalFilms, ...daySchedule.films])

        combine(dayIndex + 1, newScreenings, newFilms)
      }
    }

    // Also try skipping this day entirely
    combine(dayIndex + 1, globalScreenings, globalFilms)
  }

  // Handle locked screenings
  const lockedScreenings = data.candidateScreenings.filter(s => data.lockedScreeningSet.has(s.id))
  const lockedFilms = new Set(lockedScreenings.map(s => s.filmId))

  combine(0, lockedScreenings, lockedFilms)

  const elapsed = performance.now() - startTime
  const optimalityProven = !timedOut

  console.log(`[OptimizerV3] Combinations explored: ${combinationsExplored}`)
  console.log(`[OptimizerV3] Best solution: ${bestSolution?.filmCount || 0} films`)
  console.log(`[OptimizerV3] Timed out: ${timedOut}`)
  console.log(`[OptimizerV3] Optimality proven: ${optimalityProven}`)

  if (!bestSolution) {
    return {
      screenings: lockedScreenings,
      interestCounts: {},
      filmCount: lockedFilms.size,
      infeasible: lockedScreenings.length === 0,
      reason: 'No valid schedule found',
      metadata: {
        maxDistinctFilms: 0,
        optimalityProven: false,
        combinationsExplored,
        elapsedMs: elapsed
      }
    }
  }

  return {
    screenings: bestSolution.screenings,
    interestCounts: bestSolution.interestCounts,
    filmCount: bestSolution.filmCount,
    mustSeeCount: bestSolution.mustSeeCount,
    wantToSeeCount: bestSolution.wantToSeeCount,
    maybeCount: bestSolution.maybeCount,
    infeasible: false,
    metadata: {
      maxDistinctFilms: bestSolution.filmCount,
      optimalityProven,
      combinationsExplored,
      elapsedMs: elapsed
    }
  }
}

/**
 * Evaluate a solution
 */
function evaluateSolution(screenings, interests, data) {
  const interestCounts = {
    'must-see': 0,
    'want-to-see': 0,
    'maybe': 0,
    'unrated': 0
  }

  const uniqueFilms = new Set()
  screenings.forEach(s => {
    uniqueFilms.add(s.filmId)
    const interest = interests[s.filmId] || 'unrated'
    interestCounts[interest] = (interestCounts[interest] || 0) + 1
  })

  return {
    screenings,
    filmCount: uniqueFilms.size,
    mustSeeCount: interestCounts['must-see'] || 0,
    wantToSeeCount: interestCounts['want-to-see'] || 0,
    maybeCount: interestCounts['maybe'] || 0,
    unratedCount: interestCounts['unrated'] || 0,
    interestCounts
  }
}

/**
 * Convert solution to comparable score tuple
 */
function solutionScore(solution) {
  return [
    solution.filmCount,
    solution.mustSeeCount,
    solution.wantToSeeCount,
    solution.maybeCount
  ]
}

/**
 * Compare solution scores lexicographically
 * Returns: >0 if a is better, <0 if b is better, 0 if equal
 */
function compareSolutionScores(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/**
 * Helper: Parse time string to minutes since midnight
 * Handles HH:MM format (production format)
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return 0
  
  // Handle HH:MM format (production format)
  if (typeof timeStr === 'string' && timeStr.includes(':')) {
    const [hours, minutes] = timeStr.split(':').map(Number)
    if (!isNaN(hours) && !isNaN(minutes)) {
      return hours * 60 + minutes
    }
  }

  return 0
}

/**
 * Alias for compatibility with existing code
 */
function parseTimeToMinutes(timeStr) {
  return timeToMinutes(timeStr)
}

/**
 * Helper: Get screening start time in minutes since midnight
 */
function getScreeningStartMinutes(screening) {
  return timeToMinutes(screening.startTime)
}

/**
 * Helper: Get screening end time in minutes since midnight
 */
function getScreeningEndMinutes(screening, film) {
  if (screening.endTime) {
    return timeToMinutes(screening.endTime)
  }
  // Fallback: start + runtime
  if (film && film.runtime) {
    return timeToMinutes(screening.startTime) + film.runtime
  }
  // No runtime: use start time
  return timeToMinutes(screening.startTime)
}
