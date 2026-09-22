/**
 * Constraint checking for the festival planner optimizer
 */

import { getScreeningEndTime, screeningsOverlap } from '../utils/festivalData'

/**
 * Check if a screening falls within the availability window for its date
 */
export function isScreeningAvailable(screening, availabilityWindows) {
  if (!availabilityWindows || !availabilityWindows[screening.date]) {
    return true
  }
  
  const window = availabilityWindows[screening.date]
  if (!window.enabled) return false
  
  const screeningStart = screening.startTime
  const screeningEnd = getScreeningEndTime(screening)
  
  if (!screeningEnd) return true
  
  if (window.earliestStart && screeningStart < window.earliestStart) {
    return false
  }
  
  if (window.latestEnd && screeningEnd > window.latestEnd) {
    return false
  }
  
  return true
}

/**
 * Check if adding a screening would violate maximum films constraints
 */
export function wouldViolateMaxFilms(screenings, newScreening, constraints) {
  if (!constraints) return false
  
  const { maxFilmsPerDay, maxFilmsTotal } = constraints
  
  if (maxFilmsTotal && screenings.length >= maxFilmsTotal) {
    return true
  }
  
  if (maxFilmsPerDay) {
    const screeningsOnDate = screenings.filter(s => s.date === newScreening.date)
    if (screeningsOnDate.length >= maxFilmsPerDay) {
      return true
    }
  }
  
  return false
}

/**
 * Check if a set of screenings has any overlaps
 */
export function hasOverlaps(screenings) {
  for (let i = 0; i < screenings.length; i++) {
    for (let j = i + 1; j < screenings.length; j++) {
      if (screeningsOverlap(screenings[i], screenings[j])) {
        return true
      }
    }
  }
  return false
}

/**
 * Check if a screening conflicts with any in the existing set
 */
export function conflictsWithExisting(screening, existingScreenings) {
  return existingScreenings.some(existing => 
    screeningsOverlap(screening, existing)
  )
}

/**
 * Check if minimum transition time is satisfied between two consecutive screenings
 */
export function hasAdequateTransition(screening1, screening2, minTransitionMinutes = 0) {
  if (screening1.date !== screening2.date) return true
  if (!minTransitionMinutes) return true
  
  const end1 = getScreeningEndTime(screening1)
  const start2 = screening2.startTime
  
  if (!end1) return true
  
  const [end1Hours, end1Mins] = end1.split(':').map(Number)
  const [start2Hours, start2Mins] = start2.split(':').map(Number)
  
  const end1Minutes = end1Hours * 60 + end1Mins
  const start2Minutes = start2Hours * 60 + start2Mins
  
  const gap = start2Minutes - end1Minutes
  
  return gap >= minTransitionMinutes
}

/**
 * Check if a day's schedule includes a required meal break
 */
export function hasMealBreak(dayScreenings, mealBreakRequirement) {
  if (!mealBreakRequirement || !mealBreakRequirement.enabled) return true
  
  const { minDuration, windowStart, windowEnd } = mealBreakRequirement
  
  if (dayScreenings.length === 0) return true
  
  const sortedScreenings = [...dayScreenings].sort((a, b) => 
    a.startTime.localeCompare(b.startTime)
  )
  
  for (let i = 0; i < sortedScreenings.length - 1; i++) {
    const current = sortedScreenings[i]
    const next = sortedScreenings[i + 1]
    
    const currentEnd = getScreeningEndTime(current)
    if (!currentEnd) continue
    
    const [endHours, endMins] = currentEnd.split(':').map(Number)
    const [startHours, startMins] = next.startTime.split(':').map(Number)
    
    const gapStart = endHours * 60 + endMins
    const gapEnd = startHours * 60 + startMins
    const gapDuration = gapEnd - gapStart
    
    if (gapDuration < minDuration) continue
    
    const gapStartTime = `${String(Math.floor(gapStart / 60)).padStart(2, '0')}:${String(gapStart % 60).padStart(2, '0')}`
    const gapEndTime = `${String(Math.floor(gapEnd / 60)).padStart(2, '0')}:${String(gapEnd % 60).padStart(2, '0')}`
    
    if (windowStart && gapEndTime < windowStart) continue
    if (windowEnd && gapStartTime > windowEnd) continue
    
    return true
  }
  
  return false
}

/**
 * Validate that all hard constraints are satisfied
 */
export function validatePlan(plan, constraints) {
  const errors = []
  
  if (hasOverlaps(plan.screenings)) {
    errors.push('Plan contains overlapping screenings')
  }
  
  const filmCounts = {}
  for (const screening of plan.screenings) {
    filmCounts[screening.filmId] = (filmCounts[screening.filmId] || 0) + 1
    if (filmCounts[screening.filmId] > 1) {
      errors.push(`Film ${screening.filmId} appears multiple times`)
    }
  }
  
  if (constraints.requiredFilms) {
    for (const filmId of constraints.requiredFilms) {
      if (!plan.screenings.some(s => s.filmId === filmId)) {
        errors.push(`Required film ${filmId} not included`)
      }
    }
  }
  
  if (constraints.excludedFilms) {
    for (const screening of plan.screenings) {
      if (constraints.excludedFilms.includes(screening.filmId)) {
        errors.push(`Excluded film ${screening.filmId} included in plan`)
      }
    }
  }
  
  if (constraints.lockedScreenings) {
    for (const screeningId of constraints.lockedScreenings) {
      if (!plan.screenings.some(s => s.id === screeningId)) {
        errors.push(`Locked screening ${screeningId} not included`)
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}
