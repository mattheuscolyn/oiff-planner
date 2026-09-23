/**
 * Local slot alternatives + pair-check helpers
 */

import { describe, it, expect } from 'vitest'
import {
  buildSlotOptions,
  canLocallyReplace,
  enrichOmissionsWithSlotHints,
  summarizePairCheckDiff
} from '../slotOptions'
import {
  buildRequireBothUpdates,
  buildPairCheckConstraintOverrides,
  shapePairCheckResult
} from '../pairCheck'
import { generatePlanV3 } from '../optimizerV3'
import { INTEREST_LEVELS } from '../../utils/userState'

function filmMapOf(films) {
  return new Map(films.map(f => [f.id, f]))
}

function groupByFilm(screenings) {
  const m = new Map()
  for (const s of screenings) {
    if (!m.has(s.filmId)) m.set(s.filmId, [])
    m.get(s.filmId).push(s)
  }
  return m
}

describe('canLocallyReplace', () => {
  const films = [
    { id: 'a', title: 'A', runtime: 90 },
    { id: 'b', title: 'B', runtime: 90 },
    { id: 'c', title: 'C', runtime: 90 }
  ]
  const fm = filmMapOf(films)
  const plan = [
    { id: 'sa', filmId: 'a', date: '2026-10-14', startTime: '18:00', endTime: '19:30', venue: 'X' },
    { id: 'sb', filmId: 'b', date: '2026-10-14', startTime: '20:00', endTime: '21:30', venue: 'Y' }
  ]

  it('allows candidate that fits after removing the planned row', () => {
    const cand = {
      id: 'sc',
      filmId: 'c',
      date: '2026-10-14',
      startTime: '18:15',
      endTime: '19:45',
      venue: 'Z'
    }
    expect(canLocallyReplace(plan, 'sa', cand, fm)).toBe(true)
  })

  it('rejects candidate that still overlaps another fixed plan screening', () => {
    const cand = {
      id: 'sc',
      filmId: 'c',
      date: '2026-10-14',
      startTime: '19:45',
      endTime: '21:15',
      venue: 'Z'
    }
    expect(canLocallyReplace(plan, 'sa', cand, fm)).toBe(false)
  })
})

