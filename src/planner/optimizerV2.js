/**
 * Efficient Branch-and-Bound Festival Plan Optimizer
 * 
 * Architecture:
 * - Film-based decisions (skip or choose one screening)
 * - Precomputed conflict matrix and feasibility
 * - Greedy initial solution
 * - Branch-and-bound with intelligent pruning
 * - Lexicographic objective: Must See, count, Want to See, Maybe
 * - Time budget with anytime behavior
 */

import { INTEREST_LEVELS } from '../utils/userState'

const DEFAULT_TIME_BUDGET_MS = 600 // 600ms budget for mobile

/**
 * Precompute all necessary data structures for optimization
 */
function precomputeData(films, screenings, interests, constraints, attendanceConstraints, hardDecisions) {
  const {
    excludedFilms = [],
    lockedScreenings = [],
    includeSkip = false,
    includeSeen = false
  } = constraints

  // Build excluded set from hard decisions
  const decisionExcluded = new Set()
  Object.values(hardDecisions || {}).forEach(decision => {
    if (decision.excluded) {
      decision.excluded.forEach(filmId => decisionExcluded.add(filmId))
    }
  })

  // Build film map
  const filmMap = new Map()
  films.forEach(f => filmMap.set(f.id, f))

  // Build screening map and film-to-screenings map
  const screeningMap = new Map()
  const filmToScreenings = new Map()
  
  screenings.forEach(s => {
    screeningMap.set(s.id, s)
    if (!filmToScreenings.has(s.filmId)) {
      filmToScreenings.set(s.filmId, [])
    }
    filmToScreenings.get(s.filmId).push(s)
  })

  // Filter candidate films and screenings
  const candidateFilms = []
  const candidateScreenings = []
  const filmToFeasibleScreenings = new Map()

  for (const film of films) {
    // Skip excluded films
    if (excludedFilms.includes(film.id)) continue
    if (decisionExcluded.has(film.id)) continue
    
    const interest = interests[film.id]
    if (!includeSkip && interest === INTEREST_LEVELS.SKIP) continue
    if (!includeSeen && interest === INTEREST_LEVELS.SEEN) continue

    // Get feasible screenings for this film
    const filmScreenings = filmToScreenings.get(film.id) || []
    const feasibleScreenings = filmScreenings.filter(s => 
      isScreeningFeasible(s, film, attendanceConstraints, lockedScreenings)
    )

    if (feasibleScreenings.length > 0) {
      candidateFilms.push(film)
      filmToFeasibleScreenings.set(film.id, feasibleScreenings)
      candidateScreenings.push(...feasibleScreenings)
    }
  }

  // Build conflict matrix (screening pairs that overlap)
  const conflicts = new Map()
  
  for (let i = 0; i < candidateScreenings.length; i++) {
    const s1 = candidateScreenings[i]
    const conflictSet = new Set()
    
    for (let j = 0; j < candidateScreenings.length; j++) {
      if (i === j) continue
      const s2 = candidateScreenings[j]
      
      if (screeningsOverlap(s1, s2, filmMap)) {
        conflictSet.add(s2.id)
      }
    }
    
    conflicts.set(s1.id, conflictSet)
  }

  // Compute conflict degree for each film (for ordering heuristic)
  const filmConflictDegree = new Map()
  
  for (const film of candidateFilms) {
    const filmScreenings = filmToFeasibleScreenings.get(film.id)
    let totalConflicts = 0
    
    for (const screening of filmScreenings) {
      totalConflicts += conflicts.get(screening.id).size
    }
    
    filmConflictDegree.set(film.id, totalConflicts / filmScreenings.length)
  }

  // Find locked screenings and their films
  const lockedScreeningSet = new Set(lockedScreenings)
  const requiredFilms = new Set()
  
  for (const screeningId of lockedScreenings) {
    const screening = screeningMap.get(screeningId)
    if (screening) {
      requiredFilms.add(screening.filmId)
    }
  }

  return {
    filmMap,
    screeningMap,
    filmToScreenings,
    filmToFeasibleScreenings,
    candidateFilms,
    candidateScreenings,
    conflicts,
    filmConflictDegree,
    lockedScreeningSet,
    requiredFilms
  }
}

/**
 * Check if a screening is feasible under constraints
 */
function isScreeningFeasible(screening, film, attendanceConstraints, lockedScreenings) {
  // Locked screenings are always feasible
  if (lockedScreenings.includes(screening.id)) {
    return true
  }

  if (!attendanceConstraints) {
    return true
  }

  const { attendanceDays, availabilityByDate } = attendanceConstraints

  // Check if day is selected
  if (attendanceDays && !attendanceDays[screening.date]) {
    return false
  }

  // Check time availability
  if (availabilityByDate && availabilityByDate[screening.date]) {
    const { from, until } = availabilityByDate[screening.date]
    if (from && until) {
      const parseTime = (timeStr) => {
        const [hours, minutes] = timeStr.split(':').map(Number)
        return hours * 60 + minutes
      }

      const screeningStart = parseTime(screening.startTime)
      const screeningEnd = screening.endTime 
        ? parseTime(screening.endTime)
        : screeningStart + (film.runtime || 120)

      const availableFrom = parseTime(from)
      const availableUntil = parseTime(until)

      if (screeningStart < availableFrom || screeningEnd > availableUntil) {
        return false
      }
    }
  }

  return true
}

