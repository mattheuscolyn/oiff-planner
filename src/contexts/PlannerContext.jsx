import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { OBJECTIVES } from '../planner/scoring'
import { getFestivalDates, getDefaultAvailability } from '../utils/ferryData'

const PlannerContext = createContext(null)

const STORAGE_KEY = 'oiff-planner-state'
const STATE_VERSION = '3' // Incremented for optimizer V2 changes (PR #6)

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
        
        // Check version and migrate if needed
        if (parsed.version !== STATE_VERSION) {
          console.log(`Migrating planner state from v${parsed.version || 'unknown'} to v${STATE_VERSION}`)
          
          // Migrate safe fields, reset incompatible ones
          const migrated = {
            ...DEFAULT_STATE,
            version: STATE_VERSION,
            // Preserve attendance preferences if valid
            attendance: parsed.attendance?.attendanceDays 
              ? {
                  ...DEFAULT_STATE.attendance,
                  attendanceDays: parsed.attendance.attendanceDays,
                  availabilityByDate: parsed.attendance.availabilityByDate || DEFAULT_STATE.attendance.availabilityByDate,
                  arrivalTravel: parsed.attendance.arrivalTravel || DEFAULT_STATE.attendance.arrivalTravel,
                  departureTravel: parsed.attendance.departureTravel || DEFAULT_STATE.attendance.departureTravel
                }
              : DEFAULT_STATE.attendance,
            // Reset planner session state (incompatible with new optimizer)
            generatedPlan: null,
            currentStep: 'attendance', // Always start fresh after migration
            hardDecisions: {},
            constraints: {
              ...DEFAULT_STATE.constraints,
              // Clear stale locks/exclusions (may reference invalid IDs)
              lockedScreenings: [],
              excludedFilms: []
            }
          }
          
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
    updateAttendance,
    updateHardDecisions,
    setGeneratedPlan,
    setCurrentStep,
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
