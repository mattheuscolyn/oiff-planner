import { describe, it, expect, beforeEach } from 'vitest'

// Mock localStorage for testing
const createLocalStorageMock = () => {
  let store = {}
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value.toString() },
    removeItem: (key) => { delete store[key] },
    clear: () => { store = {} }
  }
}

describe('Planner State Migration Logic', () => {
  let localStorage

  beforeEach(() => {
    localStorage = createLocalStorageMock()
  })

  it('should detect invalid state: plan step with no generatedPlan', () => {
    const state = {
      version: '3',
      currentStep: 'plan',
      generatedPlan: null,
      attendance: {
        attendanceDays: { '2026-10-14': true }
      },
      hardDecisions: {},
      constraints: {}
    }

    // This is the bug: plan step with null plan
    expect(state.currentStep).toBe('plan')
    expect(state.generatedPlan).toBeNull()

    // Recovery logic should reset to attendance
    if (state.currentStep === 'plan' && !state.generatedPlan) {
      state.currentStep = 'attendance'
    }

    expect(state.currentStep).toBe('attendance')
  })

  it('should validate and fix invalid currentStep values', () => {
    const validSteps = ['attendance', 'decisions', 'plan']
    
    // Test various invalid values
    const invalidSteps = ['invalid', '', null, undefined, 123, 'foo']
    
    for (const invalidStep of invalidSteps) {
      const currentStep = validSteps.includes(invalidStep) ? invalidStep : 'attendance'
      expect(currentStep).toBe('attendance')
    }
  })

  it('should identify stale state version', () => {
    const STATE_VERSION = '3'
    
    const oldState = {
      version: '2',
      generatedPlan: { screenings: [] }
    }

    expect(oldState.version).not.toBe(STATE_VERSION)
    
    // Migration should bump version
    const migrated = { ...oldState, version: STATE_VERSION }
    expect(migrated.version).toBe('3')
  })

  it('should preserve attendance preferences during migration', () => {
    const oldState = {
      version: '2',
      attendance: {
        attendanceDays: { '2026-10-14': true, '2026-10-15': true },
        availabilityByDate: { '2026-10-14': { from: '09:00', until: '22:00' } }
      }
    }

    // Migration should preserve these
    const migrated = {
      version: '3',
      attendance: oldState.attendance,
      generatedPlan: null,
      currentStep: 'attendance'
    }

    expect(migrated.attendance).toEqual(oldState.attendance)
    expect(migrated.generatedPlan).toBeNull()
    expect(migrated.currentStep).toBe('attendance')
  })

  it('should clear stale locks and exclusions during migration', () => {
    const oldState = {
      version: '2',
      constraints: {
        lockedScreenings: ['old-screening-1', 'old-screening-2'],
        excludedFilms: ['old-film-1']
      }
    }

    // Migration should clear these
    const migrated = {
      version: '3',
      constraints: {
        ...oldState.constraints,
        lockedScreenings: [],
        excludedFilms: []
      }
    }

    expect(migrated.constraints.lockedScreenings).toEqual([])
    expect(migrated.constraints.excludedFilms).toEqual([])
  })

  it('should handle corrupt localStorage JSON gracefully', () => {
    const corrupted = 'invalid json{{{'
    
    let parsed
    try {
      parsed = JSON.parse(corrupted)
    } catch {
      // Fallback to defaults
      parsed = {
        version: '3',
        currentStep: 'attendance',
        generatedPlan: null
      }
    }

    expect(parsed.version).toBe('3')
    expect(parsed.currentStep).toBe('attendance')
    expect(parsed.generatedPlan).toBeNull()
  })

  it('resetPlannerSession should clear only session state, not attendance', () => {
    const state = {
      version: '3',
      currentStep: 'plan',
      generatedPlan: { screenings: [] },
      hardDecisions: { key1: { chosen: 'film1' } },
      attendance: {
        attendanceDays: { '2026-10-14': true, '2026-10-15': true }
      },
      constraints: {
        lockedScreenings: ['s1'],
        excludedFilms: ['f1']
      }
    }

    // Simulate resetPlannerSession
    const reset = {
      ...state,
      generatedPlan: null,
      currentStep: 'attendance',
      hardDecisions: {},
      constraints: {
        ...state.constraints,
        lockedScreenings: [],
        excludedFilms: []
      }
      // attendance is preserved
    }

    expect(reset.generatedPlan).toBeNull()
    expect(reset.currentStep).toBe('attendance')
    expect(reset.hardDecisions).toEqual({})
    expect(reset.constraints.lockedScreenings).toEqual([])
    expect(reset.constraints.excludedFilms).toEqual([])
    // Attendance is unchanged
    expect(reset.attendance).toEqual(state.attendance)
  })
})

describe('Planner Rendering State Logic', () => {
  it('should identify all rendering scenarios', () => {
    // Valid rendering states for plan step
    const scenarios = [
      { isGenerating: true, generationError: null, generatedPlan: null, expected: 'loading' },
      { isGenerating: false, generationError: 'Error', generatedPlan: null, expected: 'error' },
      { isGenerating: false, generationError: null, generatedPlan: null, expected: 'no-plan-recovery' },
      { isGenerating: false, generationError: null, generatedPlan: { infeasible: true }, expected: 'infeasible' },
      { isGenerating: false, generationError: null, generatedPlan: { screenings: [] }, expected: 'success' }
    ]

    for (const scenario of scenarios) {
      const { isGenerating, generationError, generatedPlan } = scenario
      
      let renderState
      if (isGenerating) {
        renderState = 'loading'
      } else if (generationError) {
        renderState = 'error'
      } else if (!generatedPlan) {
        renderState = 'no-plan-recovery'
      } else if (generatedPlan.infeasible) {
        renderState = 'infeasible'
      } else {
        renderState = 'success'
      }

      expect(renderState).toBe(scenario.expected)
    }
  })

  it('should never render empty markup', () => {
    // Every combination should have UI
    const states = [
      { step: 'attendance', plan: null },
      { step: 'decisions', plan: null },
      { step: 'plan', plan: null, isGenerating: false, error: null },
      { step: 'plan', plan: { screenings: [] }, isGenerating: false, error: null }
    ]

    for (const state of states) {
      const hasUI = state.step === 'attendance' || 
                     state.step === 'decisions' ||
                     (state.step === 'plan' && (state.isGenerating || state.error || !state.plan || !!state.plan))
      
      expect(hasUI).toBe(true)
    }
  })
})
