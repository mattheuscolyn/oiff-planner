/**
 * Decisions Detection Logic
 * 
 * Identifies unavoidable film conflicts where users must make explicit choices
 * before running the optimizer.
 */

import { screeningsOverlap, getScreeningEndTime } from '../utils/festivalData'
import { parseTimeToMinutes } from '../utils/ferryData'

/**
 * Check if a screening is feasible under current availability constraints
 * @param {object} screening - Screening object
 * @param {object} film - Film object
 * @param {object} attendanceConstraints - Attendance constraints object
 * @returns {boolean} True if screening is feasible
 */
export function isScreeningFeasible(screening, film, attendanceConstraints) {
  const { attendanceDays, availabilityByDate } = attendanceConstraints
  
  // Check if day is selected
  if (!attendanceDays[screening.date]) {
    return false
  }
  
  // Check time availability for this date
  const dayAvailability = availabilityByDate[screening.date]
  if (!dayAvailability) {
    return true // No specific time constraint for this day
  }
  
  const { from, until } = dayAvailability
  if (!from || !until) {
    return true // No time constraint
  }
  
  // Parse times as minutes since midnight
  const screeningStart = parseTimeToMinutes(screening.time)
  const screeningEnd = parseTimeToMinutes(getScreeningEndTime(screening, film))
  const availableFrom = parseTimeToMinutes(from)
  const availableUntil = parseTimeToMinutes(until)
  
  // Screening must start after available-from and end before available-until
  return screeningStart >= availableFrom && screeningEnd <= availableUntil
}

/**
 * Get all feasible screenings for a film under current constraints
 * @param {object} film - Film object
 * @param {Array} allScreenings - All screenings
 * @param {object} attendanceConstraints - Attendance constraints
 * @param {Array} lockedScreenings - Array of locked screening IDs
 * @returns {Array} Array of feasible screening objects
 */
export function getFeasibleScreenings(film, allScreenings, attendanceConstraints, lockedScreenings = []) {
  const filmScreenings = allScreenings.filter(s => s.filmId === film.id)
  
  return filmScreenings.filter(screening => {
    // Locked screenings are always feasible
    if (lockedScreenings.includes(screening.id)) {
      return true
    }
    
    return isScreeningFeasible(screening, film, attendanceConstraints)
  })
}

/**
 * Check if two films have any compatible screening pair
 * @param {object} filmA - First film
 * @param {object} filmB - Second film
 * @param {Array} allScreenings - All screenings
 * @param {object} attendanceConstraints - Attendance constraints
 * @param {Array} lockedScreenings - Locked screening IDs
 * @returns {boolean} True if at least one compatible pair exists
 */
export function hasCompatibleScreeningPair(filmA, filmB, allScreenings, attendanceConstraints, lockedScreenings = []) {
  const feasibleA = getFeasibleScreenings(filmA, allScreenings, attendanceConstraints, lockedScreenings)
  const feasibleB = getFeasibleScreenings(filmB, allScreenings, attendanceConstraints, lockedScreenings)
  
  if (feasibleA.length === 0 || feasibleB.length === 0) {
    return false // One film has no feasible screenings
  }
  
  // Check if ANY pair of screenings is compatible
  for (const screeningA of feasibleA) {
    for (const screeningB of feasibleB) {
      if (!screeningsOverlap(screeningA, screeningB, filmA, filmB)) {
        return true // Found a compatible pair!
      }
    }
  }
  
  return false // Every feasible screening of A conflicts with every feasible screening of B
}

/**
 * Detect unavoidable conflicts between films
 * @param {Array} films - All films
 * @param {Array} screenings - All screenings
 * @param {object} interests - User interests object
 * @param {object} attendanceConstraints - Attendance constraints
 * @param {Array} lockedScreenings - Locked screening IDs
 * @param {object} existingDecisions - Existing hard decisions
 * @returns {Array} Array of unavoidable conflict objects
 */
