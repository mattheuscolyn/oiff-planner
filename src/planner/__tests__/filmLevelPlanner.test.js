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
        requiredFilms: ['f1']
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

describe('Daily capacity bound and proof semantics', () => {
  it('computes daily maxima and proves count when plan hits the bound', () => {
    // Day1 max 2, Day2 max 2 → global upper bound 4
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
      interests: {},
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true, '2026-10-15': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 5000
    })

    expect(result.metadata.dailyMaxima['2026-10-14']).toBe(2)
    expect(result.metadata.dailyMaxima['2026-10-15']).toBe(2)
    expect(result.metadata.globalCountUpperBound).toBe(4)
    expect(result.filmCount).toBe(4)
    expect(result.metadata.maxFilmCountProven).toBe(true)
  })

  it('max-count proof does not automatically imply preference proof', () => {
    // Tiny budget: hit capacity bound in Phase A, but preference search may not exhaust
    const tf = [
      { id: 'a', title: 'A', runtime: 60 },
      { id: 'b', title: 'B', runtime: 60 },
      { id: 'c', title: 'C', runtime: 60 },
      { id: 'd', title: 'D', runtime: 60 },
      { id: 'e', title: 'E', runtime: 60 },
      { id: 'f', title: 'F', runtime: 60 }
    ]
    const ts = [
      { id: 'sa', filmId: 'a', date: '2026-10-14', startTime: '10:00', endTime: '11:00', venue: 'A' },
      { id: 'sb', filmId: 'b', date: '2026-10-14', startTime: '11:00', endTime: '12:00', venue: 'A' },
      { id: 'sc', filmId: 'c', date: '2026-10-14', startTime: '10:00', endTime: '11:00', venue: 'B' },
      { id: 'sd', filmId: 'd', date: '2026-10-15', startTime: '10:00', endTime: '11:00', venue: 'A' },
      { id: 'se', filmId: 'e', date: '2026-10-15', startTime: '11:00', endTime: '12:00', venue: 'A' },
      { id: 'sf', filmId: 'f', date: '2026-10-15', startTime: '10:00', endTime: '11:00', venue: 'B' }
    ]

    const result = generatePlanV3({
      films: tf,
      screenings: ts,
      interests: {
        a: INTEREST_LEVELS.WANT_TO_SEE,
        b: INTEREST_LEVELS.WANT_TO_SEE,
        c: INTEREST_LEVELS.MAYBE,
        d: INTEREST_LEVELS.WANT_TO_SEE,
        e: INTEREST_LEVELS.MAYBE,
        f: INTEREST_LEVELS.MAYBE
      },
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true, '2026-10-15': true },
        availabilityByDate: {}
      },
      // Extremely tight — count may still prove via bound; preference may not exhaust
      timeBudgetMs: 1
    })

    expect(result.filmCount).toBe(result.metadata.globalCountUpperBound)
    expect(result.metadata.maxFilmCountProven).toBe(true)
    // Preference proof is independent — do not require it true
    expect(typeof result.metadata.preferenceOptimalityProven).toBe('boolean')
  })
})

