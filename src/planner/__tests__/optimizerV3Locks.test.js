/**
 * Optimizer V3 — locked screening hard constraints (PR #12 follow-up)
 */

import { describe, it, expect } from 'vitest'
import { generatePlanV3 } from '../optimizerV3'
import { validatePlan, screeningsOverlap } from '../../utils/planValidator'
import { films, screenings } from '../../utils/festivalData'

const FULL_ATTENDANCE = {
  attendanceDays: {
    '2026-10-14': true,
    '2026-10-15': true,
    '2026-10-16': true,
    '2026-10-17': true,
    '2026-10-18': true
  },
  availabilityByDate: {}
}

function assertItineraryConflictFree(plan, allFilms = films, allScreenings = screenings) {
  const validation = validatePlan(plan, allFilms, allScreenings)
  expect(validation.valid, validation.errors.join('\n')).toBe(true)

  // Extra explicit pairwise check via exported helper
  const filmMap = new Map(allFilms.map(f => [f.id, f]))
  for (let i = 0; i < plan.screenings.length; i++) {
    for (let j = i + 1; j < plan.screenings.length; j++) {
      const a = plan.screenings[i]
      const b = plan.screenings[j]
      expect(
        screeningsOverlap(a, b, filmMap.get(a.filmId), filmMap.get(b.filmId))
      ).toBe(false)
    }
  }
}

describe('OptimizerV3 locked screening hard constraints', () => {
  it('locked screening blocks overlapping different-film screenings', () => {
    // Synthetic: lock A; B overlaps A (different film); C does not overlap
    const testFilms = [
      { id: 'f-lock', title: 'Locked Film', runtime: 120 },
      { id: 'f-overlap', title: 'Overlapping Film', runtime: 90 },
      { id: 'f-safe', title: 'Safe Film', runtime: 60 }
    ]
    const testScreenings = [
      {
        id: 's-lock',
        filmId: 'f-lock',
        date: '2026-10-14',
        startTime: '14:00',
        endTime: '16:00',
        venue: 'A'
      },
      {
        id: 's-overlap',
        filmId: 'f-overlap',
        date: '2026-10-14',
        startTime: '15:00',
        endTime: '16:30',
        venue: 'B'
      },
      {
        id: 's-safe',
        filmId: 'f-safe',
        date: '2026-10-14',
        startTime: '16:30',
        endTime: '17:30',
        venue: 'A'
      }
    ]

    // Confirm fixture: overlap exists for the lock vs overlapping candidate
    expect(
      screeningsOverlap(
        testScreenings[0],
        testScreenings[1],
        testFilms[0],
        testFilms[1]
      )
    ).toBe(true)

    const result = generatePlanV3({
      films: testFilms,
      screenings: testScreenings,
      interests: {},
      constraints: {
        excludedFilms: [],
        lockedScreenings: ['s-lock']
      },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 5000
    })

    expect(result.infeasible).toBe(false)
    expect(result.screenings.some(s => s.id === 's-lock')).toBe(true)
    expect(result.screenings.some(s => s.id === 's-overlap')).toBe(false)
    // Companion that does not overlap the lock must still be schedulable
    expect(result.screenings.some(s => s.id === 's-safe')).toBe(true)
    assertItineraryConflictFree(result, testFilms, testScreenings)
  })

  it('multiple compatible locks remain present and conflict-free', () => {
    const testFilms = [
      { id: 'f1', title: 'Film 1', runtime: 90 },
      { id: 'f2', title: 'Film 2', runtime: 90 },
      { id: 'f3', title: 'Film 3', runtime: 90 }
    ]
    const testScreenings = [
      {
        id: 's1',
        filmId: 'f1',
        date: '2026-10-14',
        startTime: '10:00',
        endTime: '11:30',
        venue: 'A'
      },
      {
        id: 's2',
        filmId: 'f2',
        date: '2026-10-14',
        startTime: '12:00',
        endTime: '13:30',
        venue: 'A'
      },
      {
        id: 's3',
        filmId: 'f3',
        date: '2026-10-15',
        startTime: '10:00',
        endTime: '11:30',
        venue: 'A'
      }
    ]

    const result = generatePlanV3({
      films: testFilms,
      screenings: testScreenings,
      interests: {},
      constraints: {
        excludedFilms: [],
        lockedScreenings: ['s1', 's3']
      },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true, '2026-10-15': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 5000
    })

    expect(result.infeasible).toBe(false)
    expect(result.screenings.some(s => s.id === 's1')).toBe(true)
    expect(result.screenings.some(s => s.id === 's3')).toBe(true)
    assertItineraryConflictFree(result, testFilms, testScreenings)
  })

  it('conflicting locks return infeasible with a useful reason', () => {
    const testFilms = [
      { id: 'f1', title: 'Film 1', runtime: 120 },
      { id: 'f2', title: 'Film 2', runtime: 120 }
    ]
    const testScreenings = [
      {
        id: 's1',
        filmId: 'f1',
        date: '2026-10-14',
        startTime: '14:00',
        endTime: '16:00',
        venue: 'A'
      },
      {
        id: 's2',
        filmId: 'f2',
        date: '2026-10-14',
        startTime: '15:00',
        endTime: '17:00',
        venue: 'B'
      }
    ]

    const result = generatePlanV3({
      films: testFilms,
      screenings: testScreenings,
      interests: {},
      constraints: {
        excludedFilms: [],
        lockedScreenings: ['s1', 's2']
      },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 5000
    })

    expect(result.infeasible).toBe(true)
    expect(result.reason).toMatch(/overlap|conflict/i)
    // Must not look like a valid plan containing both locks
    const ids = (result.screenings || []).map(s => s.id)
    expect(ids.includes('s1') && ids.includes('s2')).toBe(false)
  })

  it('real-data lock blocks any overlapping companions (independent validator)', () => {
    // Find a real overlapping pair
    const filmMap = new Map(films.map(f => [f.id, f]))
    let locked = null
    let overlappingOther = null

    outer: for (let i = 0; i < screenings.length; i++) {
      for (let j = i + 1; j < screenings.length; j++) {
        const a = screenings[i]
        const b = screenings[j]
        if (a.filmId === b.filmId) continue
        if (screeningsOverlap(a, b, filmMap.get(a.filmId), filmMap.get(b.filmId))) {
          locked = a
          overlappingOther = b
          break outer
        }
      }
    }

    expect(locked).toBeTruthy()
    expect(overlappingOther).toBeTruthy()

    const result = generatePlanV3({
      films,
      screenings,
      interests: {},
      constraints: {
        excludedFilms: [],
        lockedScreenings: [locked.id]
      },
      attendanceConstraints: FULL_ATTENDANCE,
      timeBudgetMs: 15000
    })

    expect(result.infeasible).toBe(false)
    expect(result.screenings.some(s => s.id === locked.id)).toBe(true)
    expect(result.screenings.some(s => s.id === overlappingOther.id)).toBe(false)
    assertItineraryConflictFree(result)
  }, 60000)
})