export function detectUnavoidableConflicts(films, screenings, interests, attendanceConstraints, lockedScreenings = [], existingDecisions = {}) {
  const conflicts = []
  
  // Only consider films the user has rated (excluding Skip/Seen)
  const interestedFilms = films.filter(film => {
    const interest = interests[film.id]
    return interest && interest !== 'skip' && interest !== 'seen'
  })
  
  // Check each pair of interested films
  for (let i = 0; i < interestedFilms.length; i++) {
    for (let j = i + 1; j < interestedFilms.length; j++) {
      const filmA = interestedFilms[i]
      const filmB = interestedFilms[j]
      
      // Skip if already decided
      const decisionKey = getDecisionKey(filmA.id, filmB.id)
      if (existingDecisions[decisionKey]) {
        continue
      }
      
      // Check if films have ANY compatible screening pair
      if (!hasCompatibleScreeningPair(filmA, filmB, screenings, attendanceConstraints, lockedScreenings)) {
        // This is an unavoidable conflict
        const interestA = interests[filmA.id]
        const interestB = interests[filmB.id]
        
        conflicts.push({
          films: [filmA, filmB],
          interests: [interestA, interestB],
          decisionKey,
          priority: getConflictPriority(interestA, interestB)
        })
      }
    }
  }
  
  // Sort conflicts by priority (highest first)
  conflicts.sort((a, b) => b.priority - a.priority)
  
  return conflicts
}

/**
 * Get a stable decision key for a film pair
 * @param {string} filmIdA - First film ID
 * @param {string} filmIdB - Second film ID
 * @returns {string} Stable decision key
 */
export function getDecisionKey(filmIdA, filmIdB) {
  const sorted = [filmIdA, filmIdB].sort()
  return `${sorted[0]}_vs_${sorted[1]}`
}

/**
 * Get numeric priority for a conflict based on interest levels
 * @param {string} interestA - Interest level for film A
 * @param {string} interestB - Interest level for film B
 * @returns {number} Priority score (higher = more important)
 */
function getConflictPriority(interestA, interestB) {
  const levels = {
    'must-see': 3,
    'want-to-see': 2,
    'maybe': 1,
    'unrated': 0
  }
  
  const priorityA = levels[interestA] || 0
  const priorityB = levels[interestB] || 0
  
  // Conflicts between equal high-priority items are most important
  if (priorityA === priorityB && priorityA >= 2) {
    return 100 + priorityA
  }
  
  // Other conflicts ranked by sum of priorities
  return priorityA + priorityB
}

/**
 * Check if a conflict can be auto-resolved based on interest levels
 * @param {object} conflict - Conflict object
 * @returns {object|null} Auto-resolution object or null
 */
export function getAutoResolution(conflict) {
  const [interestA, interestB] = conflict.interests
  
  const levels = {
    'must-see': 3,
    'want-to-see': 2,
    'maybe': 1,
    'unrated': 0
  }
  
  const priorityA = levels[interestA] || 0
  const priorityB = levels[interestB] || 0
  
  // Only auto-resolve if there's a significant priority difference (at least 2 levels)
  // Must See (3) vs Maybe (1) or unrated (0)
  if (priorityA - priorityB >= 2 && priorityA >= 3) {
    return {
      chosen: conflict.films[0].id,
      reason: `You marked "${conflict.films[0].title}" as ${formatInterestLevel(interestA)}`
    }
  }
  
  if (priorityB - priorityA >= 2 && priorityB >= 3) {
    return {
      chosen: conflict.films[1].id,
      reason: `You marked "${conflict.films[1].title}" as ${formatInterestLevel(interestB)}`
    }
  }
  
  return null // Requires user decision
}

/**
 * Format interest level for display
 * @param {string} interest - Interest level
 * @returns {string} Formatted interest level
 */
function formatInterestLevel(interest) {
  const labels = {
    'must-see': 'Must See',
    'want-to-see': 'Want to See',
    'maybe': 'Maybe',
    'unrated': 'Unrated'
  }
  return labels[interest] || interest
}

/**
 * Expand multi-film conflicts into groups
 * (For future enhancement - currently handles binary conflicts only)
 * @param {Array} conflicts - Array of binary conflicts
 * @returns {Array} Array of conflict groups
 */
export function groupConflicts(conflicts) {
  // For v1, just return conflicts as-is (all binary)
  // Future enhancement: detect mutual exclusion groups of 3+ films
  return conflicts.map(conflict => ({
    ...conflict,
    type: 'binary',
    filmIds: conflict.films.map(f => f.id)
  }))
}
