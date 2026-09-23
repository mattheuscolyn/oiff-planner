/**
 * Shared generation path + session reset (post film-level require migration)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { generateCurrentPlan, applyExcludeFilm } from '../generateCurrentPlan'
import { films, screenings } from '../../utils/festivalData'
import { PlannerProvider, usePlanner } from '../../contexts/PlannerContext'
import { UserStateProvider } from '../../contexts/UserStateContext'
import {
  setFilmInterest,
  setSelectedScreenings,
  getFilmInterests,
  getSelectedScreenings
} from '../../utils/userState'
import { INTEREST_LEVELS } from '../../utils/userState'
import { validatePlan } from '../../utils/planValidator'

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
  requiredFilms: [],
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
  it('initial generation uses derived attendance and returns coverage', () => {
    const plan = generateCurrentPlan({
      films,
      screenings,
      interests: {},
      constraints: EMPTY_CONSTRAINTS,
      arrival: DEFAULT_ARRIVAL,
      departure: DEFAULT_DEPARTURE,
      timeBudgetMs: 20000
    })

    expect(plan.infeasible).toBe(false)
    expect(plan.filmCount).toBeGreaterThan(0)
    expect(plan.coverage).toBeTruthy()
    expect(plan.metadata.status).toMatch(/maximum-proven|best-found/)
    expect(validatePlan(plan, films, screenings).valid).toBe(true)
  }, 60000)

  it('Exclude removes film and clears manual require', () => {
    const base = generateCurrentPlan({
      films,
      screenings,
      interests: {},
      constraints: EMPTY_CONSTRAINTS,
      arrival: DEFAULT_ARRIVAL,
      departure: DEFAULT_DEPARTURE,
      timeBudgetMs: 15000
    })
    const filmId = base.screenings[0].filmId
    const updates = applyExcludeFilm(
      { ...EMPTY_CONSTRAINTS, requiredFilms: [filmId] },
      filmId
    )
    expect(updates.requiredFilms).not.toContain(filmId)

    const regenerated = generateCurrentPlan({
      films,
      screenings,
      interests: {},
      constraints: EMPTY_CONSTRAINTS,
      arrival: DEFAULT_ARRIVAL,
      departure: DEFAULT_DEPARTURE,
      constraintOverrides: updates,
      timeBudgetMs: 15000
    })

    expect(regenerated.screenings.some(s => s.filmId === filmId)).toBe(false)
  }, 60000)

  it('manual Require forces Want film into the plan', () => {
    const wantId = films[0].id
    const plan = generateCurrentPlan({
      films,
      screenings,
      interests: { [wantId]: INTEREST_LEVELS.WANT_TO_SEE },
      constraints: { ...EMPTY_CONSTRAINTS, requiredFilms: [wantId] },
      arrival: DEFAULT_ARRIVAL,
      departure: DEFAULT_DEPARTURE,
      timeBudgetMs: 20000
    })

    if (!plan.infeasible) {
      expect(plan.screenings.some(s => s.filmId === wantId)).toBe(true)
      expect(plan.requiredFilmIds).toContain(wantId)
    }
  }, 60000)
})

describe('resetPlannerSession v6', () => {
  beforeEach(() => localStorage.clear())

  it('session reset clears required/excluded without obsolete locks', () => {
    const { result } = renderHook(() => usePlanner(), { wrapper })
    act(() => {
      result.current.updateConstraints({
        requiredFilms: ['f1'],
        excludedFilms: ['f2']
      })
      result.current.setGeneratedPlan({ screenings: [], filmCount: 0 })
      result.current.resetPlannerSession()
    })

    const saved = JSON.parse(localStorage.getItem('oiff-planner-state'))
    expect(saved.version).toBe('6')
    expect(saved.constraints.requiredFilms).toEqual([])
    expect(saved.constraints.excludedFilms).toEqual([])
    expect(saved.constraints.lockedScreenings).toBeUndefined()
    expect(saved.generatedPlan).toBeNull()
  })

  it('preserves ratings and My Plan', () => {
    getFilmInterests()
    setFilmInterest('film-rated', 'must-see')
    setSelectedScreenings(['s-a'])
    const { result } = renderHook(() => usePlanner(), { wrapper })
    act(() => result.current.resetPlannerSession())
    expect(getFilmInterests()['film-rated']).toBe('must-see')
    expect(getSelectedScreenings()).toEqual(['s-a'])
  })
})

describe('Benchmark regressions', () => {
  it('24-film unrestricted via generateCurrentPlan', { timeout: 90000 }, () => {
    const result = generateCurrentPlan({
      films,
      screenings,
      interests: {},
      constraints: EMPTY_CONSTRAINTS,
      arrival: DEFAULT_ARRIVAL,
      departure: DEFAULT_DEPARTURE,
      timeBudgetMs: 60000
    })
    expect(result.filmCount).toBe(24)
  })
})
