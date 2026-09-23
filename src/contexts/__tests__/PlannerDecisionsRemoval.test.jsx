/**
 * Regression tests for PR #9: Decisions removal
 * 
 * These tests verify that:
 * 1. Old planner state with hardDecisions migrates correctly
 * 2. hardDecisions cannot influence optimizer after migration
 * 3. Global ratings and My Plan survive migration
 * 4. The planner UI works without Decisions step
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlannerProvider } from '../PlannerContext'
import { UserStateProvider } from '../UserStateContext'
import PlannerView from '../../components/PlannerView'

describe('Planner State Migration - Decisions Removal', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
  })

  it('1. migrates old state with hardDecisions by removing them', () => {
    // Setup: old state with hardDecisions
    const oldState = {
      version: '3',
      hardDecisions: {
        'conflict-1': {
          films: ['film-a', 'film-b'],
          selected: 'film-a',
          excluded: ['film-b']
        }
      },
      attendance: {
        attendanceDays: { '2026-10-14': true },
        availabilityByDate: {}
      },
      generatedPlan: { screenings: [] }
    }
    localStorage.setItem('oiff-planner-state', JSON.stringify(oldState))

    // Mount provider to trigger migration
    const { unmount } = render(
      <UserStateProvider>
        <PlannerProvider>
          <div>test</div>
        </PlannerProvider>
      </UserStateProvider>
    )

    // Verify migration
    const migrated = JSON.parse(localStorage.getItem('oiff-planner-state'))
    expect(migrated.version).toBe('5')
    expect(migrated.hardDecisions).toBeUndefined()
    expect(migrated.generatedPlan).toBeNull()
    expect(migrated.arrival).toBeDefined()
    expect(migrated.departure).toBeDefined()
    expect(migrated.attendance).toBeUndefined()

    unmount()
  })

  it('2. ensures hardDecisions cannot influence optimizer after migration', () => {
    const oldState = {
      version: '3',
      hardDecisions: {
        'conflict-1': {
          films: ['film-1', 'film-2'],
          excluded: ['film-2']
        }
      },
      constraints: {
        excludedFilms: [],
        lockedScreenings: []
      }
    }
    localStorage.setItem('oiff-planner-state', JSON.stringify(oldState))

    const { unmount } = render(
      <UserStateProvider>
        <PlannerProvider>
          <div>test</div>
        </PlannerProvider>
      </UserStateProvider>
    )

    const migrated = JSON.parse(localStorage.getItem('oiff-planner-state'))
    
    // hardDecisions should not exist
    expect(migrated.hardDecisions).toBeUndefined()
    
    // film-2 should NOT be in excludedFilms (decisions don't migrate to exclusions)
    expect(migrated.constraints.excludedFilms).toEqual([])

    unmount()
  })

  it('3. preserves attendance preferences during migration', () => {
    const oldState = {
      version: '3',
      hardDecisions: { 'conflict-1': { excluded: ['film-x'] } },
      attendance: {
        attendanceDays: {
          '2026-10-14': true,
          '2026-10-15': true,
          '2026-10-16': false
        },
        availabilityByDate: {
          '2026-10-14': { from: '09:00', until: '23:00' }
        },
        arrivalTravel: { type: 'ferry', ferryId: 'f123' },
        departureTravel: { type: 'staying-on-island' }
      }
    }
    localStorage.setItem('oiff-planner-state', JSON.stringify(oldState))

    const { unmount } = render(
      <UserStateProvider>
        <PlannerProvider>
          <div>test</div>
        </PlannerProvider>
      </UserStateProvider>
    )

    const migrated = JSON.parse(localStorage.getItem('oiff-planner-state'))
    
    expect(migrated.version).toBe('5')
    expect(migrated.hardDecisions).toBeUndefined()
    // v5 replaces per-day attendance with arrival/departure (travel prefs carried forward)
    expect(migrated.attendance).toBeUndefined()
    expect(migrated.arrival.type).toBe('ferry')
    expect(migrated.arrival.ferryId).toBe('f123')
    expect(migrated.departure.type).toBe('staying-on-island')

    unmount()
  })

  it('4. clears stale generated plan on migration', () => {
    const oldState = {
      version: '3',
      generatedPlan: {
        screenings: ['s1', 's2'],
        stats: { filmCount: 2 }
      },
      hardDecisions: {}
    }
    localStorage.setItem('oiff-planner-state', JSON.stringify(oldState))

    const { unmount } = render(
      <UserStateProvider>
        <PlannerProvider>
          <div>test</div>
        </PlannerProvider>
      </UserStateProvider>
    )

    const migrated = JSON.parse(localStorage.getItem('oiff-planner-state'))
    
    expect(migrated.generatedPlan).toBeNull()

    unmount()
  })

  it('5. removes invalid currentStep state on migration', () => {
    const oldState = {
      version: '3',
      currentStep: 'decisions',
      hardDecisions: {},
      generatedPlan: null
    }
    localStorage.setItem('oiff-planner-state', JSON.stringify(oldState))

    const { unmount } = render(
      <UserStateProvider>
        <PlannerProvider>
          <div>test</div>
        </PlannerProvider>
      </UserStateProvider>
    )

    const migrated = JSON.parse(localStorage.getItem('oiff-planner-state'))
    
    // currentStep should not exist in v4
    expect(migrated.currentStep).toBeUndefined()

    unmount()
  })
})

describe('Planner UI - Decisions Step Removed', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('6. AttendanceStep renders with clean state', () => {
    render(
      <UserStateProvider>
        <PlannerProvider>
          <PlannerView />
        </PlannerProvider>
      </UserStateProvider>
    )

    // Should show attendance setup
    expect(screen.queryByText(/when will you be there/i)).toBeTruthy()
  })

  it('7. no Decisions step is rendered or accessible', () => {
    render(
      <UserStateProvider>
        <PlannerProvider>
          <PlannerView />
        </PlannerProvider>
      </UserStateProvider>
    )

    // Should not find Decisions-related text
    expect(screen.queryByText(/decisions needed/i)).toBeNull()
    expect(screen.queryByText(/continue to decisions/i)).toBeNull()
    expect(screen.queryByText(/resolved from your ratings/i)).toBeNull()
  })
})

describe('Planner Constraints - Post Migration', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('8. exclusions still work after migration', () => {
    const oldState = {
      version: '3',
      hardDecisions: {},
      constraints: {
        excludedFilms: ['film-x', 'film-y'],
        lockedScreenings: []
      }
    }
    localStorage.setItem('oiff-planner-state', JSON.stringify(oldState))

    const { unmount } = render(
      <UserStateProvider>
        <PlannerProvider>
          <div>test</div>
        </PlannerProvider>
      </UserStateProvider>
    )

    const migrated = JSON.parse(localStorage.getItem('oiff-planner-state'))
    
    // Exclusions should be preserved
    expect(migrated.constraints.excludedFilms).toEqual(['film-x', 'film-y'])

    unmount()
  })

  it('9. locks still work after migration', () => {
    const oldState = {
      version: '3',
      hardDecisions: {},
      constraints: {
        excludedFilms: [],
        lockedScreenings: ['s1', 's2']
      }
    }
    localStorage.setItem('oiff-planner-state', JSON.stringify(oldState))

    const { unmount } = render(
      <UserStateProvider>
        <PlannerProvider>
          <div>test</div>
        </PlannerProvider>
      </UserStateProvider>
    )

    const migrated = JSON.parse(localStorage.getItem('oiff-planner-state'))
    
    // Locks should be preserved
    expect(migrated.constraints.lockedScreenings).toEqual(['s1', 's2'])

    unmount()
  })
})

describe('State Equivalence - Fresh vs Migrated', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('10. fresh state and migrated state produce equivalent optimizer constraints', () => {
    // Create a fresh state
    const { unmount: unmount1 } = render(
      <UserStateProvider>
        <PlannerProvider>
          <div>fresh</div>
        </PlannerProvider>
      </UserStateProvider>
    )
    const freshState = JSON.parse(localStorage.getItem('oiff-planner-state'))
    unmount1()
    localStorage.clear()

    // Create old state and migrate
    const oldState = {
      version: '3',
      hardDecisions: {
        'conflict-1': { excluded: ['film-bad'] }
      },
      attendance: freshState.attendance,
      constraints: freshState.constraints
    }
    localStorage.setItem('oiff-planner-state', JSON.stringify(oldState))

    const { unmount: unmount2 } = render(
      <UserStateProvider>
        <PlannerProvider>
          <div>migrated</div>
        </PlannerProvider>
      </UserStateProvider>
    )
    const migratedState = JSON.parse(localStorage.getItem('oiff-planner-state'))
    unmount2()

    // Both should have same constraints structure (no hardDecisions)
    expect(migratedState.hardDecisions).toBeUndefined()
    expect(freshState.hardDecisions).toBeUndefined()
    expect(migratedState.constraints).toEqual(freshState.constraints)
  })
})