describe('Fixed-count preference and max−1 alternatives', () => {
  it('prefers more Wants among equal-size plans, then more Maybes', () => {
    // Two mutually exclusive max packs of size 2
    const tf = [
      { id: 'w1', title: 'Want1', runtime: 60 },
      { id: 'w2', title: 'Want2', runtime: 60 },
      { id: 'm1', title: 'Maybe1', runtime: 60 },
      { id: 'm2', title: 'Maybe2', runtime: 60 }
    ]
    // Same slots: either both Wants or both Maybes (venues parallel)
    const ts = [
      { id: 'sw1', filmId: 'w1', date: '2026-10-14', startTime: '10:00', endTime: '11:00', venue: 'A' },
      { id: 'sw2', filmId: 'w2', date: '2026-10-14', startTime: '11:00', endTime: '12:00', venue: 'A' },
      { id: 'sm1', filmId: 'm1', date: '2026-10-14', startTime: '10:00', endTime: '11:00', venue: 'B' },
      { id: 'sm2', filmId: 'm2', date: '2026-10-14', startTime: '11:00', endTime: '12:00', venue: 'B' }
    ]

    const wantWins = generatePlanV3({
      films: tf,
      screenings: ts,
      interests: {
        w1: INTEREST_LEVELS.WANT_TO_SEE,
        w2: INTEREST_LEVELS.WANT_TO_SEE,
        m1: INTEREST_LEVELS.MAYBE,
        m2: INTEREST_LEVELS.MAYBE
      },
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 5000
    })

    expect(wantWins.filmCount).toBe(2)
    expect(wantWins.wantToSeeCount).toBe(2)
    expect(wantWins.maybeCount).toBe(0)

    // Equal wants (0), more maybes should win over unrated
    const tf2 = [
      { id: 'm1', title: 'Maybe1', runtime: 60 },
      { id: 'm2', title: 'Maybe2', runtime: 60 },
      { id: 'u1', title: 'Unrated1', runtime: 60 },
      { id: 'u2', title: 'Unrated2', runtime: 60 }
    ]
    const ts2 = [
      { id: 'sm1', filmId: 'm1', date: '2026-10-14', startTime: '10:00', endTime: '11:00', venue: 'A' },
      { id: 'sm2', filmId: 'm2', date: '2026-10-14', startTime: '11:00', endTime: '12:00', venue: 'A' },
      { id: 'su1', filmId: 'u1', date: '2026-10-14', startTime: '10:00', endTime: '11:00', venue: 'B' },
      { id: 'su2', filmId: 'u2', date: '2026-10-14', startTime: '11:00', endTime: '12:00', venue: 'B' }
    ]
    const maybeWins = generatePlanV3({
      films: tf2,
      screenings: ts2,
      interests: {
        m1: INTEREST_LEVELS.MAYBE,
        m2: INTEREST_LEVELS.MAYBE
      },
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 5000
    })
    expect(maybeWins.filmCount).toBe(2)
    expect(maybeWins.maybeCount).toBe(2)
  })

  it('guarantees a max−1 alternative when one exists, even if max was found first', () => {
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

    expect(result.filmCount).toBe(4)
    expect(result.alternatives.oneFewer).toBeTruthy()
    expect(result.alternatives.oneFewer.filmCount).toBe(result.filmCount - 1)
    expect(validatePlan(
      { screenings: result.alternatives.oneFewer.screenings, filmCount: 3 },
      tf,
      ts
    ).valid).toBe(true)
  })

  it('same-size alternatives are deduped by film set and independently valid', () => {
    // Parallel venues give multiple distinct 2-film sets of max size
    const tf = [
      { id: 'a', title: 'A', runtime: 60 },
      { id: 'b', title: 'B', runtime: 60 },
      { id: 'c', title: 'C', runtime: 60 },
      { id: 'd', title: 'D', runtime: 60 }
    ]
    const ts = [
      { id: 'sa', filmId: 'a', date: '2026-10-14', startTime: '10:00', endTime: '11:00', venue: 'A' },
      { id: 'sb', filmId: 'b', date: '2026-10-14', startTime: '10:00', endTime: '11:00', venue: 'B' },
      { id: 'sc', filmId: 'c', date: '2026-10-14', startTime: '11:00', endTime: '12:00', venue: 'A' },
      { id: 'sd', filmId: 'd', date: '2026-10-14', startTime: '11:00', endTime: '12:00', venue: 'B' }
    ]

    const result = generatePlanV3({
      films: tf,
      screenings: ts,
      interests: {
        a: INTEREST_LEVELS.WANT_TO_SEE,
        b: INTEREST_LEVELS.WANT_TO_SEE,
        c: INTEREST_LEVELS.WANT_TO_SEE,
        d: INTEREST_LEVELS.WANT_TO_SEE
      },
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 5000
    })

    expect(result.filmCount).toBe(2)
    const keys = new Set(
      (result.alternatives.sameSize || []).map(a => a.filmSetKey)
    )
    expect(keys.size).toBe(result.alternatives.sameSize?.length || 0)

    for (const alt of result.alternatives.sameSize || []) {
      expect(alt.filmCount).toBe(2)
      expect(validatePlan({ screenings: alt.screenings, filmCount: 2 }, tf, ts).valid).toBe(true)
    }
    expect(result.alternatives.oneFewer).toBeTruthy()
    expect(result.alternatives.oneFewer.filmCount).toBe(1)
  })
})

describe('Real OIFF unrestricted maximum', () => {
  it('produces 24 films with count proven (full attendance)', { timeout: 90000 }, () => {
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
    expect(result.metadata.maxFilmCountProven).toBe(true)
    expect(result.metadata.globalCountUpperBound).toBe(24)
    expect(validatePlan(result, films, screenings).valid).toBe(true)

    expect(result.alternatives.oneFewer).toBeTruthy()
    expect(result.alternatives.oneFewer.filmCount).toBe(23)
    expect(
      validatePlan(
        { screenings: result.alternatives.oneFewer.screenings, filmCount: 23 },
        films,
        screenings
      ).valid
    ).toBe(true)

    console.log('Daily maxima:', result.metadata.dailyMaxima)
    console.log(`Global count upper bound: ${result.metadata.globalCountUpperBound}`)
    console.log(`Best plan: ${result.filmCount}`)
    console.log(`Max film count proven: ${result.metadata.maxFilmCountProven}`)
    console.log(`Preference optimality proven: ${result.metadata.preferenceOptimalityProven}`)
    console.log(`Best 23-film alternative: ${result.alternatives.oneFewer.filmCount}`)
    console.log(`Phase ms:`, result.metadata.phaseMs)
    console.log(
      `OIFF max=${result.filmCount} countProven=${result.metadata.maxFilmCountProven} ` +
        `prefProven=${result.metadata.preferenceOptimalityProven} ` +
        `elapsed=${result.metadata.elapsedMs?.toFixed(0)}ms sets=${result.metadata.distinctFilmSets}`
    )
  })
})