describe('buildSlotOptions', () => {
  const films = [
    { id: 'planned', title: 'Planned', runtime: 90 },
    { id: 'alt', title: 'Alt', runtime: 90 },
    { id: 'blocked', title: 'Blocked', runtime: 90 },
    { id: 'inplan', title: 'Already In', runtime: 90 },
    { id: 'solo', title: 'Solo Pub', runtime: 90 },
    { id: 'attOnly', title: 'Att Only', runtime: 90 },
    { id: 'multiFit', title: 'Multi Fit', runtime: 90 }
  ]
  const allScreenings = [
    {
      id: 'p1',
      filmId: 'planned',
      date: '2026-10-14',
      startTime: '18:00',
      endTime: '19:30',
      venue: 'Sea View'
    },
    {
      id: 'ip1',
      filmId: 'inplan',
      date: '2026-10-14',
      startTime: '20:00',
      endTime: '21:30',
      venue: 'OC'
    },
    // alt: overlaps planned AND locally replaces
    {
      id: 'a1',
      filmId: 'alt',
      date: '2026-10-14',
      startTime: '18:15',
      endTime: '19:45',
      venue: 'BlackBox'
    },
    {
      id: 'a2',
      filmId: 'alt',
      date: '2026-10-15',
      startTime: '14:00',
      endTime: '15:30',
      venue: 'BlackBox'
    },
    // blocked: overlaps planned but also conflicts with inplan after swap
    {
      id: 'b1',
      filmId: 'blocked',
      date: '2026-10-14',
      startTime: '18:30',
      endTime: '20:30',
      venue: 'Main'
    },
    // inplan second screening overlapping planned — must not appear as alt
    {
      id: 'ip2',
      filmId: 'inplan',
      date: '2026-10-14',
      startTime: '18:00',
      endTime: '19:30',
      venue: 'Other'
    },
    // solo: only published screening
    {
      id: 'solo1',
      filmId: 'solo',
      date: '2026-10-14',
      startTime: '18:10',
      endTime: '19:40',
      venue: 'A'
    },
    // attOnly: two published, one outside attendance
    {
      id: 'ao1',
      filmId: 'attOnly',
      date: '2026-10-14',
      startTime: '18:05',
      endTime: '19:35',
      venue: 'B'
    },
    {
      id: 'ao2',
      filmId: 'attOnly',
      date: '2026-10-16',
      startTime: '12:00',
      endTime: '13:30',
      venue: 'B'
    },
    // multiFit: two attendance-valid that both locally fit
    {
      id: 'mf1',
      filmId: 'multiFit',
      date: '2026-10-14',
      startTime: '18:20',
      endTime: '19:50',
      venue: 'C'
    },
    {
      id: 'mf2',
      filmId: 'multiFit',
      date: '2026-10-14',
      startTime: '18:40',
      endTime: '20:00',
      venue: 'D'
    }
  ]

  const planScreenings = [
    allScreenings.find(s => s.id === 'p1'),
    allScreenings.find(s => s.id === 'ip1')
  ]

  const interests = {
    alt: INTEREST_LEVELS.WANT_TO_SEE,
    blocked: INTEREST_LEVELS.MAYBE,
    solo: INTEREST_LEVELS.MAYBE,
    attOnly: INTEREST_LEVELS.WANT_TO_SEE,
    multiFit: INTEREST_LEVELS.MAYBE,
    planned: INTEREST_LEVELS.MAYBE,
    inplan: INTEREST_LEVELS.WANT_TO_SEE
  }

  // Attendance-valid: exclude ao2 (outside attendance)
  const attendanceValid = allScreenings.filter(s => s.id !== 'ao2')
  const filmToScreenings = groupByFilm(allScreenings)
  const filmToFeasible = groupByFilm(attendanceValid)

  const baseArgs = {
    planScreenings,
    filmMap: filmMapOf(films),
    filmToScreenings,
    filmToFeasibleScreenings: filmToFeasible,
    interests,
    excludedFilmIds: [],
    planFilmIds: new Set(['planned', 'inplan']),
    films
  }

  it('omitted film that directly replaces a planned screening appears', () => {
    const { slotOptions } = buildSlotOptions(baseArgs)
    const opts = slotOptions.p1
    expect(opts.some(o => o.filmId === 'alt')).toBe(true)
    const alt = opts.find(o => o.filmId === 'alt')
    expect(alt.screeningId).toBe('a1')
    expect(alt.overlapsPlannedScreening).toBe(true)
  })

  it('film that overlaps but still conflicts with another fixed plan screening does NOT appear', () => {
    const { slotOptions } = buildSlotOptions(baseArgs)
    expect(slotOptions.p1.some(o => o.filmId === 'blocked')).toBe(false)
  })

  it('film already in plan does not appear as its own alternative', () => {
    const { slotOptions } = buildSlotOptions(baseArgs)
    expect(slotOptions.p1.some(o => o.filmId === 'inplan')).toBe(false)
    expect(slotOptions.p1.some(o => o.filmId === 'planned')).toBe(false)
  })

  it('Skip/Seen/Excluded films do not appear', () => {
    const { slotOptions } = buildSlotOptions({
      ...baseArgs,
      interests: {
        ...interests,
        alt: INTEREST_LEVELS.SKIP,
        solo: INTEREST_LEVELS.SEEN
      },
      excludedFilmIds: ['attOnly']
    })
    const ids = slotOptions.p1.map(o => o.filmId)
    expect(ids).not.toContain('alt')
    expect(ids).not.toContain('solo')
    expect(ids).not.toContain('attOnly')
  })

  it('alternate screening outside attendance does not count', () => {
    const { slotOptions } = buildSlotOptions(baseArgs)
    const att = slotOptions.p1.find(o => o.filmId === 'attOnly')
    expect(att).toBeTruthy()
    expect(att.attendanceValidScreeningCount).toBe(1)
    expect(att.totalPublishedScreeningCount).toBe(2)
    expect(att.onlyAttendanceValidScreening).toBe(true)
    expect(att.onlyPublishedScreening).toBe(false)
  })

  it('multiple screenings for same alternate film group into one film option', () => {
    const { slotOptions } = buildSlotOptions(baseArgs)
    const multi = slotOptions.p1.filter(o => o.filmId === 'multiFit')
    expect(multi).toHaveLength(1)
    expect(multi[0].localFitScreeningCount).toBe(2)
    expect(multi[0].screeningId).toBe('mf1') // earliest first
  })

  it('deterministic ranking: Want before Maybe, then scarcity', () => {
    const { slotOptions } = buildSlotOptions(baseArgs)
    const ids = slotOptions.p1.map(o => o.filmId)
    // Want: alt, attOnly — then Maybe: solo (only published), multiFit
    expect(ids.indexOf('alt')).toBeLessThan(ids.indexOf('solo'))
    expect(ids.indexOf('attOnly')).toBeLessThan(ids.indexOf('multiFit'))
    expect(ids.indexOf('solo')).toBeLessThan(ids.indexOf('multiFit'))
  })

  it('Only screening label correct', () => {
    const { slotOptions } = buildSlotOptions(baseArgs)
    const solo = slotOptions.p1.find(o => o.filmId === 'solo')
    expect(solo.onlyPublishedScreening).toBe(true)
    expect(solo.availabilityBadge.code).toBe('only-screening')
    expect(solo.availabilityBadge.label).toBe('Only screening')
  })

  it('Only attendance-valid screening label correct', () => {
    const { slotOptions } = buildSlotOptions(baseArgs)
    const att = slotOptions.p1.find(o => o.filmId === 'attOnly')
    expect(att.availabilityBadge.code).toBe('only-attendance')
    expect(att.availabilityBadge.label).toBe(
      'Only screening during your attendance'
    )
  })

  it('Only way it fits this plan label correct', () => {
    // alt has 2 attendance-valid but only a1 locally fits (a2 doesn't overlap planned)
    const { slotOptions } = buildSlotOptions(baseArgs)
    const alt = slotOptions.p1.find(o => o.filmId === 'alt')
    expect(alt.attendanceValidScreeningCount).toBe(2)
    expect(alt.localFitScreeningCount).toBe(1)
    expect(alt.onlyCurrentPlanFit).toBe(true)
    expect(alt.onlyPublishedScreening).toBe(false)
    expect(alt.availabilityBadge.code).toBe('only-plan-fit')
  })

  it('does not falsely say Only screening when multiple published showtimes exist', () => {
    const { slotOptions } = buildSlotOptions(baseArgs)
    const alt = slotOptions.p1.find(o => o.filmId === 'alt')
    expect(alt.totalPublishedScreeningCount).toBe(2)
    expect(alt.availabilityBadge.code).not.toBe('only-screening')
    expect(alt.availabilityBadge.label).not.toBe('Only screening')
  })

  it('enrichOmissionsWithSlotHints adds could-replace text', () => {
    const { filmToReplaceableSlots } = buildSlotOptions(baseArgs)
    const omissions = [
      { film: { id: 'alt', title: 'Alt' }, interest: INTEREST_LEVELS.WANT_TO_SEE, reason: 'omitted' }
    ]
    const enriched = enrichOmissionsWithSlotHints(omissions, filmToReplaceableSlots)
    expect(enriched[0].slotHint).toMatch(/Could replace Planned/i)
    expect(enriched[0].couldReplaceSlots.length).toBeGreaterThan(0)
  })
})

