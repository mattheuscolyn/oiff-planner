import { useState } from 'react'
import { films, screenings } from '../utils/festivalData'
import { useUserState } from '../contexts/UserStateContext'
import { usePlanner } from '../contexts/PlannerContext'
import { generatePlan } from '../planner/optimizer'
import { OBJECTIVES } from '../planner/scoring'
import { setSelectedScreenings } from '../utils/userState'
import './PlannerView.css'

function PlannerView() {
  const { interests } = useUserState()
  const { objective, setObjective, constraints, updateConstraints, generatedPlan, setGeneratedPlan, resetPlanner } = usePlanner()
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [showAdvanced, setShowAdvanced] = useState(false)
  
  const handleGenerate = () => {
    setIsGenerating(true)
    setProgress(0)
    
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) return prev
        return prev + Math.random() * 15
      })
    }, 100)
    
    setTimeout(() => {
      const plan = generatePlan({
        films,
        screenings,
        interests,
        constraints,
        objective
      })
      
      clearInterval(progressInterval)
      setProgress(100)
      
      setTimeout(() => {
        setGeneratedPlan(plan)
        setIsGenerating(false)
        setProgress(0)
      }, 300)
    }, 150)
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
    
    const newExcluded = [...constraints.excludedFilms, filmId]
    updateConstraints({ excludedFilms: newExcluded })
    
    const progressInterval = setInterval(() => {
      setProgress(prev => (prev >= 90 ? prev : prev + Math.random() * 20))
    }, 80)
    
    setTimeout(() => {
      const plan = generatePlan({
        films,
        screenings,
        interests,
        constraints: { ...constraints, excludedFilms: newExcluded },
        objective
      })
      
      clearInterval(progressInterval)
      setProgress(100)
      
      setTimeout(() => {
        setGeneratedPlan(plan)
        setIsGenerating(false)
        setProgress(0)
      }, 200)
    }, 120)
  }
  
  const handleLockScreening = (screeningId) => {
    setIsGenerating(true)
    setProgress(0)
    
    const newLocked = [...constraints.lockedScreenings, screeningId]
    updateConstraints({ lockedScreenings: newLocked })
    
    const progressInterval = setInterval(() => {
      setProgress(prev => (prev >= 90 ? prev : prev + Math.random() * 20))
    }, 80)
    
    setTimeout(() => {
      const plan = generatePlan({
        films,
        screenings,
        interests,
        constraints: { ...constraints, lockedScreenings: newLocked },
        objective
      })
      
      clearInterval(progressInterval)
      setProgress(100)
      
      setTimeout(() => {
        setGeneratedPlan(plan)
        setIsGenerating(false)
        setProgress(0)
      }, 200)
    }, 120)
  }
  
  return (
    <div className="planner-view">
      <div className="planner-header">
        <h2>Plan My Festival</h2>
        <p>Generate an optimized festival schedule based on your preferences</p>
      </div>
      
      {!generatedPlan && (
        <div className="planner-setup">
          <div className="setup-section">
            <label>Optimization Objective</label>
            <select value={objective} onChange={(e) => setObjective(e.target.value)}>
              <option value={OBJECTIVES.MOST_FILMS}>Most Films - Maximize number of distinct films</option>
              <option value={OBJECTIVES.BEST_MATCHES}>Best Matches - Prioritize high-interest films</option>
              <option value={OBJECTIVES.BALANCED}>Balanced - Quality and quantity</option>
            </select>
          </div>
          
          <div className="setup-section">
            <label>Maximum Films</label>
            <input 
              type="number" 
              placeholder="No limit" 
              value={constraints.maxFilmsTotal || ''} 
              onChange={(e) => updateConstraints({ maxFilmsTotal: e.target.value ? parseInt(e.target.value) : null })}
            />
          </div>
          
          <button 
            className="toggle-advanced"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? '▼' : '▶'} Advanced Options
          </button>
          
          {showAdvanced && (
            <div className="advanced-options">
              <div className="setup-section">
                <label>Max Films Per Day</label>
                <input 
                  type="number" 
                  placeholder="No limit"
                  value={constraints.maxFilmsPerDay || ''} 
                  onChange={(e) => updateConstraints({ maxFilmsPerDay: e.target.value ? parseInt(e.target.value) : null })}
                />
              </div>
              
              <div className="setup-section">
                <label>
                  <input 
                    type="checkbox" 
                    checked={constraints.includeSkip} 
                    onChange={(e) => updateConstraints({ includeSkip: e.target.checked })}
                  />
                  Include films marked Skip
                </label>
              </div>
              
              <div className="setup-section">
                <label>
                  <input 
                    type="checkbox" 
                    checked={constraints.includeSeen} 
                    onChange={(e) => updateConstraints({ includeSeen: e.target.checked })}
                  />
                  Include films marked Seen
                </label>
              </div>
            </div>
          )}
          
          <button 
            className="generate-button" 
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? 'Generating...' : 'Generate Plan'}
          </button>
          
          {isGenerating && (
            <div className="progress-container">
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="progress-text">
                Optimizing your festival schedule...
              </div>
            </div>
          )}
        </div>
      )}
      
      {isGenerating && generatedPlan && (
        <div className="recomputing-overlay">
          <div className="progress-container">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="progress-text">
              Recomputing plan...
            </div>
          </div>
        </div>
      )}
      
      {generatedPlan && (
        <div className={`planner-results ${isGenerating ? 'recomputing' : ''}`}>
          {generatedPlan.infeasible ? (
            <div className="infeasible-notice">
              <h3>⚠️ Unable to Generate Plan</h3>
              <p>{generatedPlan.reason}</p>
              <button onClick={() => setGeneratedPlan(null)}>Try Again</button>
            </div>
          ) : (
            <>
              <div className="results-header">
                <div className="results-stats">
                  <div className="stat">
                    <strong>{generatedPlan.screenings.length}</strong>
                    <span>Films</span>
                  </div>
                  {generatedPlan.interestCounts && (
                    <>
                      <div className="stat">
                        <strong>{generatedPlan.interestCounts.mustSee}</strong>
                        <span>Must See</span>
                      </div>
                      <div className="stat">
                        <strong>{generatedPlan.interestCounts.wantToSee}</strong>
                        <span>Want to See</span>
                      </div>
                    </>
                  )}
                </div>
                
                <div className="results-actions">
                  <button className="use-plan-button" onClick={handleUsePlan}>
                    Use This Plan
                  </button>
                  <button onClick={() => setGeneratedPlan(null)}>
                    Generate New
                  </button>
                  <button onClick={resetPlanner}>
                    Reset All
                  </button>
                </div>
              </div>
              
              <div className="results-schedule">
                {generatedPlan.screenings.length === 0 ? (
                  <p>No screenings in plan</p>
                ) : (
                  (() => {
                    const byDate = {}
                    generatedPlan.screenings.forEach(s => {
                      if (!byDate[s.date]) byDate[s.date] = []
                      byDate[s.date].push(s)
                    })
                    
                    return Object.entries(byDate)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([date, dayScreenings]) => {
                        const sortedScreenings = dayScreenings.sort((a, b) => 
                          a.startTime.localeCompare(b.startTime)
                        )
                        
                        return (
                          <div key={date} className="results-day">
                            <h3>{new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
                            {sortedScreenings.map(screening => {
                              const film = films.find(f => f.id === screening.filmId)
                              if (!film) return null
                              
                              const isLocked = constraints.lockedScreenings.includes(screening.id)
                              
                              return (
                                <div key={screening.id} className={`result-screening ${isLocked ? 'locked' : ''}`}>
                                  <div className="screening-time">
                                    {screening.startTime}
                                  </div>
                                  <div className="screening-info">
                                    <div className="film-title">{film.title}</div>
                                    <div className="screening-details">
                                      {film.runtime} min • {screening.venue}
                                      {isLocked && <span className="locked-badge">🔒 Locked</span>}
                                    </div>
                                  </div>
                                  <div className="screening-actions">
                                    <button 
                                      onClick={() => handleExcludeFilm(film.id)}
                                      title="Exclude this film"
                                    >
                                      ✕
                                    </button>
                                    {!isLocked && (
                                      <button 
                                        onClick={() => handleLockScreening(screening.id)}
                                        title="Lock this screening"
                                      >
                                        🔒
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })
                  })()
                )}
              </div>
              
              {generatedPlan.omittedHighPriority && generatedPlan.omittedHighPriority.length > 0 && (
                <div className="omitted-films">
                  <h3>High-Priority Films Not Included</h3>
                  {generatedPlan.omittedHighPriority.slice(0, 5).map(({ film, reason }) => (
                    <div key={film.id} className="omitted-film">
                      <div className="film-title">{film.title}</div>
                      <div className="omission-reason">{reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default PlannerView
