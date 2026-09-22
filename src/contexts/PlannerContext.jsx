import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { OBJECTIVES } from '../planner/scoring'
import { getFestivalDates, getDefaultAvailability } from '../utils/ferryData'

const PlannerContext = createContext(null)

const STORAGE_KEY = 'oiff-planner-state'
const STATE_VERSION = '4' // Simplified arrival/departure model, removed hardDecisions

// Initialize default attendance days (all selected)
function getDefaultAttendanceDays() {
  const days = {}
  getFestivalDates().forEach(({ date }) => {
    days[date] = true
  })
  return days
}

// Initialize default availability (all-day for each date)
function getDefaultAvailabilityByDate() {
  const availability = {}
  getFestivalDates().forEach(({ date }) => {
    availability[date] = getDefaultAvailability()
  })
  return availability
}

const DEFAULT_STATE = {
  version: STATE_VERSION,
  objective: OBJECTIVES.MOST_FILMS,
  constraints: {
    availabilityWindows: {},
    maxFilmsPerDay: null,
    maxFilmsTotal: null,
    requiredFilms: [],
    excludedFilms: [],
    lockedScreenings: [],
    includeSkip: false,
    includeSeen: false
  },
  // Simplified: Arrival and departure configuration
  arrivalDate: '2026-10-14', // Tuesday Oct 13 through Sunday Oct 18
  arrivalType: 'already-on-island', // 'already-on-island' | 'ferry' | 'custom'
  arrivalDetails: {
    ferryId: null,
    isVehicle: false,
    customTime: null
  },
  departureDate: '2026-10-18', // Wednesday Oct 14 through Monday Oct 19
  departureType: 'staying-longer', // 'staying-longer' | 'ferry' | 'custom'
  departureDetails: {
    ferryId: null,
    isVehicle: false,
    customTime: null
  },
  generatedPlan: null
}

export function PlannerProvider({ children }) {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        
        // Check version and migrate if needed
        if (parsed.version !== STATE_VERSION) {
          console.log(`Migrating planner state from v${parsed.version || 'unknown'} to v${STATE_VERSION}`)
          
          // Migrate safe fields, discard incompatible ones
          const migrated = {
            ...DEFAULT_STATE,
            version: STATE_VERSION,
            // Try to preserve arrival/departure if reasonable
            arrivalDate: parsed.arrivalDate || DEFAULT_STATE.arrivalDate,
            departureDate: parsed.departureDate || DEFAULT_STATE.departureDate,
            // Discard old hardDecisions completely
            // Discard old currentStep (no more multi-step wizard)
            // Discard stale generated plans
            generatedPlan: null,
            constraints: {
              ...DEFAULT_STATE.constraints,
              // Clear stale locks/exclusions
              lockedScreenings: [],
              excludedFilms: []
            }
          }
          
          console.log('Migration complete: removed hardDecisions, simplified to arrival/departure model')
          
          return migrated
        }
        
        // Version matches, but validate state integrity
        const validated = { ...DEFAULT_STATE, ...parsed }
        
        // Fix invalid state: plan step with no plan
        if (validated.currentStep === 'plan' && !validated.generatedPlan) {
          console.log('Recovering from invalid planner state (plan step with no generated plan)')
          validated.currentStep = 'attendance'
        }
        
        // Validate currentStep
        const validSteps = ['attendance', 'decisions', 'plan']
        if (!validSteps.includes(validated.currentStep)) {
          console.log(`Invalid currentStep "${validated.currentStep}", resetting to attendance`)
          validated.currentStep = 'attendance'
        }
        
        return validated
      }
      return DEFAULT_STATE
    } catch (error) {
      console.error('Error loading planner state:', error)
      return DEFAULT_STATE
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const setObjective = useCallback((objective) => {
    setState(prev => ({ ...prev, objective }))
  }, [])

  const updateConstraints = useCallback((updates) => {
    setState(prev => ({
      ...prev,
      constraints: { ...prev.constraints, ...updates }
    }))
  }, [])

  const setArrival = useCallback((date, type, details) => {
    setState(prev => ({
      ...prev,
      arrivalDate: date,
      arrivalType: type,
      arrivalDetails: details || prev.arrivalDetails
    }))
  }, [])

  const setDeparture = useCallback((date, type, details) => {
    setState(prev => ({
      ...prev,
      departureDate: date,
      departureType: type,
      departureDetails: details || prev.departureDetails
    }))
  }, [])

  const setGeneratedPlan = useCallback((plan) => {
    setState(prev => ({ ...prev, generatedPlan: plan }))
  }, [])

  const setCurrentStep = useCallback((step) => {
    setState(prev => ({ ...prev, currentStep: step }))
  }, [])

  const resetPlanner = useCallback(() => {
    setState(DEFAULT_STATE)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const resetPlannerSession = useCallback(() => {
    // Reset ONLY planner session state, NOT film ratings or My Plan
    setState(prev => ({
      ...prev,
      generatedPlan: null,
      currentStep: 'attendance',
      hardDecisions: {},
      constraints: {
        ...DEFAULT_STATE.constraints,
        lockedScreenings: [],
        excludedFilms: []
      }
    }))
  }, [])

  const value = {
    ...state,
    setObjective,
    updateConstraints,
    setArrival,
    setDeparture,
    setGeneratedPlan,
    resetPlanner,
    resetPlannerSession
  }

  return (
    <PlannerContext.Provider value={value}>
      {children}
    </PlannerContext.Provider>
  )
}

export function usePlanner() {
  const context = useContext(PlannerContext)
  if (!context) {
    throw new Error('usePlanner must be used within PlannerProvider')
  }
  return context
}