describe('OptimizerV3 locked screenings vs attendance availability', () => {
  const testFilms = [
    { id: 'f1', title: 'Film 1', runtime: 90 }
  ]
  const testScreenings = [
    {
      id: 's1',
      filmId: 'f1',
      date: '2026-10-14',
      startTime: '10:00',
      endTime: '11:30',
      venue: 'A'
    }
  ]

  it('locked screening on a non-attendance day is infeasible', () => {
    const result = generatePlanV3({
      films: testFilms,
      screenings: testScreenings,
      interests: {},
      constraints: { excludedFilms: [], lockedScreenings: ['s1'] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': false, '2026-10-15': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 2000
    })

    expect(result.infeasible).toBe(true)
    expect(result.reason).toMatch(/locked screening|availability|attendance/i)
    expect((result.screenings || []).some(s => s.id === 's1')).toBe(false)
  })

  it('locked screening before day from is infeasible', () => {
    const result = generatePlanV3({
      films: testFilms,
      screenings: testScreenings,
      interests: {},
      constraints: { excludedFilms: [], lockedScreenings: ['s1'] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {
          '2026-10-14': { from: '12:00', until: null }
        }
      },
      timeBudgetMs: 2000
    })

    expect(result.infeasible).toBe(true)
    expect(result.reason).toMatch(/locked screening|availability|before/i)
    expect((result.screenings || []).some(s => s.id === 's1')).toBe(false)
  })

  it('locked screening after day until is infeasible', () => {
    const lateScreenings = [
      {
        id: 's-late',
        filmId: 'f1',
        date: '2026-10-14',
        startTime: '21:30',
        endTime: '23:30',
        venue: 'A'
      }
    ]

    const result = generatePlanV3({
      films: testFilms,
      screenings: lateScreenings,
      interests: {},
      constraints: { excludedFilms: [], lockedScreenings: ['s-late'] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {
          '2026-10-14': { from: null, until: '22:00' }
        }
      },
      timeBudgetMs: 2000
    })

    expect(result.infeasible).toBe(true)
    expect(result.reason).toMatch(/locked screening|availability|after/i)
    expect((result.screenings || []).some(s => s.id === 's-late')).toBe(false)
  })

  it('contradictory exclude+lock does not reintroduce the excluded film', () => {
    const moreFilms = [
      { id: 'f1', title: 'Film 1', runtime: 90 },
      { id: 'f2', title: 'Film 2', runtime: 90 }
    ]
    const moreScreenings = [
      {
        id: 's1',
        filmId: 'f1',
        date: '2026-10-14',
        startTime: '10:00',
        endTime: '11:30',
        venue: 'A'
      },
      {
        id: 's2',
        filmId: 'f2',
        date: '2026-10-14',
        startTime: '12:00',
        endTime: '13:30',
        venue: 'A'
      }
    ]

    // Stale state: film excluded AND its screening still locked
    const result = generatePlanV3({
      films: moreFilms,
      screenings: moreScreenings,
      interests: {},
      constraints: {
        excludedFilms: ['f1'],
        lockedScreenings: ['s1']
      },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 2000
    })

    expect(result.infeasible).toBe(false)
    expect(result.screenings.some(s => s.filmId === 'f1')).toBe(false)
    expect(result.screenings.some(s => s.id === 's1')).toBe(false)
  })
})
