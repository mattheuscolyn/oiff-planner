/**
 * Independent Plan Validator
 * 
 * Validates a returned plan WITHOUT relying on optimizer's own overlap logic.
 * Uses HH:MM minute arithmetic exclusively.
 */

/**
 * Parse HH:MM time string to minutes since midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return 0
  const [hours, minutes] = timeStr.split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * Add minutes to HH:MM time string
 */
function addMinutesToTime(timeStr, minutes) {
  if (!timeStr) return '00:00'
  const [h, m] = timeStr.split(':').map(Number)
  const total = h * 60 + m + minutes
  const newH = Math.floor(total / 60) % 24
  const newM = total % 60
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`
}

/**
 * Get screening end time in HH:MM format
 */
function getScreeningEnd(screening, film) {
  if (screening.endTime) {
    return screening.endTime
  }
  if (film && film.runtime) {
    return addMinutesToTime(screening.startTime, film.runtime)
  }
  return screening.startTime
}

/**
 * Check if two screenings overlap (same day only)
 * Exported for independent plan-validity assertions in tests.
 */
export function screeningsOverlap(s1, s2, film1, film2) {
  if (s1.date !== s2.date) return false
  
  const start1 = timeToMinutes(s1.startTime)
  const end1 = timeToMinutes(getScreeningEnd(s1, film1))
  const start2 = timeToMinutes(s2.startTime)
  const end2 = timeToMinutes(getScreeningEnd(s2, film2))
  
  // Overlap if: start1 < end2 AND start2 < end1
  return start1 < end2 && start2 < end1
}

/**
 * Validate a complete plan
 * 
 * @param {Object} plan - { screenings: [...], filmCount: N, metadata: {...} }
 * @param {Array} allFilms - Complete films array
 * @param {Array} allScreenings - Complete screenings array
 * @param {Object} constraints - { eligibleDates, fromTimes, untilTimes }
 * @returns {Object} - { valid: boolean, errors: [], warnings: [] }
 */
export function validatePlan(plan, allFilms, allScreenings, constraints = {}) {
  const errors = []
  const warnings = []
  
  if (!plan || !plan.screenings) {
    errors.push('Plan is null or missing screenings array')
    return { valid: false, errors, warnings }
  }
  
  const filmMap = new Map(allFilms.map(f => [f.id, f]))
  const screeningMap = new Map(allScreenings.map(s => [s.id, s]))
  
  // Check 1: Every screening ID exists
  for (const screening of plan.screenings) {
    if (!screeningMap.has(screening.id)) {
      errors.push(`Screening ID ${screening.id} does not exist in source data`)
    }
  }
  
  // Check 2: Every film ID exists
  for (const screening of plan.screenings) {
    if (!filmMap.has(screening.filmId)) {
      errors.push(`Film ID ${screening.filmId} does not exist in source data`)
    }
  }
  
  // Check 3: No duplicate films
  const filmIds = plan.screenings.map(s => s.filmId)
  const uniqueFilms = new Set(filmIds)
  if (uniqueFilms.size !== filmIds.length) {
    const duplicates = filmIds.filter((id, i) => filmIds.indexOf(id) !== i)
    errors.push(`Duplicate films: ${[...new Set(duplicates)].join(', ')}`)
  }
  
  // Check 4: No same-day overlaps (independent HH:MM arithmetic)
  for (let i = 0; i < plan.screenings.length; i++) {
    for (let j = i + 1; j < plan.screenings.length; j++) {
      const s1 = plan.screenings[i]
      const s2 = plan.screenings[j]
      const f1 = filmMap.get(s1.filmId)
      const f2 = filmMap.get(s2.filmId)
      
      if (screeningsOverlap(s1, s2, f1, f2)) {
        const end1 = getScreeningEnd(s1, f1)
        const end2 = getScreeningEnd(s2, f2)
        errors.push(
          `Overlap on ${s1.date}:\n` +
          `  Film "${f1?.title}" ${s1.startTime}–${end1}\n` +
          `  Film "${f2?.title}" ${s2.startTime}–${end2}`
        )
      }
    }
  }
  
  // Check 5: Screening date is eligible
  if (constraints.eligibleDates) {
    for (const screening of plan.screenings) {
      if (!constraints.eligibleDates.includes(screening.date)) {
        errors.push(`Screening on ${screening.date} is not in eligible dates`)
      }
    }
  }
  
  // Check 6: Arrival 'from' constraint respected
  if (constraints.fromTimes) {
    for (const screening of plan.screenings) {
      const fromTime = constraints.fromTimes[screening.date]
      if (fromTime) {
        const screeningStart = timeToMinutes(screening.startTime)
        const requiredFrom = timeToMinutes(fromTime)
        if (screeningStart < requiredFrom) {
          const film = filmMap.get(screening.filmId)
          errors.push(
            `Screening starts too early on ${screening.date}:\n` +
            `  Film "${film?.title}" at ${screening.startTime} (required >= ${fromTime})`
          )
        }
      }
    }
  }
  
  // Check 7: Departure 'until' constraint respected
  if (constraints.untilTimes) {
    for (const screening of plan.screenings) {
      const untilTime = constraints.untilTimes[screening.date]
      if (untilTime) {
        const film = filmMap.get(screening.filmId)
        const screeningEnd = getScreeningEnd(screening, film)
        const screeningEndMinutes = timeToMinutes(screeningEnd)
        const requiredUntil = timeToMinutes(untilTime)
        if (screeningEndMinutes > requiredUntil) {
          errors.push(
            `Screening ends too late on ${screening.date}:\n` +
            `  Film "${film?.title}" ends ${screeningEnd} (required <= ${untilTime})`
          )
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}
