import { describe, it, expect } from 'vitest'
import { generatePlanV2 } from '../optimizerV2'

describe('Optimizer V2 - Branch and Bound', () => {
  const mockFilms = [
    { id: 'f1', title: 'Film 1', runtime: 120 },
    { id: 'f2', title: 'Film 2', runtime: 90 },
    { id: 'f3', title: 'Film 3', runtime: 100 }
  ]

  const mockScreenings = [
    { id: 's1', filmId: 'f1', date: '2026-10-14', startTime: '10:00', endTime: '12:00', venue: 'Main' },
    { id: 's2', filmId: 'f2', date: '2026-10-14', startTime: '13:00', endTime: '14:30', venue: 'Main' },
    { id: 's3', filmId: 'f3', date: '2026-10-14', startTime: '15:00', endTime: '16:40', venue: 'Main' }
  ]

  it('should generate a valid plan', () => {
    const result = generatePlanV2({
      films: mockFilms,
      screenings: mockScreenings,
      interests: {
        'f1': 'must-see',
        'f2': 'want-to-see',
        'f3': 'maybe'
      },
      constraints: {
        excludedFilms: [],
        lockedScreenings: []
      },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      hardDecisions: {},
      timeBudgetMs: 500
    })

    expect(result.screenings).toBeDefined()
    expect(result.infeasible).toBe(false)
    expect(result.screenings.length).toBeGreaterThan(0)
  })

  it('should return metadata', () => {
    const result = generatePlanV2({
      films: mockFilms,
      screenings: mockScreenings,
      interests: {},
      constraints: { excludedFilms: [], lockedScreenings: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      hardDecisions: {},
      timeBudgetMs: 500
    })

    expect(result.metadata).toBeDefined()
    expect(result.metadata.nodesExplored).toBeGreaterThan(0)
    expect(result.metadata.totalMs).toBeGreaterThan(0)
    expect(result.metadata.greedyMs).toBeGreaterThan(0)
  })

  it('should respect locked screenings', () => {
    const result = generatePlanV2({
      films: mockFilms,
      screenings: mockScreenings,
      interests: {},
      constraints: {
        excludedFilms: [],
        lockedScreenings: ['s1']
      },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      hardDecisions: {},
      timeBudgetMs: 500
    })

    expect(result.screenings.some(s => s.id === 's1')).toBe(true)
  })

  it('should exclude specified films', () => {
    const result = generatePlanV2({
      films: mockFilms,
      screenings: mockScreenings,
      interests: {},
      constraints: {
        excludedFilms: ['f2'],
        lockedScreenings: []
      },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      hardDecisions: {},
      timeBudgetMs: 500
    })

    expect(result.screenings.every(s => s.filmId !== 'f2')).toBe(true)
  })

  it('should respect attendance days', () => {
    const result = generatePlanV2({
      films: mockFilms,
      screenings: mockScreenings,
      interests: {},
      constraints: { excludedFilms: [], lockedScreenings: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': false },
        availabilityByDate: {}
      },
      hardDecisions: {},
      timeBudgetMs: 500
    })

    expect(result.screenings.length).toBe(0)
  })

  it('should not return overlapping screenings', () => {
    const overlappingScreenings = [
      { id: 's1', filmId: 'f1', date: '2026-10-14', startTime: '10:00', endTime: '12:00', venue: 'Main' },
      { id: 's2', filmId: 'f2', date: '2026-10-14', startTime: '11:00', endTime: '12:30', venue: 'Main' },
      { id: 's3', filmId: 'f3', date: '2026-10-14', startTime: '13:00', endTime: '14:40', venue: 'Main' }
    ]

    const result = generatePlanV2({
      films: mockFilms,
      screenings: overlappingScreenings,
      interests: {
        'f1': 'must-see',
        'f2': 'must-see',
        'f3': 'must-see'
      },
      constraints: { excludedFilms: [], lockedScreenings: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      hardDecisions: {},
      timeBudgetMs: 500
    })

    // Check no overlaps in result
    for (let i = 0; i < result.screenings.length; i++) {
      for (let j = i + 1; j < result.screenings.length; j++) {
        const s1 = result.screenings[i]
        const s2 = result.screenings[j]
        
        if (s1.date === s2.date) {
          const parseTime = (t) => {
            const [h, m] = t.split(':').map(Number)
            return h * 60 + m
          }
          
          const s1Start = parseTime(s1.startTime)
          const s1End = parseTime(s1.endTime)
          const s2Start = parseTime(s2.startTime)
          const s2End = parseTime(s2.endTime)
          
          const overlaps = (s1Start < s2End && s2Start < s1End)
          expect(overlaps).toBe(false)
        }
      }
    }
  })

  it('should include each film at most once', () => {
    const result = generatePlanV2({
      films: mockFilms,
      screenings: mockScreenings,
      interests: {},
      constraints: { excludedFilms: [], lockedScreenings: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      hardDecisions: {},
      timeBudgetMs: 500
    })

    const filmIds = result.screenings.map(s => s.filmId)
    const uniqueFilmIds = new Set(filmIds)
    expect(filmIds.length).toBe(uniqueFilmIds.size)
  })

  it('should respect hard decisions', () => {
    const hardDecisions = {
      'f1_vs_f2': {
        chosen: 'f1',
        excluded: ['f2']
      }
    }

    const result = generatePlanV2({
      films: mockFilms,
      screenings: mockScreenings,
      interests: {},
      constraints: { excludedFilms: [], lockedScreenings: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      hardDecisions,
      timeBudgetMs: 500
    })

    expect(result.screenings.every(s => s.filmId !== 'f2')).toBe(true)
  })

  it('should complete within time budget', () => {
    const timeBudget = 100 // 100ms

    const startTime = performance.now()
    const result = generatePlanV2({
      films: mockFilms,
      screenings: mockScreenings,
      interests: {},
      constraints: { excludedFilms: [], lockedScreenings: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      hardDecisions: {},
      timeBudgetMs: timeBudget
    })
    const elapsed = performance.now() - startTime

    // Should complete reasonably close to budget (with some overhead tolerance)
    expect(elapsed).toBeLessThan(timeBudget + 100)
    expect(result.metadata.totalMs).toBeLessThan(timeBudget + 100)
  })
})
