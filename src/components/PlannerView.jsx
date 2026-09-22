import { useState } from 'react'
import { films, screenings } from '../utils/festivalData'
import { useUserState } from '../contexts/UserStateContext'
import { usePlanner } from '../contexts/PlannerContext'
import { generatePlanV3 } from '../planner/optimizerV3'
import { setSelectedScreenings } from '../utils/userState'
import { deriveFestivalAvailability } from '../utils/festivalAvailability'
import { getFerries } from '../utils/ferryData'
import AttendanceStep from './AttendanceStep'
import ErrorBoundary from './ErrorBoundary'
import './PlannerView.css'

function PlannerViewInner() {
  const { interests } = useUserState()
  const { 
    constraints, 
    arrival,
    departure,
    generatedPlan, 
    setGeneratedPlan,
    updateConstraints
  } = usePlanner()
  
  // Simple state: are we showing setup or results?
  const [showingResults, setShowingResults] = useState(false)
  
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [generationError, setGenerationError] = useState(null)
  
  const handleBuildPlan = () => {
    setShowingResults(true)
    handleGenerate()
  }
  
  const handleGenerate = () => {
    setIsGenerating(true)
    setProgress(0)
    setGenerationError(null)
    
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) return prev
        return prev + Math.random() * 15
      })
    }, 100)
    
    // Use setTimeout to allow UI to update
    setTimeout(() => {
      try {
        // Derive attendance from arrival/departure
        const ferries = getFerries()
        const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(arrival, departure, ferries)
        
        const plan = generatePlanV3({
          films,
          screenings,
          interests,
          constraints,
          attendanceConstraints: {
            attendanceDays,
            availabilityByDate
          },
          timeBudgetMs: 750 // 750ms budget for mobile
        })
        
        clearInterval(progressInterval)
        setProgress(100)
        
        setTimeout(() => {
          setGeneratedPlan(plan)
          setIsGenerating(false)
          setProgress(0)
          
          // Development-only performance logging
          if (import.meta.env.DEV && plan.metadata) {
            console.log('=== Plan Generation Performance ===')
            console.log('Candidate films:', plan.metadata.candidateFilms)
            console.log('Candidate screenings:', plan.metadata.candidateScreenings)
            console.log('Greedy solution time:', plan.metadata.greedyMs?.toFixed(1), 'ms')
            console.log('Initial solution size:', plan.metadata.initialSolutionSize)
            console.log('Search nodes explored:', plan.metadata.nodesExplored)
            console.log('Branches pruned:', plan.metadata.nodesPruned)
            console.log('Total optimization time:', plan.metadata.totalMs?.toFixed(1), 'ms')
            console.log('Optimality proven:', plan.metadata.optimalityProven)
            console.log('===================================')
          }
        }, 300)
      } catch (error) {
        console.error('Plan generation failed:', error)
        clearInterval(progressInterval)
        setIsGenerating(false)
        setProgress(0)
        setGenerationError(error.message || 'An unexpected error occurred')
      }
    }, 50)
  }
  
  const handleUsePlan = () => {
    if (!generatedPlan || !generatedPlan.screenings) return
    
    const screeningIds = generatedPlan.screenings.map(s => s.id)
    setSelectedScreenings(screeningIds)
    
    alert(`Plan applied! ${screeningIds.length} screenings added to My Plan.`)
  }
  
  const handleExcludeFilm = (filmId) => {
    setIsGenerating(true)
    setProgress(0)
    setGenerationError(null)
    
    const newExcluded = [...constraints.excludedFilms, filmId]
    updateConstraints({ excludedFilms: newExcluded })
    
    const progressInterval = setInterval(() => {
      setProgress(prev => (prev >= 90 ? prev : prev + Math.random() * 20))
    }, 80)
    
    setTimeout(() => {
      try {
        const plan = generatePlanV3({
          films,
          screenings,
          interests,
          constraints: { ...constraints, excludedFilms: newExcluded },
          attendanceConstraints: {
            attendanceDays: attendance.attendanceDays,
            availabilityByDate: attendance.availabilityByDate
          },
          
          timeBudgetMs: 750
        })
        
        clearInterval(progressInterval)
        setProgress(100)
        
        setTimeout(() => {
          setGeneratedPlan(plan)
          setIsGenerating(false)
          setProgress(0)
        }, 200)
      } catch (error) {
        console.error('Plan regeneration failed:', error)
        clearInterval(progressInterval)
        setIsGenerating(false)
        setProgress(0)
        setGenerationError(error.message || 'An unexpected error occurred')
      }
    }, 50)
  }
  
  const handleLockScreening = (screeningId) => {
    setIsGenerating(true)
    setProgress(0)
    setGenerationError(null)
    
    const newLocked = [...constraints.lockedScreenings, screeningId]
    updateConstraints({ lockedScreenings: newLocked })
    
    const progressInterval = setInterval(() => {
      setProgress(prev => (prev >= 90 ? prev : prev + Math.random() * 20))
    }, 80)
    
    setTimeout(() => {
      try {
        const plan = generatePlanV3({
          films,
          screenings,
          interests,
          constraints: { ...constraints, lockedScreenings: newLocked },
          attendanceConstraints: {
            attendanceDays: attendance.attendanceDays,
            availabilityByDate: attendance.availabilityByDate
          },
          
          timeBudgetMs: 750
        })
        
        clearInterval(progressInterval)
        setProgress(100)
        
        setTimeout(() => {
          setGeneratedPlan(plan)
          setIsGenerating(false)
          setProgress(0)
        }, 200)
      } catch (error) {
        console.error('Plan regeneration failed:', error)
        clearInterval(progressInterval)
        setIsGenerating(false)
        setProgress(0)
        setGenerationError(error.message || 'An unexpected error occurred')
      }
    }, 50)
  }
  
  const handleUnlockScreening = (screeningId) => {
    const newLocked = constraints.lockedScreenings.filter(id => id !== screeningId)
    updateConstraints({ lockedScreenings: newLocked })
    
    // Trigger regeneration
    handleLockScreening(screeningId)
    // Then immediately unlock it
    setTimeout(() => {
      updateConstraints({ lockedScreenings: newLocked })
    }, 50)
  }
  
  const handleStartOver = () => {
    setShowingResults(false)
    setGeneratedPlan(null)
  }
  
  // Simple two-state UI: setup or results
  return (
    <div className="planner-view">
      {!showingResults && (
        <AttendanceStep onContinue={handleBuildPlan} />
      )}
      
      {showingResults && (
        <div className="plan-step">
          {/* Loading state */}
          {isGenerating && (
            <div className="progress-container">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="progress-text">Generating your festival plan...</p>
            </div>
          )}
          
          {/* Error state */}
          {!isGenerating && generationError && (
            <div className="planner-error">
              <h2>Plan Generation Failed</h2>
              <p>{generationError}</p>
              <div className="error-actions">
                <button onClick={handleGenerate} className="retry-button">
                  Try Again
                </button>
                <button onClick={handleStartOver} className="start-over-button">
                  Back to Planner Setup
                </button>
              </div>
            </div>
          )}
          
          {/* No plan yet (recovery state) */}
          {!isGenerating && !generationError && !generatedPlan && (
            <div className="planner-no-plan">
              <h2>No Plan Generated</h2>
              <p>Let's set up your festival plan.</p>
              <button onClick={handleStartOver} className="start-over-button">
                Back to Planner Setup
              </button>
            </div>
          )}
          
          {/* Successful plan */}
          {!isGenerating && !generationError && generatedPlan && (
            <>
              {generatedPlan.infeasible ? (
                <div className="planner-error">
                  <h2>Unable to Generate Plan</h2>
                  <p>{generatedPlan.reason}</p>
                  <button onClick={handleStartOver}>Start Over</button>
                </div>
              ) : (
                <>
                  <div className="planner-header">
                    <h2>Your Festival Plan</h2>
                    <div className="planner-stats">
                      <div className="stat">
                        <span className="stat-value">{generatedPlan.screenings.length}</span>
                        <span className="stat-label">films</span>
                      </div>
                      {generatedPlan.interestCounts && (
                        <>
                          {generatedPlan.interestCounts['must-see'] > 0 && (
                            <div className="stat">
                              <span className="stat-value must-see">
                                {generatedPlan.interestCounts['must-see']}
                              </span>
                              <span className="stat-label">Must See</span>
                            </div>
                          )}
                          {generatedPlan.interestCounts['want-to-see'] > 0 && (
                            <div className="stat">
                              <span className="stat-value want-to-see">
                                {generatedPlan.interestCounts['want-to-see']}
                              </span>
                              <span className="stat-label">Want to See</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="planner-actions">
                      <button onClick={handleUsePlan} className="use-plan-button">
                        Use This Plan
                      </button>
                      <button onClick={handleStartOver} className="start-over-button">
                        Start Over
                      </button>
                    </div>
                  </div>
                  
                  <div className={`planner-results ${isGenerating ? 'recomputing' : ''}`}>
                    {isGenerating && (
                      <div className="recomputing-overlay">
                        <div className="progress-bar">
                          <div className="progress-fill" style={{ width: `${progress}%` }} />
                        </div>
                        <p>Recomputing plan...</p>
                      </div>
                    )}
                    
                    {renderPlanByDay(generatedPlan.screenings, handleExcludeFilm, handleLockScreening, handleUnlockScreening, constraints)}
                    
                    {generatedPlan.omittedHighPriority && generatedPlan.omittedHighPriority.length > 0 && (
                      <div className="omitted-section">
                        <h3>Not in This Plan</h3>
                        <p className="omitted-explanation">
                          These films couldn't fit due to conflicts or time constraints:
                        </p>
                        {generatedPlan.omittedHighPriority.map(omission => (
                          <div key={omission.film.id} className="omitted-film">
                            <div className="omitted-info">
                              <strong>{omission.film.title}</strong>
                              <span className={`interest-badge ${omission.interest}`}>
                                {formatInterest(omission.interest)}
                              </span>
                            </div>
                            {omission.reason && (
                              <div className="omission-reason">{omission.reason}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function renderPlanByDay(planScreenings, onExclude, onLock, onUnlock, constraints) {
  const byDate = {}
  
  planScreenings.forEach(screening => {
    if (!byDate[screening.date]) {
      byDate[screening.date] = []
    }
    byDate[screening.date].push(screening)
  })
  
  const dates = Object.keys(byDate).sort()
  
  return dates.map(date => {
    const dateScreenings = byDate[date]
    const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    })
    
    return (
      <div key={date} className="plan-day">
        <h3 className="day-header">{dateLabel}</h3>
        <div className="day-screenings">
          {dateScreenings.map(screening => {
            const film = films.find(f => f.id === screening.filmId)
            if (!film) return null
            
            const isLocked = constraints.lockedScreenings?.includes(screening.id)
            
            return (
              <div key={screening.id} className="plan-screening">
                <div className="screening-time">
                  <strong>{formatTime(screening.startTime)}</strong>
                  <span className="venue">{screening.venue}</span>
                </div>
                <div className="screening-film">
                  <div className="film-title">{film.title}</div>
                  {film.runtime && (
                    <div className="film-meta">{film.runtime} min</div>
                  )}
                </div>
                <div className="screening-actions">
                  {isLocked ? (
                    <button 
                      className="action-btn unlock"
                      onClick={() => onUnlock(screening.id)}
                      title="Unlock this screening"
                    >
                      🔓
                    </button>
                  ) : (
                    <button 
                      className="action-btn lock"
                      onClick={() => onLock(screening.id)}
                      title="Lock this screening"
                    >
                      🔒
                    </button>
                  )}
                  <button 
                    className="action-btn exclude"
                    onClick={() => onExclude(film.id)}
                    title="Exclude this film"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  })
}

function formatTime(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`
}

function formatInterest(interest) {
  const labels = {
    'must-see': 'Must See',
    'want-to-see': 'Want to See',
    'maybe': 'Maybe',
    'unrated': 'Unrated'
  }
  return labels[interest] || interest
}

// Wrap with Error Boundary
function PlannerView() {
  const { resetPlannerSession } = usePlanner()
  
  return (
    <ErrorBoundary
      onReset={() => {
        // Try again - just re-render
      }}
      onResetPlanner={() => {
        // Reset only planner session state, not film ratings or My Plan
        resetPlannerSession()
      }}
    >
      <PlannerViewInner />
    </ErrorBoundary>
  )
}

export default PlannerView
