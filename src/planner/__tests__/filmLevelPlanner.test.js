/**
 * Film-level required-set + ranking + alternatives (film-level optimal planner)
 */

import { describe, it, expect } from 'vitest'
import { generatePlanV3 } from '../optimizerV3'
import { resolveRequiredFilms, preferenceScore, comparePreferenceTuples, filmSetKey } from '../requiredFilms'
import { applyExcludeFilm } from '../generateCurrentPlan'
import { validatePlan } from '../../utils/planValidator'
import { INTEREST_LEVELS } from '../../utils/userState'
import { films, screenings } from '../../utils/festivalData'
import { deriveFestivalAvailability } from '../../utils/festivalAvailability'

describe('resolveRequiredFilms', () => {
  it('Must film is automatically required', () => {
    const r = resolveRequiredFilms(
      { f1: INTEREST_LEVELS.MUST_SEE, f2: INTEREST_LEVELS.WANT_TO_SEE },
      { requiredFilms: [], excludedFilms: [] }
    )
    expect(r.requiredFilmIds).toContain('f1')
    expect(r.requiredFilmIds).not.toContain('f2')
    expect(r.contradiction).toBeNull()
  })

  it('manual Want requirement forces inclusion in required set', () => {
    const r = resolveRequiredFilms(
      { f2: INTEREST_LEVELS.WANT_TO_SEE },
      { requiredFilms: ['f2'], excludedFilms: [] }
    )
    expect(r.requiredFilmIds).toContain('f2')
    expect(r.manualRequiredIds).toContain('f2')
  })

  it('Exclude clears manual require (Exclude wins)', () => {
    const updates = applyExcludeFilm(
      { requiredFilms: ['f2'], excludedFilms: [] },
      'f2'
    )
    expect(updates.excludedFilms).toContain('f2')
    expect(updates.requiredFilms).not.toContain('f2')

    const r = resolveRequiredFilms(
      { f2: INTEREST_LEVELS.WANT_TO_SEE },
      updates
    )
    expect(r.requiredFilmIds).not.toContain('f2')
  })

  it('Must + Exclude is an explicit contradiction', () => {
    const r = resolveRequiredFilms(
      { f1: INTEREST_LEVELS.MUST_SEE },
      { requiredFilms: [], excludedFilms: ['f1'] }
    )
    expect(r.contradiction).toBeTruthy()
    expect(r.contradiction.type).toBe('must-excluded')
    expect(r.contradiction.reason).toMatch(/Must/i)
  })
})