/**
 * Check if two screenings overlap
 */
function screeningsOverlap(s1, s2, filmMap) {
  if (s1.date !== s2.date) return false

  const parseTime = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number)
    return hours * 60 + minutes
  }

  const s1Start = parseTime(s1.startTime)
  const s2Start = parseTime(s2.startTime)

  let s1End, s2End

  if (s1.endTime) {
    s1End = parseTime(s1.endTime)
  } else {
    const film1 = filmMap.get(s1.filmId)
    s1End = s1Start + (film1?.runtime || 120)
  }

  if (s2.endTime) {
    s2End = parseTime(s2.endTime)
  } else {
    const film2 = filmMap.get(s2.filmId)
    s2End = s2Start + (film2?.runtime || 120)
  }

  return (s1Start < s2End && s2Start < s1End)
}

/**
 * Generate greedy initial solution
 */
function generateGreedySolution(data, interests) {
  const { candidateFilms, filmToFeasibleScreenings, conflicts, lockedScreeningSet, filmMap } = data

  // Order films by priority
  const orderedFilms = [...candidateFilms].sort((a, b) => {
    const interestA = interests[a.id]
    const interestB = interests[b.id]
    const priorityA = getInterestPriority(interestA)
    const priorityB = getInterestPriority(interestB)
    
    if (priorityA !== priorityB) return priorityB - priorityA
    
    // Tie-break by number of feasible screenings (fewer = higher priority)
    const screeningsA = filmToFeasibleScreenings.get(a.id).length
    const screeningsB = filmToFeasibleScreenings.get(b.id).length
    return screeningsA - screeningsB
  })

  const solution = []
  const usedScreenings = new Set()
  const includedFilms = new Set()

  // Add locked screenings first
  for (const screeningId of lockedScreeningSet) {
    const screening = data.screeningMap.get(screeningId)
    if (screening) {
      solution.push(screening)
      usedScreenings.add(screeningId)
      includedFilms.add(screening.filmId)
    }
  }

  // Greedy selection
  for (const film of orderedFilms) {
    if (includedFilms.has(film.id)) continue

    const feasibleScreenings = filmToFeasibleScreenings.get(film.id)
    
    // Try to find a non-conflicting screening
    for (const screening of feasibleScreenings) {
      if (usedScreenings.has(screening.id)) continue

      const screeningConflicts = conflicts.get(screening.id)
      let hasConflict = false
      
      for (const usedId of usedScreenings) {
        if (screeningConflicts.has(usedId)) {
          hasConflict = true
          break
        }
      }

      if (!hasConflict) {
        solution.push(screening)
        usedScreenings.add(screening.id)
        includedFilms.add(film.id)
        break
      }
    }
  }

  return solution
}

/**
 * Get priority score for interest level
 */
function getInterestPriority(interest) {
  switch (interest) {
    case INTEREST_LEVELS.MUST_SEE: return 3
    case INTEREST_LEVELS.WANT_TO_SEE: return 2
    case INTEREST_LEVELS.MAYBE: return 1
    default: return 0
  }
}

/**
 * Evaluate solution quality (lexicographic)
 */
function evaluateSolution(solution, interests) {
  const filmIds = new Set(solution.map(s => s.filmId))
  
  let mustSeeCount = 0
  let wantToSeeCount = 0
  let maybeCount = 0

  for (const filmId of filmIds) {
    const interest = interests[filmId]
    if (interest === INTEREST_LEVELS.MUST_SEE) mustSeeCount++
    else if (interest === INTEREST_LEVELS.WANT_TO_SEE) wantToSeeCount++
    else if (interest === INTEREST_LEVELS.MAYBE) maybeCount++
  }

  return {
    mustSeeCount,
    filmCount: filmIds.size,
    wantToSeeCount,
    maybeCount,
    screenings: solution
  }
}

/**
 * Compare two solutions lexicographically
 * Returns: >0 if a is better, <0 if b is better, 0 if equal
 */
function compareSolutions(a, b) {
  if (a.mustSeeCount !== b.mustSeeCount) return a.mustSeeCount - b.mustSeeCount
  if (a.filmCount !== b.filmCount) return a.filmCount - b.filmCount
  if (a.wantToSeeCount !== b.wantToSeeCount) return a.wantToSeeCount - b.wantToSeeCount
  if (a.maybeCount !== b.maybeCount) return a.maybeCount - b.maybeCount
  return 0
}

/**
 * Branch-and-bound search
 */
