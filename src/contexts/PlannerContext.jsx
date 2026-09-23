import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { OBJECTIVES } from '../planner/scoring'

const PlannerContext = createContext(null)

const STORAGE_KEY = 'oiff-planner-state'
// v6: film-level requiredFilms replaces screening-level lockedScreenings
const STATE_VERSION = '6'

const DEFAULT_STATE = {
  version: STATE_VERSION,
  objective: OBJECTIVES.MOST_FILMS,
  constraints: {
    availabilityWindows: {},
    maxFilmsPerDay: null,
    maxFilmsTotal: null,
    requiredFilms: [],
    excludedFilms: [],
    includeSkip: false,
    includeSeen: false
  },
  arrival: {
    date: '2026-10-13',
    type: 'already-on-island',
    ferryId: null,
    isVehicle: false,
    customTime: null
  },
  departure: {
    date: '2026-10-19',
    type: 'staying-longer',
    ferryId: null,
    isVehicle: false,
    customTime: null
  },
  generatedPlan: null
}

function migrateToV6(parsed) {
  console.log(`Migrating planner state from v${parsed.version || 'unknown'} to v${STATE_VERSION}`)

  const arrival =
    parsed.arrival ||
    (parsed.attendance?.arrivalTravel
      ? {
          date: DEFAULT_STATE.arrival.date,
          type: parsed.attendance.arrivalTravel.type || DEFAULT_STATE.arrival.type,
          ferryId: parsed.attendance.arrivalTravel.ferryId || null,
          isVehicle: parsed.attendance.arrivalTravel.isVehicle || false,
          customTime: parsed.attendance.arrivalTravel.customTime || null
        }
      : DEFAULT_STATE.arrival)

  const departure =
    parsed.departure ||
    (parsed.attendance?.departureTravel
      ? {
          date: DEFAULT_STATE.departure.date,
          type: parsed.attendance.departureTravel.type || DEFAULT_STATE.departure.type,
          ferryId: parsed.attendance.departureTravel.ferryId || null,
          isVehicle: parsed.attendance.departureTravel.isVehicle || false,
          customTime: parsed.attendance.departureTravel.customTime || null
        }
      : DEFAULT_STATE.departure)

  // Discard screening locks — conversion is ambiguous; film-level require is explicit
  if (parsed.constraints?.lockedScreenings?.length) {
    console.log('Migration v6: discarding obsolete lockedScreenings')
  }

  return {
    ...DEFAULT_STATE,
    version: STATE_VERSION,
    arrival,
    departure,
    generatedPlan: null,
    constraints: {
      ...DEFAULT_STATE.constraints,
      requiredFilms: parsed.constraints?.requiredFilms || [],
      excludedFilms: parsed.constraints?.excludedFilms || []
    }
  }
}

export function PlannerProvider({ children }) {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)

        if (parsed.version !== STATE_VERSION) {
          return migrateToV6(parsed)
        }

        const cleaned = { ...parsed }
        delete cleaned.currentStep
        delete cleaned.hardDecisions
        delete cleaned.decisions
        delete cleaned.constraints?.lockedScreenings

        const constraints = {
          ...DEFAULT_STATE.constraints,
          ...cleaned.constraints,
          requiredFilms: cleaned.constraints?.requiredFilms || [],
          excludedFilms: cleaned.constraints?.excludedFilms || []
        }
        delete constraints.lockedScreenings

        return {
          ...DEFAULT_STATE,
          ...cleaned,
          constraints,
          version: STATE_VERSION
        }
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
    setState(prev => ({
      ...prev,
      generatedPlan: null,
      constraints: {
        ...DEFAULT_STATE.constraints,
        requiredFilms: [],
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
