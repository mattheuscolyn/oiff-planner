/**
 * Scoring and objective functions for festival plan optimization
 */

import { INTEREST_LEVELS } from '../utils/userState'

/**
 * Interest value weights for different objectives
 * 
 * MOST_FILMS: Maximize film count, use interests as tiebreakers
 * BEST_MATCHES: Strongly prioritize high-interest films
 * BALANCED: Balance between count and quality
 */

export const OBJECTIVES = {
  MOST_FILMS: 'most-films',
  BEST_MATCHES: 'best-matches',
  BALANCED: 'balanced'
}

const INTEREST_WEIGHTS = {
  [OBJECTIVES.MOST_FILMS]: {
    [INTEREST_LEVELS.MUST_SEE]: 1000,
    [INTEREST_LEVELS.WANT_TO_SEE]: 100,
    [INTEREST_LEVELS.MAYBE]: 10,
    null: 1,
    [INTEREST_LEVELS.SKIP]: 0,
    [INTEREST_LEVELS.SEEN]: 0
  },
  [OBJECTIVES.BEST_MATCHES]: {
    [INTEREST_LEVELS.MUST_SEE]: 1000000,
    [INTEREST_LEVELS.WANT_TO_SEE]: 10000,
    [INTEREST_LEVELS.MAYBE]: 100,
    null: 1,
    [INTEREST_LEVELS.SKIP]: 0,
    [INTEREST_LEVELS.SEEN]: 0
  },
  [OBJECTIVES.BALANCED]: {
    [INTEREST_LEVELS.MUST_SEE]: 100000,
    [INTEREST_LEVELS.WANT_TO_SEE]: 1000,
    [INTEREST_LEVELS.MAYBE]: 50,
    null: 1,
    [INTEREST_LEVELS.SKIP]: 0,
    [INTEREST_LEVELS.SEEN]: 0
  }
}

/**
 * Get the weight for a film based on interest level and objective
 */
export function getFilmWeight(interest, objective) {
  const weights = INTEREST_WEIGHTS[objective] || INTEREST_WEIGHTS[OBJECTIVES.BALANCED]
  return weights[interest] || weights[null]
}

/**
 * Calculate the total score for a plan
 * 
 * For MOST_FILMS:
 * Primary: film count * 1,000,000,000 (billion per film)
 * Secondary: sum of interest weights
 * Tertiary: schedule quality bonus
 * 
 * For BEST_MATCHES:
 * Primary: sum of interest weights
 * Secondary: film count * 1000
 * Tertiary: schedule quality bonus
 * 
 * For BALANCED:
 * Primary: film count * 1,000,000 (million per film)
 * Secondary: sum of interest weights
 * Tertiary: schedule quality bonus
 */
export function scorePlan(plan, interests, objective) {
  const filmCount = plan.screenings.length
  const interestSum = plan.screenings.reduce((sum, screening) => {
    const interest = interests[screening.filmId]
    return sum + getFilmWeight(interest, objective)
  }, 0)
  
  const scheduleQuality = calculateScheduleQuality(plan.screenings)
  
  let score
  
  switch (objective) {
    case OBJECTIVES.MOST_FILMS:
      score = (filmCount * 1000000000) + (interestSum * 1000) + scheduleQuality
      break
      
    case OBJECTIVES.BEST_MATCHES:
      score = (interestSum * 1000000) + (filmCount * 1000) + scheduleQuality
      break
      
    case OBJECTIVES.BALANCED:
      score = (filmCount * 1000000) + (interestSum * 100) + scheduleQuality
      break
      
    default:
      score = (filmCount * 1000000) + (interestSum * 100) + scheduleQuality
  }
  
  return {
    totalScore: score,
    filmCount,
    interestSum,
    scheduleQuality
  }
}

/**
 * Calculate schedule quality bonus
 * Rewards reasonable gaps between screenings and penalizes very tight transitions
 */
function calculateScheduleQuality(screenings) {
  if (screenings.length === 0) return 0
  
  let quality = 0
  
  const screeningsByDate = {}
  for (const screening of screenings) {
    if (!screeningsByDate[screening.date]) {
      screeningsByDate[screening.date] = []
    }
    screeningsByDate[screening.date].push(screening)
  }
  
  for (const date in screeningsByDate) {
    const dayScreenings = screeningsByDate[date].sort((a, b) => 
      a.startTime.localeCompare(b.startTime)
    )
    
    for (let i = 0; i < dayScreenings.length - 1; i++) {
      const gap = calculateGapMinutes(dayScreenings[i], dayScreenings[i + 1])
      
      if (gap < 0) {
        quality -= 10000
      } else if (gap < 15) {
        quality -= 100
      } else if (gap >= 30 && gap <= 90) {
        quality += 10
      } else if (gap > 90 && gap <= 180) {
        quality += 5
      }
    }
  }
  
  return quality
}

/**
 * Calculate gap in minutes between two screenings
 */
function calculateGapMinutes(screening1, screening2) {
  const end1 = screening1.endTime || calculateEndTime(screening1)
  const start2 = screening2.startTime
  
  const [end1Hours, end1Mins] = end1.split(':').map(Number)
  const [start2Hours, start2Mins] = start2.split(':').map(Number)
  
  const end1Minutes = end1Hours * 60 + end1Mins
  const start2Minutes = start2Hours * 60 + start2Mins
  
  return start2Minutes - end1Minutes
}

function calculateEndTime(screening) {
  const [hours, minutes] = screening.startTime.split(':').map(Number)
  const startMinutes = hours * 60 + minutes
  const endMinutes = startMinutes + (screening.runtime || 120)
  
  const endHours = Math.floor(endMinutes / 60)
  const endMins = endMinutes % 60
  
  return `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`
}

/**
 * Count films by interest level
 */
export function countByInterest(screenings, interests) {
  const counts = {
    mustSee: 0,
    wantToSee: 0,
    maybe: 0,
    unrated: 0
  }
  
  for (const screening of screenings) {
    const interest = interests[screening.filmId]
    
    switch (interest) {
      case INTEREST_LEVELS.MUST_SEE:
        counts.mustSee++
        break
      case INTEREST_LEVELS.WANT_TO_SEE:
        counts.wantToSee++
        break
      case INTEREST_LEVELS.MAYBE:
        counts.maybe++
        break
      default:
        counts.unrated++
    }
  }
  
  return counts
}

/**
 * Calculate statistics about available films
 */
export function calculateAvailableStats(films, interests) {
  let mustSeeCount = 0
  let wantToSeeCount = 0
  
  for (const film of films) {
    const interest = interests[film.id]
    if (interest === INTEREST_LEVELS.MUST_SEE) mustSeeCount++
    else if (interest === INTEREST_LEVELS.WANT_TO_SEE) wantToSeeCount++
  }
  
  return { mustSeeCount, wantToSeeCount }
}
