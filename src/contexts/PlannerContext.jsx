import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { OBJECTIVES } from '../planner/scoring'

const PlannerContext = createContext(null)

const STORAGE_KEY = 'oiff-planner-state'
const STATE_VERSION = '5' // PR #10: Arrival/departure model replaces per-day attendance grid

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
  // PR #10: Simplified arrival/departure model
  // Default: Full festival with no travel restrictions
  arrival: {
    date: '2026-10-13', // Tuesday (day before festival)
    type: 'already-on-island', // 'already-on-island' | 'ferry' | 'custom'
    ferryId: null,
    isVehicle: false,
    customTime: null
  },
  departure: {
    date: '2026-10-19', // Monday (day after festival)
    type: 'staying-longer', // 'staying-longer' | 'ferry' | 'custom'
    ferryId: null,
    isVehicle: false,
    customTime: null
  },
  // Removed: old attendance.attendanceDays per-day grid
  // Removed: old attendance.availabilityByDate manual per-day windows
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
          
          // Migrate from old per-day attendance to arrival/departure
          const migrated = {
            ...DEFAULT_STATE,
            version: STATE_VERSION,
            // Attempt to derive arrival/departure from old attendance if present
            arrival: parsed.attendance?.arrivalTravel 
              ? {
                  date: DEFAULT_STATE.arrival.date,
                  type: parsed.attendance.arrivalTravel.type || DEFAULT_STATE.arrival.type,
                  ferryId: parsed.attendance.arrivalTravel.ferryId || null,
                  isVehicle: parsed.attendance.arrivalTravel.isVehicle || false,
                  customTime: parsed.attendance.arrivalTravel.customTime || null
                }
              : DEFAULT_STATE.arrival,
            departure: parsed.attendance?.departureTravel
              ? {
                  date: DEFAULT_STATE.departure.date,
                  type: parsed.attendance.departureTravel.type || DEFAULT_STATE.departure.type,
                  ferryId: parsed.attendance.departureTravel.ferryId || null,
                  isVehicle: parsed.attendance.departureTravel.isVehicle || false,
                  customTime: parsed.attendance.departureTravel.customTime || null
                }
              : DEFAULT_STATE.departure,
            // Always clear generated plan on migration
            generatedPlan: null,
            constraints: {
              ...DEFAULT_STATE.constraints,
              // Preserve locks/exclusions if present
              lockedScreenings: parsed.constraints?.lockedScreenings || [],
              excludedFilms: parsed.constraints?.excludedFilms || []
            }
          }
          
          console.log('Migration v4→v5: replaced per-day attendance grid with arrival/departure')
          
          return migrated
        }
        
        // Version matches — strip any obsolete wizard fields from older clients
        const cleaned = { ...parsed }
        delete cleaned.currentStep
        delete cleaned.hardDecisions
        delete cleaned.decisions

        return { ...DEFAULT_STATE, ...cleaned, version: STATE_VERSION }
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

  const updateArrival = useCallback((updates) => {
    setState(prev => ({
      ...prev,
      arrival: { ...prev.arrival, ...updates }
    }))
  }, [])

  const updateDeparture = useCallback((updates) => {
    setState(prev => ({
      ...prev,
      departure: { ...prev.departure, ...updates }
    }))
  }, [])

  const setGeneratedPlan = useCallback((plan) => {
    setState(prev => ({ ...prev, generatedPlan: plan }))
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
    updateArrival,
    updateDeparture,
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
