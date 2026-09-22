/**
 * Unit tests for the festival plan optimizer
 */

import { describe, it, expect } from 'vitest'
import { generatePlan, replaceScreening } from '../optimizer'
import { OBJECTIVES } from '../scoring'
import { INTEREST_LEVELS } from '../../utils/userState'

describe('Festival Planner Optimizer', () => {
  const createFilm = (id, title, runtime = 120) => ({
    id,
    title,
    runtime
  })
  
  const createScreening = (id, filmId, date, startTime, runtime = 120) => {
    const [hours, minutes] = startTime.split(':').map(Number)
    const startMinutes = hours * 60 + minutes
    const endMinutes = startMinutes + runtime
    const endHours = Math.floor(endMinutes / 60)
    const endMins = endMinutes % 60
    const endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`
    
    return {
      id,
      filmId,
      date,
      startTime,
      endTime,
      venue: 'Test Venue',
      runtime
    }
  }
  
  it('selects maximum number of non-overlapping distinct films', () => {
    const films = [
      createFilm('f1', 'Film 1', 90),
      createFilm('f2', 'Film 2', 90),
      createFilm('f3', 'Film 3', 90)
    ]
    
    const screenings = [
      createScreening('s1', 'f1', '2026-10-14', '10:00', 90),
      createScreening('s2', 'f2', '2026-10-14', '12:00', 90),
      createScreening('s3', 'f3', '2026-10-14', '14:00', 90)
    ]
    
    const result = generatePlan({
      films,
      screenings,
      interests: {},
      constraints: {},
      objective: OBJECTIVES.MOST_FILMS
    })
    
    expect(result.screenings).toHaveLength(3)
    expect(result.infeasible).toBeUndefined()
  })
  
  it('never selects two screenings of the same film', () => {
    const films = [createFilm('f1', 'Film 1', 90)]
    
    const screenings = [
      createScreening('s1', 'f1', '2026-10-14', '10:00', 90),
      createScreening('s2', 'f1', '2026-10-14', '14:00', 90)
    ]
    
    const result = generatePlan({
      films,
      screenings,
      interests: { f1: INTEREST_LEVELS.MUST_SEE },
      constraints: {},
      objective: OBJECTIVES.MOST_FILMS
    })
    
    expect(result.screenings).toHaveLength(1)
    const uniqueFilms = new Set(result.screenings.map(s => s.filmId))
    expect(uniqueFilms.size).toBe(1)
  })
  
  it('uses alternate screening when that permits more films', () => {
    const films = [
      createFilm('f1', 'Film 1', 90),
      createFilm('f2', 'Film 2', 90)
    ]
    
    const screenings = [
      createScreening('s1a', 'f1', '2026-10-14', '10:00', 90),
      createScreening('s1b', 'f1', '2026-10-14', '14:00', 90),
      createScreening('s2', 'f2', '2026-10-14', '10:30', 90)
    ]
    
    const result = generatePlan({
      films,
      screenings,
      interests: {},
      constraints: {},
      objective: OBJECTIVES.MOST_FILMS
    })
    
    expect(result.screenings).toHaveLength(2)
    expect(result.screenings.some(s => s.filmId === 'f1')).toBe(true)
    expect(result.screenings.some(s => s.filmId === 'f2')).toBe(true)
  })
  
  it('honors excluded films', () => {
    const films = [
      createFilm('f1', 'Film 1', 90),
      createFilm('f2', 'Film 2', 90)
    ]
    
    const screenings = [
      createScreening('s1', 'f1', '2026-10-14', '10:00', 90),
      createScreening('s2', 'f2', '2026-10-14', '14:00', 90)
    ]
    
    const result = generatePlan({
      films,
      screenings,
      interests: {},
      constraints: { excludedFilms: ['f1'] },
      objective: OBJECTIVES.MOST_FILMS
    })
    
    expect(result.screenings).toHaveLength(1)
    expect(result.screenings[0].filmId).toBe('f2')
  })
  
  it('honors required films', () => {
    const films = [
      createFilm('f1', 'Film 1', 90),
      createFilm('f2', 'Film 2', 90)
    ]
    
    const screenings = [
      createScreening('s1', 'f1', '2026-10-14', '10:00', 90),
      createScreening('s2', 'f2', '2026-10-14', '14:00', 90)
    ]
    
    const result = generatePlan({
      films,
      screenings,
      interests: {},
      constraints: { requiredFilms: ['f1'] },
      objective: OBJECTIVES.MOST_FILMS
    })
    
    expect(result.screenings.some(s => s.filmId === 'f1')).toBe(true)
  })
  
  it('reports infeasibility when required films conflict', () => {
    const films = [
      createFilm('f1', 'Film 1', 120),
      createFilm('f2', 'Film 2', 120)
    ]
    
    const screenings = [
      createScreening('s1', 'f1', '2026-10-14', '10:00', 120),
      createScreening('s2', 'f2', '2026-10-14', '10:30', 120)
    ]
    
    const result = generatePlan({
      films,
      screenings,
      interests: {},
      constraints: { requiredFilms: ['f1', 'f2'] },
      objective: OBJECTIVES.MOST_FILMS
    })
    
    expect(result.infeasible).toBe(true)
  })
  
  it('honors locked screenings', () => {
    const films = [
      createFilm('f1', 'Film 1', 90),
      createFilm('f2', 'Film 2', 90)
    ]
    
    const screenings = [
      createScreening('s1', 'f1', '2026-10-14', '10:00', 90),
      createScreening('s2', 'f2', '2026-10-14', '14:00', 90)
    ]
    
    const result = generatePlan({
      films,
      screenings,
      interests: {},
      constraints: { lockedScreenings: ['s2'] },
      objective: OBJECTIVES.MOST_FILMS
    })
    
    expect(result.screenings.some(s => s.id === 's2')).toBe(true)
  })
  
  it('honors day/time availability', () => {
    const films = [
      createFilm('f1', 'Film 1', 90),
      createFilm('f2', 'Film 2', 90)
    ]
    
    const screenings = [
      createScreening('s1', 'f1', '2026-10-14', '10:00', 90),
      createScreening('s2', 'f2', '2026-10-14', '14:00', 90)
    ]
    
    const result = generatePlan({
      films,
      screenings,
      interests: {},
      constraints: {
        availabilityWindows: {
          '2026-10-14': {
            enabled: true,
            earliestStart: '13:00',
            latestEnd: '23:00'
          }
        }
      },
      objective: OBJECTIVES.MOST_FILMS
    })
    
    expect(result.screenings).toHaveLength(1)
    expect(result.screenings[0].filmId).toBe('f2')
  })
  
  it('honors max films per day', () => {
    const films = [
      createFilm('f1', 'Film 1', 60),
      createFilm('f2', 'Film 2', 60),
      createFilm('f3', 'Film 3', 60)
    ]
    
    const screenings = [
      createScreening('s1', 'f1', '2026-10-14', '10:00', 60),
      createScreening('s2', 'f2', '2026-10-14', '12:00', 60),
      createScreening('s3', 'f3', '2026-10-14', '14:00', 60)
    ]
    
    const result = generatePlan({
      films,
      screenings,
      interests: {},
      constraints: { maxFilmsPerDay: 2 },
      objective: OBJECTIVES.MOST_FILMS
    })
    
    expect(result.screenings.length).toBeLessThanOrEqual(2)
  })
  
  it('honors total max films', () => {
    const films = [
      createFilm('f1', 'Film 1', 60),
      createFilm('f2', 'Film 2', 60),
      createFilm('f3', 'Film 3', 60),
      createFilm('f4', 'Film 4', 60)
    ]
    
    const screenings = [
      createScreening('s1', 'f1', '2026-10-14', '10:00', 60),
      createScreening('s2', 'f2', '2026-10-14', '12:00', 60),
      createScreening('s3', 'f3', '2026-10-15', '10:00', 60),
      createScreening('s4', 'f4', '2026-10-15', '12:00', 60)
    ]
    
    const result = generatePlan({
      films,
      screenings,
      interests: {},
      constraints: { maxFilmsTotal: 2 },
      objective: OBJECTIVES.MOST_FILMS
    })
    
    expect(result.screenings.length).toBeLessThanOrEqual(2)
  })
  
  it('Most Films prioritizes count before preference', () => {
    const films = [
      createFilm('f1', 'High Interest', 120),
      createFilm('f2', 'Low Interest 1', 60),
      createFilm('f3', 'Low Interest 2', 60)
    ]
    
    const screenings = [
      createScreening('s1', 'f1', '2026-10-14', '10:00', 120),
      createScreening('s2', 'f2', '2026-10-14', '10:00', 60),
      createScreening('s3', 'f3', '2026-10-14', '11:30', 60)
    ]
    
    const interests = {
      f1: INTEREST_LEVELS.MUST_SEE,
      f2: null,
      f3: null
    }
    
    const result = generatePlan({
      films,
      screenings,
      interests,
      constraints: {},
      objective: OBJECTIVES.MOST_FILMS
    })
    
    expect(result.screenings).toHaveLength(2)
    expect(result.screenings.some(s => s.filmId === 'f2')).toBe(true)
    expect(result.screenings.some(s => s.filmId === 'f3')).toBe(true)
  })
  
  it('Best Matches prioritizes interest appropriately', () => {
    const films = [
      createFilm('f1', 'High Interest', 120),
      createFilm('f2', 'Low Interest 1', 60),
      createFilm('f3', 'Low Interest 2', 60)
    ]
    
    const screenings = [
      createScreening('s1', 'f1', '2026-10-14', '10:00', 120),
      createScreening('s2', 'f2', '2026-10-14', '10:00', 60),
      createScreening('s3', 'f3', '2026-10-14', '11:30', 60)
    ]
    
    const interests = {
      f1: INTEREST_LEVELS.MUST_SEE,
      f2: null,
      f3: null
    }
    
    const result = generatePlan({
      films,
      screenings,
      interests,
      constraints: {},
      objective: OBJECTIVES.BEST_MATCHES
    })
    
    expect(result.screenings).toHaveLength(1)
    expect(result.screenings[0].filmId).toBe('f1')
  })
  
  it('plan output contains no overlaps', () => {
    const films = Array.from({ length: 10 }, (_, i) => 
      createFilm(`f${i}`, `Film ${i}`, 90)
    )
    
    const screenings = films.flatMap((film, i) => [
      createScreening(`${film.id}_a`, film.id, '2026-10-14', `${10 + i}:00`, 90),
      createScreening(`${film.id}_b`, film.id, '2026-10-14', `${10 + i}:30`, 90)
    ])
    
    const result = generatePlan({
      films,
      screenings,
      interests: {},
      constraints: {},
      objective: OBJECTIVES.MOST_FILMS
    })
    
    for (let i = 0; i < result.screenings.length; i++) {
      for (let j = i + 1; j < result.screenings.length; j++) {
        const s1 = result.screenings[i]
        const s2 = result.screenings[j]
        
        if (s1.date === s2.date) {
          const [s1EndH, s1EndM] = s1.endTime.split(':').map(Number)
          const [s2StartH, s2StartM] = s2.startTime.split(':').map(Number)
          const [s2EndH, s2EndM] = s2.endTime.split(':').map(Number)
          const [s1StartH, s1StartM] = s1.startTime.split(':').map(Number)
          
          const s1End = s1EndH * 60 + s1EndM
          const s2Start = s2StartH * 60 + s2StartM
          const s2End = s2EndH * 60 + s2EndM
          const s1Start = s1StartH * 60 + s1StartM
          
          const overlaps = s1Start < s2End && s2Start < s1End
          expect(overlaps).toBe(false)
        }
      }
    }
  })
})