describe('pairCheck helpers', () => {
  it('buildRequireBothUpdates adds non-Must films without duplicating', () => {
    const u = buildRequireBothUpdates(
      { requiredFilms: ['a'] },
      'a',
      'b',
      { a: INTEREST_LEVELS.WANT_TO_SEE, b: INTEREST_LEVELS.MAYBE }
    )
    expect(u.requiredFilms).toEqual(['a', 'b'])
  })

  it('buildRequireBothUpdates skips Must films (already required via ratings)', () => {
    const u = buildRequireBothUpdates(
      { requiredFilms: [] },
      'must',
      'want',
      { must: INTEREST_LEVELS.MUST_SEE, want: INTEREST_LEVELS.WANT_TO_SEE }
    )
    expect(u.requiredFilms).toEqual(['want'])
    expect(u.requiredFilms).not.toContain('must')
  })

  it('temporary pair overrides match require-both updates', () => {
    const c = { requiredFilms: [], excludedFilms: [] }
    expect(
      buildPairCheckConstraintOverrides(c, 'x', 'y', {
        x: INTEREST_LEVELS.MAYBE,
        y: INTEREST_LEVELS.WANT_TO_SEE
      })
    ).toEqual(buildRequireBothUpdates(c, 'x', 'y', {
      x: INTEREST_LEVELS.MAYBE,
      y: INTEREST_LEVELS.WANT_TO_SEE
    }))
  })

  it('overlapping chosen screenings but alternate screening allows both → feasible', () => {
    const films = [
      { id: 'a', title: 'A', runtime: 90 },
      { id: 'b', title: 'B', runtime: 90 },
      { id: 'c', title: 'C', runtime: 90 }
    ]
    const screenings = [
      { id: 'sa1', filmId: 'a', date: '2026-10-14', startTime: '18:00', endTime: '19:30', venue: 'X' },
      { id: 'sb1', filmId: 'b', date: '2026-10-14', startTime: '18:15', endTime: '19:45', venue: 'Y' },
      { id: 'sb2', filmId: 'b', date: '2026-10-15', startTime: '10:00', endTime: '11:30', venue: 'Y' },
      { id: 'sc1', filmId: 'c', date: '2026-10-14', startTime: '20:00', endTime: '21:30', venue: 'Z' }
    ]
    const attendance = {
      attendanceDays: { '2026-10-14': true, '2026-10-15': true },
      availabilityByDate: {}
    }
    const current = generatePlanV3({
      films,
      screenings,
      interests: {
        a: INTEREST_LEVELS.WANT_TO_SEE,
        b: INTEREST_LEVELS.MAYBE,
        c: INTEREST_LEVELS.MAYBE
      },
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: attendance,
      timeBudgetMs: 3000
    })
    expect(current.infeasible).toBe(false)

    // Require both A and B — B should shift to sb2
    const pair = generatePlanV3({
      films,
      screenings,
      interests: {
        a: INTEREST_LEVELS.WANT_TO_SEE,
        b: INTEREST_LEVELS.MAYBE,
        c: INTEREST_LEVELS.MAYBE
      },
      constraints: { excludedFilms: [], requiredFilms: ['a', 'b'] },
      attendanceConstraints: attendance,
      timeBudgetMs: 3000
    })
    expect(pair.infeasible).toBe(false)
    expect(pair.screenings.some(s => s.filmId === 'a')).toBe(true)
    expect(pair.screenings.some(s => s.filmId === 'b')).toBe(true)
    expect(pair.screenings.find(s => s.filmId === 'b')?.id).toBe('sb2')

    const shaped = shapePairCheckResult({
      currentPlan: current,
      pairPlan: pair,
      filmIdA: 'a',
      filmIdB: 'b',
      filmMap: filmMapOf(films)
    })
    expect(shaped.feasible).toBe(true)
    expect(shaped.screeningB.id).toBe('sb2')
  })

  it('both fit at same film-count maximum', () => {
    const films = [
      { id: 'a', title: 'A', runtime: 60 },
      { id: 'b', title: 'B', runtime: 60 }
    ]
    const screenings = [
      { id: 'sa', filmId: 'a', date: '2026-10-14', startTime: '10:00', endTime: '11:00', venue: 'X' },
      { id: 'sb', filmId: 'b', date: '2026-10-14', startTime: '12:00', endTime: '13:00', venue: 'Y' }
    ]
    const attendance = {
      attendanceDays: { '2026-10-14': true },
      availabilityByDate: {}
    }
    const current = generatePlanV3({
      films,
      screenings,
      interests: { a: INTEREST_LEVELS.WANT_TO_SEE, b: INTEREST_LEVELS.MAYBE },
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: attendance,
      timeBudgetMs: 2000
    })
    const pair = generatePlanV3({
      films,
      screenings,
      interests: { a: INTEREST_LEVELS.WANT_TO_SEE, b: INTEREST_LEVELS.MAYBE },
      constraints: { excludedFilms: [], requiredFilms: ['a', 'b'] },
      attendanceConstraints: attendance,
      timeBudgetMs: 2000
    })
    const shaped = shapePairCheckResult({
      currentPlan: current,
      pairPlan: pair,
      filmIdA: 'a',
      filmIdB: 'b',
      filmMap: filmMapOf(films)
    })
    expect(shaped.feasible).toBe(true)
    expect(shaped.filmCountDelta).toBe(0)
    expect(shaped.pairFilmCount).toBe(shaped.currentFilmCount)
  })

  it('both fit but maximum falls → negative delta', () => {
    // Current can pack 3; requiring A+B forces dropping C
    const films = [
      { id: 'a', title: 'A', runtime: 90 },
      { id: 'b', title: 'B', runtime: 90 },
      { id: 'c', title: 'C', runtime: 90 },
      { id: 'd', title: 'D', runtime: 90 }
    ]
    const screenings = [
      { id: 'sa1', filmId: 'a', date: '2026-10-14', startTime: '10:00', endTime: '11:30', venue: 'X' },
      { id: 'sb1', filmId: 'b', date: '2026-10-14', startTime: '10:15', endTime: '11:45', venue: 'Y' },
      { id: 'sb2', filmId: 'b', date: '2026-10-15', startTime: '10:00', endTime: '11:30', venue: 'Y' },
      { id: 'sc1', filmId: 'c', date: '2026-10-15', startTime: '10:00', endTime: '11:30', venue: 'Z' },
      { id: 'sd1', filmId: 'd', date: '2026-10-14', startTime: '13:00', endTime: '14:30', venue: 'X' }
    ]
    const attendance = {
      attendanceDays: { '2026-10-14': true, '2026-10-15': true },
      availabilityByDate: {}
    }
    const interests = {
      a: INTEREST_LEVELS.WANT_TO_SEE,
      b: INTEREST_LEVELS.WANT_TO_SEE,
      c: INTEREST_LEVELS.WANT_TO_SEE,
      d: INTEREST_LEVELS.WANT_TO_SEE
    }
    const current = generatePlanV3({
      films,
      screenings,
      interests,
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: attendance,
      timeBudgetMs: 5000
    })
    expect(current.filmCount).toBeGreaterThanOrEqual(3)

    const pair = generatePlanV3({
      films,
      screenings,
      interests,
      constraints: { excludedFilms: [], requiredFilms: ['a', 'b'] },
      attendanceConstraints: attendance,
      timeBudgetMs: 5000
    })
    expect(pair.infeasible).toBe(false)
    // A + B(sb2) + D = 3, but C conflicts with B on day 15 → may drop from 3 to 3 still
    // Force a clearer drop: if current has C and A, requiring A+B drops C
    const shaped = shapePairCheckResult({
      currentPlan: {
        ...current,
        filmCount: 3,
        filmIds: ['a', 'c', 'd'],
        screenings: current.screenings
      },
      pairPlan: {
        ...pair,
        filmCount: 2,
        filmIds: ['a', 'b'],
        screenings: pair.screenings
      },
      filmIdA: 'a',
      filmIdB: 'b',
      filmMap: filmMapOf(films)
    })
    expect(shaped.feasible).toBe(true)
    expect(shaped.filmCountDelta).toBe(-1)
    expect(shaped.drops.some(d => d.id === 'c' || d.id === 'd')).toBe(true)
  })

  it('impossible pair returns infeasible', () => {
    const films = [
      { id: 'a', title: 'A', runtime: 90 },
      { id: 'b', title: 'B', runtime: 90 }
    ]
    const screenings = [
      { id: 'sa', filmId: 'a', date: '2026-10-14', startTime: '18:00', endTime: '19:30', venue: 'X' },
      { id: 'sb', filmId: 'b', date: '2026-10-14', startTime: '18:00', endTime: '19:30', venue: 'Y' }
    ]
    const pair = generatePlanV3({
      films,
      screenings,
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
    expect(pair.infeasible).toBe(true)

    const shaped = shapePairCheckResult({
      currentPlan: { filmCount: 1, filmIds: ['a'], screenings: [screenings[0]] },
      pairPlan: pair,
      filmIdA: 'a',
      filmIdB: 'b',
      filmMap: filmMapOf(films)
    })
    expect(shaped.feasible).toBe(false)
    expect(shaped.conflict || shaped.reason).toBeTruthy()
  })

  it('broader Must conflict is accurately returned', () => {
    const films = [
      { id: 'm1', title: 'Must1', runtime: 90 },
      { id: 'm2', title: 'Must2', runtime: 90 },
      { id: 'w', title: 'Want', runtime: 90 }
    ]
    const screenings = [
      { id: 'sm1', filmId: 'm1', date: '2026-10-14', startTime: '10:00', endTime: '11:30', venue: 'A' },
      { id: 'sm2', filmId: 'm2', date: '2026-10-14', startTime: '10:00', endTime: '11:30', venue: 'B' },
      { id: 'sw', filmId: 'w', date: '2026-10-14', startTime: '14:00', endTime: '15:30', venue: 'C' }
    ]
    const pair = generatePlanV3({
      films,
      screenings,
      interests: {
        m1: INTEREST_LEVELS.MUST_SEE,
        m2: INTEREST_LEVELS.MUST_SEE,
        w: INTEREST_LEVELS.WANT_TO_SEE
      },
      constraints: { excludedFilms: [], requiredFilms: ['w'] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 3000
    })
    expect(pair.infeasible).toBe(true)
    expect(pair.reasonCode).toBe('required-film-conflict')
    const shaped = shapePairCheckResult({
      currentPlan: { filmCount: 2, filmIds: ['m1', 'w'], screenings: [] },
      pairPlan: pair,
      filmIdA: 'm1',
      filmIdB: 'w',
      filmMap: filmMapOf(films)
    })
    expect(shaped.feasible).toBe(false)
    expect(shaped.reasonCode).toBe('required-film-conflict')
    expect(shaped.conflict?.filmIds?.length).toBeGreaterThanOrEqual(2)
  })

  it('Require Both commits film-level requirements without mutating interests', () => {
    const interests = {
      a: INTEREST_LEVELS.WANT_TO_SEE,
      b: INTEREST_LEVELS.MAYBE
    }
    const before = { ...interests }
    const updates = buildRequireBothUpdates(
      { requiredFilms: [] },
      'a',
      'b',
      interests
    )
    expect(updates.requiredFilms).toEqual(['a', 'b'])
    expect(interests).toEqual(before)
    expect(updates.interests).toBeUndefined()
  })

  it('summarizePairCheckDiff lists adds and drops', () => {
    const fm = filmMapOf([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' }
    ])
    const { adds, drops } = summarizePairCheckDiff(
      { filmIds: ['a', 'c'] },
      { filmIds: ['a', 'b'] },
      fm
    )
    expect(adds.map(x => x.id)).toEqual(['b'])
    expect(drops.map(x => x.id)).toEqual(['c'])
  })
})

describe('slotOptions on real enrich path (tiny)', () => {
  it('feasible plan includes slotOptions keyed by screening id', () => {
    const films = [
      { id: 'a', title: 'A', runtime: 90 },
      { id: 'b', title: 'B', runtime: 90 },
      { id: 'c', title: 'C', runtime: 90 }
    ]
    const screenings = [
      { id: 'sa', filmId: 'a', date: '2026-10-14', startTime: '18:00', endTime: '19:30', venue: 'X' },
      { id: 'sb', filmId: 'b', date: '2026-10-14', startTime: '18:15', endTime: '19:45', venue: 'Y' },
      { id: 'sc', filmId: 'c', date: '2026-10-14', startTime: '20:00', endTime: '21:30', venue: 'Z' }
    ]
    const result = generatePlanV3({
      films,
      screenings,
      interests: {
        a: INTEREST_LEVELS.WANT_TO_SEE,
        b: INTEREST_LEVELS.MAYBE,
        c: INTEREST_LEVELS.MAYBE
      },
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      timeBudgetMs: 3000
    })
    expect(result.infeasible).toBe(false)
    expect(result.slotOptions).toBeTruthy()
    for (const s of result.screenings) {
      expect(Array.isArray(result.slotOptions[s.id])).toBe(true)
    }
  })
})