describe('Required films in optimizer', () => {
  const testFilms = [
    { id: 'f1', title: 'Film 1', runtime: 90 },
    { id: 'f2', title: 'Film 2', runtime: 90 },
    { id: 'f3', title: 'Film 3', runtime: 90 }
  ]
  const testScreenings = [
    { id: 's1a', filmId: 'f1', date: '2026-10-14', startTime: '10:00', endTime: '11:30', venue: 'A' },
    { id: 's1b', filmId: 'f1', date: '2026-10-15', startTime: '10:00', endTime: '11:30', venue: 'A' },
    { id: 's2', filmId: 'f2', date: '2026-10-14', startTime: '10:30', endTime: '12:00', venue: 'B' },
    { id: 's3', filmId: 'f3', date: '2026-10-14', startTime: '12:30', endTime: '14:00', venue: 'A' }
  ]

  it('Must film is included and may use an alternate screening', () => {
    // f1 Oct14 overlaps f2; requiring f1+f2 forces f1 onto Oct15
    const result = generatePlanV3({
      films: testFilms,
      screenings: testScreenings,
      interests: {
        f1: INTEREST_LEVELS.MUST_SEE,
        f2: INTEREST_LEVELS.WANT_TO_SEE,
        f3: INTEREST_LEVELS.MAYBE
      },
      constraints: { excludedFilms: [], requiredFilms: ['f2'] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true, '2026-10-15': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 5000
    })

    expect(result.infeasible).toBe(false)
    expect(result.screenings.some(s => s.filmId === 'f1')).toBe(true)
    expect(result.screenings.some(s => s.filmId === 'f2')).toBe(true)
    // f1 should move to s1b to avoid overlap with s2
    expect(result.screenings.find(s => s.filmId === 'f1')?.id).toBe('s1b')
    expect(validatePlan(result, testFilms, testScreenings).valid).toBe(true)
  })

  it('removing manual requirement allows film to disappear', () => {
    const withReq = generatePlanV3({
      films: testFilms,
      screenings: testScreenings,
      interests: { f2: INTEREST_LEVELS.WANT_TO_SEE, f3: INTEREST_LEVELS.MAYBE },
      constraints: { excludedFilms: [], requiredFilms: ['f2'] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true, '2026-10-15': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 5000
    })
    expect(withReq.screenings.some(s => s.filmId === 'f2')).toBe(true)

    const without = generatePlanV3({
      films: testFilms,
      screenings: testScreenings,
      interests: { f2: INTEREST_LEVELS.WANT_TO_SEE, f3: INTEREST_LEVELS.MAYBE },
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true, '2026-10-15': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 5000
    })
    // Without require, optimizer may still include f2 for count — but must not be forced
    // Ensure generation succeeds either way
    expect(without.infeasible).toBe(false)
  })

  it('incompatible required films return infeasible', () => {
    const result = generatePlanV3({
      films: [
        { id: 'a', title: 'A', runtime: 120 },
        { id: 'b', title: 'B', runtime: 120 }
      ],
      screenings: [
        { id: 'sa', filmId: 'a', date: '2026-10-14', startTime: '14:00', endTime: '16:00', venue: 'A' },
        { id: 'sb', filmId: 'b', date: '2026-10-14', startTime: '15:00', endTime: '17:00', venue: 'B' }
      ],
      interests: {
        a: INTEREST_LEVELS.MUST_SEE,
        b: INTEREST_LEVELS.MUST_SEE
      },
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 3000
    })

    expect(result.infeasible).toBe(true)
    expect(result.reason).toMatch(/required|conflict|No schedule/i)
    expect(result.screenings).toEqual([])
  })

  it('required film outside attendance is infeasible', () => {
    const result = generatePlanV3({
      films: testFilms,
      screenings: testScreenings,
      interests: { f1: INTEREST_LEVELS.MUST_SEE },
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-16': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 3000
    })

    expect(result.infeasible).toBe(true)
    expect(result.reason).toMatch(/attendance|Required film/i)
  })

  it('excluded film is absent; stale require+exclude does not reintroduce', () => {
    const result = generatePlanV3({
      films: testFilms,
      screenings: testScreenings,
      interests: { f1: INTEREST_LEVELS.WANT_TO_SEE, f3: INTEREST_LEVELS.MAYBE },
      constraints: {
        excludedFilms: ['f1'],
        requiredFilms: ['f1'] // stale
      },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true, '2026-10-15': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 3000
    })

    expect(result.infeasible).toBe(false)
    expect(result.screenings.some(s => s.filmId === 'f1')).toBe(false)
  })

  it('Must + Exclude returns explicit contradiction from optimizer', () => {
    const result = generatePlanV3({
      films: testFilms,
      screenings: testScreenings,
      interests: { f1: INTEREST_LEVELS.MUST_SEE },
      constraints: { excludedFilms: ['f1'], requiredFilms: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true, '2026-10-15': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 3000
    })
    expect(result.infeasible).toBe(true)
    expect(result.reason).toMatch(/Must/i)
  })
})

describe('Ranking lexicographic preference', () => {
  it('higher film count beats lower', () => {
    const a = preferenceScore(new Set(['1', '2', '3']), {})
    const b = preferenceScore(new Set(['1', '2']), {
      1: INTEREST_LEVELS.MUST_SEE,
      2: INTEREST_LEVELS.MUST_SEE
    })
    expect(comparePreferenceTuples(a.tuple, b.tuple)).toBeGreaterThan(0)
  })

  it('among equal counts, more Wants wins', () => {
    const a = preferenceScore(new Set(['1', '2']), {
      1: INTEREST_LEVELS.WANT_TO_SEE,
      2: INTEREST_LEVELS.MAYBE
    })
    const b = preferenceScore(new Set(['1', '2']), {
      1: INTEREST_LEVELS.MAYBE,
      2: INTEREST_LEVELS.MAYBE
    })
    expect(comparePreferenceTuples(a.tuple, b.tuple)).toBeGreaterThan(0)
  })

  it('film-set keys dedupe same films', () => {
    expect(filmSetKey(['b', 'a'])).toBe(filmSetKey(['a', 'b']))
  })
})

describe('Alternatives by film set', () => {
  it('returns coverage and deduped alternatives on synthetic multi-option instance', () => {
    // Two non-overlapping pairs → multiple max-size plans
    const tf = [
      { id: 'a', title: 'A', runtime: 60 },
      { id: 'b', title: 'B', runtime: 60 },
      { id: 'c', title: 'C', runtime: 60 },
      { id: 'd', title: 'D', runtime: 60 }
    ]
    const ts = [
      { id: 'sa', filmId: 'a', date: '2026-10-14', startTime: '10:00', endTime: '11:00', venue: 'A' },
      { id: 'sb', filmId: 'b', date: '2026-10-14', startTime: '11:00', endTime: '12:00', venue: 'A' },
      { id: 'sc', filmId: 'c', date: '2026-10-15', startTime: '10:00', endTime: '11:00', venue: 'A' },
      { id: 'sd', filmId: 'd', date: '2026-10-15', startTime: '11:00', endTime: '12:00', venue: 'A' }
    ]

    const result = generatePlanV3({
      films: tf,
      screenings: ts,
      interests: {
        a: INTEREST_LEVELS.WANT_TO_SEE,
        b: INTEREST_LEVELS.WANT_TO_SEE,
        c: INTEREST_LEVELS.MAYBE,
        d: INTEREST_LEVELS.MAYBE
      },
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true, '2026-10-15': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 5000
    })

    expect(result.infeasible).toBe(false)
    expect(result.filmCount).toBe(4)
    expect(result.coverage).toBeTruthy()
    expect(result.metadata.status).toMatch(/maximum-proven|best-found/)
    // With all 4 feasible, same-size alternatives may be empty; oneFewer should exist or not
    if (result.alternatives.oneFewer) {
      expect(result.alternatives.oneFewer.filmCount).toBe(3)
      expect(result.alternatives.oneFewer.drops.length + result.alternatives.oneFewer.adds.length).toBeGreaterThan(0)
    }
  })
})

describe('Real OIFF unrestricted maximum', () => {
  it('produces 24 films with empty ratings (full attendance)', { timeout: 90000 }, () => {
    const arrival = { date: '2026-10-13', type: 'already-on-island' }
    const departure = { date: '2026-10-19', type: 'staying-longer' }
    const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(
      arrival,
      departure,
      []
    )

    const result = generatePlanV3({
      films,
      screenings,
      interests: {},
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: { attendanceDays, availabilityByDate },
      timeBudgetMs: 60000
    })

    expect(result.infeasible).toBe(false)
    expect(result.filmCount).toBe(24)
    expect(validatePlan(result, films, screenings).valid).toBe(true)
    console.log(
      `OIFF max=${result.filmCount} proven=${result.metadata.optimalityProven} ` +
      `elapsed=${result.metadata.elapsedMs?.toFixed(0)}ms sets=${result.metadata.distinctFilmSets}`
    )
  })
})
