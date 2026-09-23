/**
 * PR #12: Planner interaction correctness
 *
 * Ensures exclude/lock/unlock/retry all use the shared arrival→availability→V3 path,
 * ferry date changes clear stale sailings, and session reset stays clean.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { generateCurrentPlan, appendUniqueId } from '../generateCurrentPlan'
import * as optimizerV3 from '../optimizerV3'
import { films, screenings } from '../../utils/festivalData'
import { getFerries, resolveFerryIdForDateChange } from '../../utils/ferryData'
import { validatePlan } from '../../utils/planValidator'
import { PlannerProvider, usePlanner } from '../../contexts/PlannerContext'
import { UserStateProvider } from '../../contexts/UserStateContext'
import {
  setFilmInterest,
  setSelectedScreenings,
  getFilmInterests,
  getSelectedScreenings
} from '../../utils/userState'

const DEFAULT_ARRIVAL = {
  date: '2026-10-13',
  type: 'already-on-island',
  ferryId: null,
  isVehicle: false,
  customTime: null
}

const DEFAULT_DEPARTURE = {
  date: '2026-10-19',
  type: 'staying-longer',
  ferryId: null,
  isVehicle: false,
  customTime: null
}

const EMPTY_CONSTRAINTS = {
  excludedFilms: [],
  lockedScreenings: [],
  includeSkip: false,
  includeSeen: false
}

function wrapper({ children }) {
  return (
    <UserStateProvider>
      <PlannerProvider>{children}</PlannerProvider>
    </UserStateProvider>
  )
}

describe('generateCurrentPlan shared path', () => {
  it('initial generation uses derived arrival/departure availability', () => {
    const spy = vi.spyOn(optimizerV3, 'generatePlanV3')

    generateCurrentPlan({
      films,
      screenings,
      interests: {},
      constraints: EMPTY_CONSTRAINTS,
      arrival: DEFAULT_ARRIVAL,
      departure: DEFAULT_DEPARTURE
    })

    expect(spy).toHaveBeenCalledTimes(1)
    const arg = spy.mock.calls[0][0]
    expect(arg.attendanceConstraints.attendanceDays['2026-10-14']).toBe(true)
    expect(arg.attendanceConstraints.attendanceDays['2026-10-18']).toBe(true)
    expect(Object.keys(arg.attendanceConstraints.availabilityByDate)).toHaveLength(0)
    expect(arg.attendanceConstraints.attendanceDays).toBeDefined()
    expect(arg.attendanceConstraints.availabilityByDate).toBeDefined()

    spy.mockRestore()
  })

  it('does not leave attendanceDays/availabilityByDate undefined', () => {
    const spy = vi.spyOn(optimizerV3, 'generatePlanV3')

    generateCurrentPlan({
      films,
      screenings,
      interests: {},
      constraints: EMPTY_CONSTRAINTS,
      arrival: DEFAULT_ARRIVAL,
      departure: DEFAULT_DEPARTURE,
      constraintOverrides: { excludedFilms: ['x'] }
    })

    const { attendanceDays, availabilityByDate } = spy.mock.calls[0][0].attendanceConstraints
    expect(attendanceDays).not.toBeUndefined()
    expect(availabilityByDate).not.toBeUndefined()
    expect(typeof attendanceDays).toBe('object')
    expect(typeof availabilityByDate).toBe('object')

    spy.mockRestore()
  })

  it('Exclude recomputes successfully and excluded film is absent', () => {
    const base = generateCurrentPlan({
      films,
      screenings,
      interests: {},
      constraints: EMPTY_CONSTRAINTS,
      arrival: DEFAULT_ARRIVAL,
      departure: DEFAULT_DEPARTURE,
      timeBudgetMs: 15000
    })

    expect(base.screenings.length).toBeGreaterThan(0)
    const filmId = base.screenings[0].filmId
    const newExcluded = appendUniqueId([], filmId)

    const regenerated = generateCurrentPlan({
      films,
      screenings,
      interests: {},
      constraints: EMPTY_CONSTRAINTS,
      arrival: DEFAULT_ARRIVAL,
      departure: DEFAULT_DEPARTURE,
      constraintOverrides: { excludedFilms: newExcluded },
      timeBudgetMs: 15000
    })

    expect(regenerated.infeasible).toBe(false)
    expect(regenerated.screenings.some(s => s.filmId === filmId)).toBe(false)
  }, 60000)

  it('Lock recomputes successfully and locked screening remains present', () => {
    const base = generateCurrentPlan({
      films,
      screenings,
      interests: {},
      constraints: EMPTY_CONSTRAINTS,
      arrival: DEFAULT_ARRIVAL,
      departure: DEFAULT_DEPARTURE,
      timeBudgetMs: 15000
    })

    const screeningId = base.screenings[0].id
    const newLocked = appendUniqueId([], screeningId)

    const regenerated = generateCurrentPlan({
      films,
      screenings,
      interests: {},
      constraints: EMPTY_CONSTRAINTS,
      arrival: DEFAULT_ARRIVAL,
      departure: DEFAULT_DEPARTURE,
      constraintOverrides: { lockedScreenings: newLocked },
      timeBudgetMs: 15000
    })

    expect(regenerated.infeasible).toBe(false)
    expect(regenerated.screenings.some(s => s.id === screeningId)).toBe(true)

    // Locked itinerary must be independently conflict-free
    const validation = validatePlan(regenerated, films, screenings)
    expect(validation.valid, validation.errors.join('\n')).toBe(true)
  }, 60000)

  it('Unlock regenerates only once with the lock removed', () => {
    const screeningId = 'screening-to-unlock'
    const spy = vi.spyOn(optimizerV3, 'generatePlanV3').mockReturnValue({
      screenings: [],
      filmCount: 0,
      infeasible: false,
      metadata: {}
    })

    const unlocked = [screeningId].filter(id => id !== screeningId)
    generateCurrentPlan({
      films,
      screenings,
      interests: {},
      constraints: { ...EMPTY_CONSTRAINTS, lockedScreenings: [screeningId] },
      arrival: DEFAULT_ARRIVAL,
      departure: DEFAULT_DEPARTURE,
      constraintOverrides: { lockedScreenings: unlocked }
    })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0].constraints.lockedScreenings).toEqual([])
    expect(spy.mock.calls[0][0].constraints.lockedScreenings).not.toContain(screeningId)

    spy.mockRestore()
  })

  it('appendUniqueId prevents duplicate film/lock IDs', () => {
    expect(appendUniqueId(['a'], 'a')).toEqual(['a'])
    expect(appendUniqueId(['a'], 'b')).toEqual(['a', 'b'])
  })
})

describe('Ferry date change validation', () => {
  const ferries = getFerries()

  it('arrival date change clears invalid ferry', () => {
    // Sunday-only Anacortes→Orcas sailing
    const sundayOnly = 'ana-orc-0530'
    expect(
      resolveFerryIdForDateChange(sundayOnly, '2026-10-18', 'anacortes-orcas', ferries)
    ).toBe(sundayOnly)
    expect(
      resolveFerryIdForDateChange(sundayOnly, '2026-10-14', 'anacortes-orcas', ferries)
    ).toBeNull()
  })

  it('departure date change clears invalid ferry', () => {
    // Wrong-direction sailing is invalid for departure validation
    expect(
      resolveFerryIdForDateChange('ana-orc-0545', '2026-10-18', 'orcas-anacortes', ferries)
    ).toBeNull()

    // Unknown sailing ID must clear
    expect(
      resolveFerryIdForDateChange('not-a-real-ferry', '2026-10-18', 'orcas-anacortes', ferries)
    ).toBeNull()

    // Valid departure sailing remains on date change when still applicable
    expect(
      resolveFerryIdForDateChange('orc-ana-0650', '2026-10-18', 'orcas-anacortes', ferries)
    ).toBe('orc-ana-0650')
  })

  it('compatible recurring ferry may remain selected', () => {
    // Mon–Sat Anacortes→Orcas sailing valid on both Wed and Thu
    const recurring = 'ana-orc-0545'
    expect(
      resolveFerryIdForDateChange(recurring, '2026-10-14', 'anacortes-orcas', ferries)
    ).toBe(recurring)
    expect(
      resolveFerryIdForDateChange(recurring, '2026-10-15', 'anacortes-orcas', ferries)
    ).toBe(recurring)
  })
})

describe('resetPlannerSession cleanliness', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('session reset does not add obsolete state', () => {
    const { result } = renderHook(() => usePlanner(), { wrapper })

    act(() => {
      result.current.updateConstraints({
        excludedFilms: ['film-a'],
        lockedScreenings: ['s1']
      })
      result.current.setGeneratedPlan({ screenings: [], filmCount: 0 })
      result.current.resetPlannerSession()
    })

    const saved = JSON.parse(localStorage.getItem('oiff-planner-state'))
    expect(saved.generatedPlan).toBeNull()
    expect(saved.constraints.excludedFilms).toEqual([])
    expect(saved.constraints.lockedScreenings).toEqual([])
    expect(saved.currentStep).toBeUndefined()
    expect(saved.hardDecisions).toBeUndefined()
    expect(saved.decisions).toBeUndefined()
  })

  it('session reset preserves ratings', () => {
    setFilmInterest('film-rated', 'must-see')
    expect(getFilmInterests()['film-rated']).toBe('must-see')

    const { result } = renderHook(() => usePlanner(), { wrapper })
    act(() => {
      result.current.resetPlannerSession()
    })

    expect(getFilmInterests()['film-rated']).toBe('must-see')
  })

  it('session reset preserves My Plan', () => {
    // Establish user-state version so plan writes are not wiped by migration
    getFilmInterests()
    setSelectedScreenings(['screening-a', 'screening-b'])
    expect(getSelectedScreenings()).toEqual(['screening-a', 'screening-b'])

    const { result } = renderHook(() => usePlanner(), { wrapper })
    act(() => {
      result.current.resetPlannerSession()
    })

    expect(getSelectedScreenings()).toEqual(['screening-a', 'screening-b'])
  })

  it('hydration strips obsolete currentStep without rewriting version', () => {
    localStorage.setItem(
      'oiff-planner-state',
      JSON.stringify({
        version: '5',
        currentStep: 'plan',
        hardDecisions: { x: 1 },
        decisions: {},
        generatedPlan: { screenings: [] },
        arrival: DEFAULT_ARRIVAL,
        departure: DEFAULT_DEPARTURE,
        constraints: EMPTY_CONSTRAINTS
      })
    )

    const { result } = renderHook(() => usePlanner(), { wrapper })
    expect(result.current.generatedPlan).toEqual({ screenings: [] })
    expect(result.current.currentStep).toBeUndefined()
    expect(result.current.hardDecisions).toBeUndefined()

    const saved = JSON.parse(localStorage.getItem('oiff-planner-state'))
    expect(saved.version).toBe('5')
    expect(saved.currentStep).toBeUndefined()
    expect(saved.hardDecisions).toBeUndefined()
  })
})

describe('Benchmark regressions (shared path + direct V3)', () => {
  it('24-film unrestricted benchmark still passes via generateCurrentPlan', { timeout: 60000 }, () => {
    const result = generateCurrentPlan({
      films,
      screenings,
      interests: {},
      constraints: EMPTY_CONSTRAINTS,
      arrival: DEFAULT_ARRIVAL,
      departure: DEFAULT_DEPARTURE,
      timeBudgetMs: 30000
    })

    expect(result.filmCount).toBe(24)
  })

  it('23-film restricted 09:00–23:00 benchmark still passes via generatePlanV3', { timeout: 60000 }, () => {
    // Restricted windows are not expressible via arrival/departure alone;
    // call V3 directly to preserve the exact benchmark constraint surface.
    const result = optimizerV3.generatePlanV3({
      films,
      screenings,
      interests: {},
      constraints: EMPTY_CONSTRAINTS,
      attendanceConstraints: {
        attendanceDays: {
          '2026-10-14': true,
          '2026-10-15': true,
          '2026-10-16': true,
          '2026-10-17': true,
          '2026-10-18': true
        },
        availabilityByDate: {
          '2026-10-14': { from: '09:00', until: '23:00' },
          '2026-10-15': { from: '09:00', until: '23:00' },
          '2026-10-16': { from: '09:00', until: '23:00' },
          '2026-10-17': { from: '09:00', until: '23:00' },
          '2026-10-18': { from: '09:00', until: '23:00' }
        }
      },
      timeBudgetMs: 30000
    })

    expect(result.filmCount).toBe(23)
  })
})
