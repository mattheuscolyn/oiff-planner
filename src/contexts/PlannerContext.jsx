import { createContext, useContext, useState, useCallback } from 'react'
import { OBJECTIVES } from '../planner/scoring'

const PlannerContext = createContext(null)

export function PlannerProvider({ children }) {
  const [objective, setObjective] = useState(OBJECTIVES.BALANCED)
  const [constraints, setConstraints] = useState({
    availabilityWindows: {},
    maxFilmsPerDay: null,
    maxFilmsTotal: null,
    requiredFilms: [],
    excludedFilms: [],
    lockedScreenings: [],
    includeSkip: false,
    includeSeen: false
  })
  const [generatedPlan, setGeneratedPlan] = useState(null)
  
  const updateConstraints = useCallback((updates) => {
    setConstraints(prev => ({ ...prev, ...updates }))
  }, [])
  
  const resetPlanner = useCallback(() => {
    setObjective(OBJECTIVES.BALANCED)
    setConstraints({
      availabilityWindows: {},
      maxFilmsPerDay: null,
      maxFilmsTotal: null,
      requiredFilms: [],
      excludedFilms: [],
      lockedScreenings: [],
      includeSkip: false,
      includeSeen: false
    })
    setGeneratedPlan(null)
  }, [])
  
  const value = {
    objective,
    setObjective,
    constraints,
    updateConstraints,
    generatedPlan,
    setGeneratedPlan,
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
