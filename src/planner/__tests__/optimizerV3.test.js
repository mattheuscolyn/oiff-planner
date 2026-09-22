import { describe, it, expect } from 'vitest'
import { generatePlanV3 } from '../optimizerV3'
import { films, screenings } from '../../utils/festivalData'

describe('OptimizerV3 - Maximum Film Count Priority', () => {
  it('should prioritize film count over preference level', () => {
    // Create scenario where we can see 3 unrated films or 1 must-see film
    const mockFilms = [
      { id: 'f1', title: 'Film 1', runtime: 90 },
      { id: 'f2', title: 'Film 2', runtime: 90 },
      { id: 'f3', title: 'Film 3', runtime: 90 },
      { id: 'f4', title: 'Film 4', runtime: 90 }
    ]

    const mockScreenings = [
      // F1-F3 don't overlap
      { id: 's1', filmId: 'f1', date: '2026-10-14', startTime: '2026-10-14T10:00:00', endTime: '2026-10-14T11:30:00' },
      { id: 's2', filmId: 'f2', date: '2026-10-14', startTime: '2026-10-14T12:00:00', endTime: '2026-10-14T13:30:00' },
      { id: 's3', filmId: 'f3', date: '2026-10-14', startTime: '2026-10-14T14:00:00', endTime: '2026-10-14T15:30:00' },
      // F4 is must-see but overlaps all others
      { id: 's4', filmId: 'f4', date: '2026-10-14', startTime: '2026-10-14T10:30:00', endTime: '2026-10-14T15:00:00' }
    ]

    const interests = {
      'f1': 'unrated',
      'f2': 'unrated',
      'f3': 'unrated',
      'f4': 'must-see'
    }

    const attendanceConstraints = {
      attendanceDays: { '2026-10-14': true },
      availabilityByDate: {}
    }

    const result = generatePlanV3({
      films: mockFilms,
      screenings: mockScreenings,
      interests,
      constraints: {},
      attendanceConstraints,
      hardDecisions: {},
      timeBudgetMs: 1000
    })

    // Should choose 3 films over 1 must-see
    expect(result.filmCount).toBe(3)
    expect(result.mustSeeCount).toBe(0)
  })

  it('should verify real OIFF 2026 maximum with 9AM-11PM availability', () => {
    const attendanceConstraints = {
      attendanceDays: {
        '2026-10-14': true,
        '2026-10-15': true,
        '2026-10-16': true,
        '2026-10-17': true,
        '2026-10-18': true
      },
      availabilityByDate: {
        '2026-10-14': { from: '2026-10-14T09:00', until: '2026-10-14T23:00' },
        '2026-10-15': { from: '2026-10-15T09:00', until: '2026-10-15T23:00' },
        '2026-10-16': { from: '2026-10-16T09:00', until: '2026-10-16T23:00' },
        '2026-10-17': { from: '2026-10-17T09:00', until: '2026-10-17T23:00' },
        '2026-10-18': { from: '2026-10-18T09:00', until: '2026-10-18T23:00' }
      }
    }

    const result = generatePlanV3({
      films,
      screenings,
      interests: {},
      constraints: {},
      attendanceConstraints,
      hardDecisions: {},
      timeBudgetMs: 5000
    })

    console.log(`Result: ${result.filmCount} films`)
    console.log(`Metadata:`, result.metadata)

    // Verify we achieve at least 20 films (conservative lower bound)
    // The exact maximum should be discovered through this test
    expect(result.filmCount).toBeGreaterThanOrEqual(20)
    expect(result.infeasible).toBe(false)
    expect(result.screenings.length).toBe(result.filmCount)
  })

  it('should verify real OIFF 2026 maximum with unrestricted availability', () => {
    const attendanceConstraints = {
      attendanceDays: {
        '2026-10-14': true,
        '2026-10-15': true,
        '2026-10-16': true,
        '2026-10-17': true,
        '2026-10-18': true
      },
      availabilityByDate: {} // No time restrictions
    }

    const result = generatePlanV3({
      films,
      screenings,
      interests: {},
      constraints: {},
      attendanceConstraints,
      hardDecisions: {},
      timeBudgetMs: 5000
    })

    console.log(`Unrestricted result: ${result.filmCount} films`)

    // Should achieve at least the 9AM-11PM maximum
    expect(result.filmCount).toBeGreaterThanOrEqual(20)
    expect(result.infeasible).toBe(false)
  })

  it('should respect locked screenings', () => {
    const mockFilms = [
      { id: 'f1', title: 'Film 1', runtime: 90 },
      { id: 'f2', title: 'Film 2', runtime: 90 },
      { id: 'f3', title: 'Film 3', runtime: 90 }
    ]

    const mockScreenings = [
      { id: 's1', filmId: 'f1', date: '2026-10-14', startTime: '2026-10-14T10:00:00', endTime: '2026-10-14T11:30:00' },
      { id: 's2', filmId: 'f2', date: '2026-10-14', startTime: '2026-10-14T10:30:00', endTime: '2026-10-14T12:00:00' },
      { id: 's3', filmId: 'f3', date: '2026-10-14', startTime: '2026-10-14T12:30:00', endTime: '2026-10-14T14:00:00' }
    ]

    const attendanceConstraints = {
      attendanceDays: { '2026-10-14': true },
      availabilityByDate: {}
    }

    const result = generatePlanV3({
      films: mockFilms,
      screenings: mockScreenings,
      interests: {},
      constraints: { lockedScreenings: ['s1'] },
      attendanceConstraints,
      hardDecisions: {},
      timeBudgetMs: 1000
    })

    // Should include all 3 films (none overlap)
    expect(result.filmCount).toBe(3)
    expect(result.screenings).toContainEqual(expect.objectContaining({ id: 's1' }))
  })

  it('should respect excluded films', () => {
    const mockFilms = [
      { id: 'f1', title: 'Film 1', runtime: 90 },
      { id: 'f2', title: 'Film 2', runtime: 90 }
    ]

    const mockScreenings = [
      { id: 's1', filmId: 'f1', date: '2026-10-14', startTime: '2026-10-14T10:00:00', endTime: '2026-10-14T11:30:00' },
      { id: 's2', filmId: 'f2', date: '2026-10-14', startTime: '2026-10-14T12:00:00', endTime: '2026-10-14T13:30:00' }
    ]

    const attendanceConstraints = {
      attendanceDays: { '2026-10-14': true },
      availabilityByDate: {}
    }

    const result = generatePlanV3({
      films: mockFilms,
      screenings: mockScreenings,
      interests: {},
      constraints: { excludedFilms: ['f1'] },
      attendanceConstraints,
      hardDecisions: {},
      timeBudgetMs: 1000
    })

    // Should only include f2
    expect(result.filmCount).toBe(1)
    expect(result.screenings[0].filmId).toBe('f2')
  })

  it('should handle one-day attendance', () => {
    const attendanceConstraints = {
      attendanceDays: {
        '2026-10-14': true
      },
      availabilityByDate: {}
    }

    const result = generatePlanV3({
      films,
      screenings,
      interests: {},
      constraints: {},
      attendanceConstraints,
      hardDecisions: {},
      timeBudgetMs: 2000
    })

    // All screenings should be on Oct 14
    result.screenings.forEach(s => {
      expect(s.date).toBe('2026-10-14')
    })

    expect(result.filmCount).toBeGreaterThan(0)
  })
})