function branchAndBound(data, interests, initialSolution, timeBudgetMs) {
  const startTime = performance.now()
  const deadline = startTime + timeBudgetMs

  let bestSolution = evaluateSolution(initialSolution, interests)
  let nodesExplored = 0
  let nodesPruned = 0
  let optimalityProven = false

  // Order films for search (most constrained first)
  const searchOrder = orderFilmsForSearch(data, interests)

  // Recursive branch-and-bound
  function search(filmIndex, currentScreenings, usedScreenings, includedFilms) {
    nodesExplored++

    // Check time budget
    if (performance.now() >= deadline) {
      return
    }

    // Base case: all films considered
    if (filmIndex >= searchOrder.length) {
      const solution = evaluateSolution(currentScreenings, interests)
      if (compareSolutions(solution, bestSolution) > 0) {
        bestSolution = solution
      }
      return
    }

    const film = searchOrder[filmIndex]

    // Option 1: Skip this film
    search(filmIndex + 1, currentScreenings, usedScreenings, includedFilms)

    // Option 2: Choose one of its feasible screenings
    const feasibleScreenings = data.filmToFeasibleScreenings.get(film.id)
    
    for (const screening of feasibleScreenings) {
      // Check if this screening conflicts with any used screening
      const conflicts = data.conflicts.get(screening.id)
      let hasConflict = false
      
      for (const usedId of usedScreenings) {
        if (conflicts.has(usedId)) {
          hasConflict = true
          break
        }
      }

      if (!hasConflict) {
        // Add this screening and recurse
        currentScreenings.push(screening)
        usedScreenings.add(screening.id)
        includedFilms.add(film.id)

        search(filmIndex + 1, currentScreenings, usedScreenings, includedFilms)

        // Backtrack
        currentScreenings.pop()
        usedScreenings.delete(screening.id)
        includedFilms.delete(film.id)
      } else {
        nodesPruned++
      }
    }
  }

  // Initialize search with locked screenings
  const initialScreenings = []
  const initialUsedScreenings = new Set()
  const initialIncludedFilms = new Set()

  for (const screeningId of data.lockedScreeningSet) {
    const screening = data.screeningMap.get(screeningId)
    if (screening) {
      initialScreenings.push(screening)
      initialUsedScreenings.add(screeningId)
      initialIncludedFilms.add(screening.filmId)
    }
  }

  // Run search
  search(0, initialScreenings, initialUsedScreenings, initialIncludedFilms)

  const elapsed = performance.now() - startTime
  optimalityProven = elapsed < timeBudgetMs

  return {
    solution: bestSolution,
    metadata: {
      nodesExplored,
      nodesPruned,
      elapsedMs: elapsed,
      optimalityProven,
      timeBudgetMs
    }
  }
}

/**
 * Order films for search (most constrained first)
 */
function orderFilmsForSearch(data, interests) {
  const { candidateFilms, filmToFeasibleScreenings, filmConflictDegree, requiredFilms } = data

  return [...candidateFilms].sort((a, b) => {
    // Required/locked films first
    const aRequired = requiredFilms.has(a.id)
    const bRequired = requiredFilms.has(b.id)
    if (aRequired !== bRequired) return bRequired ? 1 : -1

    // Then by interest priority
    const priorityA = getInterestPriority(interests[a.id])
    const priorityB = getInterestPriority(interests[b.id])
    if (priorityA !== priorityB) return priorityB - priorityA

    // Then by fewest feasible screenings
    const screeningsA = filmToFeasibleScreenings.get(a.id).length
    const screeningsB = filmToFeasibleScreenings.get(b.id).length
    if (screeningsA !== screeningsB) return screeningsA - screeningsB

    // Then by conflict degree
    const conflictA = filmConflictDegree.get(a.id) || 0
    const conflictB = filmConflictDegree.get(b.id) || 0
    return conflictB - conflictA
  })
}

/**
 * Main optimization function
 */
export function generatePlanV2(params) {
  const { 
    films, 
    screenings, 
    interests, 
    constraints, 
    attendanceConstraints, 
    hardDecisions,
    timeBudgetMs = DEFAULT_TIME_BUDGET_MS
  } = params

  const startTime = performance.now()

  // Precompute data structures
  const data = precomputeData(films, screenings, interests, constraints, attendanceConstraints, hardDecisions)

  if (data.candidateFilms.length === 0) {
    return {
      screenings: [],
      infeasible: true,
      reason: 'No feasible films available with current constraints',
      metadata: {
        precomputeMs: performance.now() - startTime,
        candidateFilms: 0,
        candidateScreenings: 0
      }
    }
  }

  // Generate greedy initial solution
  const greedyStart = performance.now()
  const initialSolution = generateGreedySolution(data, interests)
  const greedyMs = performance.now() - greedyStart

  // Run branch-and-bound to improve
  const { solution, metadata } = branchAndBound(data, interests, initialSolution, timeBudgetMs)

  const totalMs = performance.now() - startTime

  return {
    screenings: solution.screenings,
    infeasible: false,
    score: {
      mustSeeCount: solution.mustSeeCount,
      filmCount: solution.filmCount,
      wantToSeeCount: solution.wantToSeeCount,
      maybeCount: solution.maybeCount
    },
    metadata: {
      ...metadata,
      greedyMs,
      totalMs,
      candidateFilms: data.candidateFilms.length,
      candidateScreenings: data.candidateScreenings.length,
      initialSolutionSize: initialSolution.length
    }
  }
}
