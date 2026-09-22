/**
 * Optimizer Benchmarks - PR #11
 * 
 * These tests prove the exact maximum film counts for the real OIFF 2026 dataset.
 */

import { describe, it, expect } from 'vitest'
import { generatePlanV3 } from '../optimizerV3'
import { films, screenings } from '../../utils/festivalData'
import { deriveFestivalAvailability } from '../../utils/festivalAvailability'

describe('Optimizer Benchmarks - Real OIFF 2026 Data', () => {
  // Test 1: Unrestricted maximum (Tuesday → Monday, no time constraints)
  it('produces exactly 24 distinct films with unrestricted full-festival access', () => {
    // Setup: Full festival with no travel restrictions
    const arrival = { 
      date: '2026-10-13',  // Tuesday (before festival)
      type: 'already-on-island' 
    }
    const departure = { 
      date: '2026-10-19',  // Monday (after festival)
      type: 'staying-longer' 
    }
    
    // Derive availability - should be Oct 14-18 with no time restrictions
    const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(arrival, departure, [])
    
    // Verify all festival days are included
    expect(attendanceDays['2026-10-14']).toBe(true)
    expect(attendanceDays['2026-10-15']).toBe(true)
    expect(attendanceDays['2026-10-16']).toBe(true)
    expect(attendanceDays['2026-10-17']).toBe(true)
    expect(attendanceDays['2026-10-18']).toBe(true)
    
    // Verify no time restrictions
    expect(Object.keys(availabilityByDate).length).toBe(0)
    
    // Run optimizer
    const result = generatePlanV3({
      films,
      screenings,
      interests: {},
      constraints: {
        excludedFilms: [],
        lockedScreenings: [],
        includeSkip: false,
        includeSeen: false
      },
      attendanceConstraints: {
        attendanceDays,
        availabilityByDate
      },
      timeBudgetMs: 5000
    })
    
    // Assertions
    expect(result).toBeDefined()
    expect(result.screenings).toBeDefined()
    expect(result.filmCount).toBe(24) // Exact maximum
    expect(result.metadata?.optimalityProven).toBe(true)
    expect(result.metadata?.timedOut).toBe(false)
    
    // Validate no overlaps
    const sortedScreenings = result.screenings.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return a.startTime.localeCompare(b.startTime)
    })
    
    for (let i = 0; i < sortedScreenings.length - 1; i++) {
      const current = sortedScreenings[i]
      const next = sortedScreenings[i + 1]
      
      if (current.date === next.date) {
        // Same day - check for overlap
        const currentFilm = films.find(f => f.id === current.filmId)
        const currentEnd = current.endTime || addMinutes(current.startTime, currentFilm?.runtime || 0)
        
        expect(currentEnd <= next.startTime).toBe(true)
      }
    }
    
    // Validate no duplicate films
    const filmIds = new Set(result.screenings.map(s => s.filmId))
    expect(filmIds.size).toBe(result.filmCount)
    
    console.log(`✓ Unrestricted maximum: ${result.filmCount} films`)
    console.log(`✓ Runtime: ${result.metadata?.elapsedMs?.toFixed(1)}ms`)
    console.log(`✓ Optimality proven: ${result.metadata?.optimalityProven}`)
  })

  // Test 2: 09:00-23:00 benchmark (legacy constraint)
  it('produces exactly 23 distinct films with 09:00-23:00 time windows', () => {
    // Setup: Full festival with artificial 9-11 time windows
    const attendanceDays = {
      '2026-10-14': true,
      '2026-10-15': true,
      '2026-10-16': true,
      '2026-10-17': true,
      '2026-10-18': true
    }
    
    const availabilityByDate = {
      '2026-10-14': { from: '09:00', until: '23:00' },
      '2026-10-15': { from: '09:00', until: '23:00' },
      '2026-10-16': { from: '09:00', until: '23:00' },
      '2026-10-17': { from: '09:00', until: '23:00' },
      '2026-10-18': { from: '09:00', until: '23:00' }
    }
    
    // Run optimizer
    const result = generatePlanV3({
      films,
      screenings,
      interests: {},
      constraints: {
        excludedFilms: [],
        lockedScreenings: [],
        includeSkip: false,
        includeSeen: false
      },
      attendanceConstraints: {
        attendanceDays,
        availabilityByDate
      },
      timeBudgetMs: 5000
    })
    
    // Assertions
    expect(result).toBeDefined()
    expect(result.screenings).toBeDefined()
    expect(result.filmCount).toBe(23) // Exact maximum with 9-11 constraint
    expect(result.metadata?.optimalityProven).toBe(true)
    expect(result.metadata?.timedOut).toBe(false)
    
    // Validate all screenings fit within 09:00-23:00
    result.screenings.forEach(screening => {
      const film = films.find(f => f.id === screening.filmId)
      const endTime = screening.endTime || addMinutes(screening.startTime, film?.runtime || 0)
      
      expect(screening.startTime >= '09:00').toBe(true)
      expect(endTime <= '23:00').toBe(true)
    })
    
    console.log(`✓ 09:00-23:00 benchmark: ${result.filmCount} films`)
    console.log(`✓ Runtime: ${result.metadata?.elapsedMs?.toFixed(1)}ms`)
    console.log(`✓ Optimality proven: ${result.metadata?.optimalityProven}`)
  })
})

// Helper
function addMinutes(timeStr, minutes) {
  if (!timeStr) return '00:00'
  const [h, m] = timeStr.split(':').map(Number)
  const total = h * 60 + m + minutes
  const newH = Math.floor(total / 60) % 24
  const newM = total % 60
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`
}
