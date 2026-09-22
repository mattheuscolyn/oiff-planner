import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { OBJECTIVES } from '../planner/scoring'
import { getFestivalDates, getDefaultAvailability } from '../utils/ferryData'

const PlannerContext = createContext(null)

const STORAGE_KEY = 'oiff-planner-state'
const STATE_VERSION = '2' // Increment when state schema changes

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
  // New: Attendance constraints
  attendance: {
    attendanceDays: getDefaultAttendanceDays(),
    availabilityByDate: getDefaultAvailabilityByDate(),
    arrivalTravel: {
      type: 'already-on-island', // 'already-on-island' | 'ferry' | 'custom'
      ferryId: null,
      isVehicle: false,
      customTime: null
    },
    departureTravel: {
      type: 'staying-on-island', // 'staying-on-island' | 'ferry' | 'custom'
      ferryId: null,
      isVehicle: false,
      customTime: null
    }
  },
  // New: Hard decisions from conflict resolution
  hardDecisions: {}, // { decisionKey: { chosen: filmId, excluded: [filmIds] } }
  generatedPlan: null,
  // New: Current step in the wizard
  currentStep: 'attendance' // 'attendance' | 'decisions' | 'plan'
}

export function PlannerProvider({ children }) {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        // Check version and migrate/reset if needed
        if (parsed.version !== STATE_VERSION) {
          console.log('Planner state version mismatch, resetting to defaults')
          return DEFAULT_STATE
        }
        return { ...DEFAULT_STATE, ...parsed }
      }
      return DEFAULT_STATE
    } catch {
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

  const updateAttendance = useCallback((updates) => {
    setState(prev => ({
      ...prev,
      attendance: { ...prev.attendance, ...updates }
    }))
  }, [])

  const updateHardDecisions = useCallback((updates) => {
    setState(prev => ({
      ...prev,
      hardDecisions: { ...prev.hardDecisions, ...updates }
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

  const value = {
    ...state,
    setObjective,
    updateConstraints,
    updateAttendance,
    updateHardDecisions,
    setGeneratedPlan,
    setCurrentStep,
    resetPlanner
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
