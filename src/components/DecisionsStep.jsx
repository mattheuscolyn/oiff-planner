import { useMemo } from 'react'
import { usePlanner } from '../contexts/PlannerContext'
import { useUserState } from '../contexts/UserStateContext'
import { films, screenings } from '../utils/festivalData'
import { 
  detectUnavoidableConflicts, 
  getAutoResolution,
  groupConflicts 
} from '../planner/decisions'
import './DecisionsStep.css'

function DecisionsStep({ onContinue, onBack }) {
  const { attendance, hardDecisions, updateHardDecisions, constraints } = usePlanner()
  const { interests } = useUserState()
  
  // Convert attendance to constraints format for decision detection
  const attendanceConstraints = useMemo(() => ({
    attendanceDays: attendance.attendanceDays,
    availabilityByDate: attendance.availabilityByDate
  }), [attendance])
  
  // Detect unavoidable conflicts
  const conflicts = useMemo(() => {
    return detectUnavoidableConflicts(
      films,
      screenings,
      interests,
      attendanceConstraints,
      constraints.lockedScreenings,
      hardDecisions,
      constraints.excludedFilms
    )
  }, [interests, attendanceConstraints, constraints.lockedScreenings, hardDecisions, constraints.excludedFilms])
  
  // Group conflicts
  const groupedConflicts = useMemo(() => {
    return groupConflicts(conflicts)
  }, [conflicts])
  
  // Calculate decision stats
  const totalDecisions = groupedConflicts.length
  const resolvedCount = Object.keys(hardDecisions).length
  const unresolvedConflicts = groupedConflicts.filter(
    conflict => !hardDecisions[conflict.decisionKey]
  )
  
  const handleChoice = (decisionKey, chosenFilmId, excludedFilmIds) => {
    updateHardDecisions({
      [decisionKey]: {
        chosen: chosenFilmId,
        excluded: excludedFilmIds
      }
    })
  }
  
  const handleNeither = (decisionKey, filmIds) => {
    updateHardDecisions({
      [decisionKey]: {
        chosen: null,
        excluded: filmIds
      }
    })
  }
  
  const handleDecideLater = (decisionKey) => {
    // Remove decision if it exists
    const updated = { ...hardDecisions }
    delete updated[decisionKey]
    updateHardDecisions(updated)
  }
  
  const handleAutoResolveAll = () => {
    const updates = {}
    for (const conflict of unresolvedConflicts) {
      const autoResolution = getAutoResolution(conflict)
      if (autoResolution) {
        const otherFilmIds = conflict.films
          .filter(f => f.id !== autoResolution.chosen)
          .map(f => f.id)
        
        updates[conflict.decisionKey] = {
          chosen: autoResolution.chosen,
          excluded: otherFilmIds,
          autoResolved: true,
          reason: autoResolution.reason
        }
      }
    }
    
    if (Object.keys(updates).length > 0) {
      updateHardDecisions(updates)
    }
  }
  
  return (
    <div className="decisions-step">
      <div className="decisions-header">
        <h2>Decisions</h2>
        
        {totalDecisions === 0 ? (
          <p className="decisions-summary good">
            No unavoidable conflicts! Your schedule allows seeing all your interested films.
          </p>
        ) : (
          <>
            <p className="decisions-summary">
              {resolvedCount === 0 && (
                <>{totalDecisions} {totalDecisions === 1 ? 'decision' : 'decisions'} needed before building your schedule</>
              )}
              {resolvedCount > 0 && resolvedCount < totalDecisions && (
                <>{resolvedCount} of {totalDecisions} resolved</>
              )}
              {resolvedCount === totalDecisions && (
                <>Ready to build your plan</>
              )}
            </p>
            
            {unresolvedConflicts.some(c => getAutoResolution(c)) && (
              <button 
                className="auto-resolve-button"
                onClick={handleAutoResolveAll}
              >
                Auto-resolve by ratings
              </button>
            )}
          </>
        )}
      </div>
      
      <div className="conflicts-list">
        {groupedConflicts.map(conflict => {
          const [filmA, filmB] = conflict.films
          const decision = hardDecisions[conflict.decisionKey]
          const autoResolution = getAutoResolution(conflict)
          const isResolved = !!decision
          
          return (
            <div 
              key={conflict.decisionKey} 
              className={`conflict-card ${isResolved ? 'resolved' : ''}`}
            >
              <div className="conflict-header">
                <h3>You can't see both</h3>
              </div>
              
              <div className="conflict-films">
                <div className="conflict-film">
                  <div className="film-info">
                    <h4>{filmA.title}</h4>
                    <span className={`interest-badge ${conflict.interests[0]}`}>
                      {formatInterestBadge(conflict.interests[0])}
                    </span>
                  </div>
                  {!isResolved && (
                    <button
                      className="choice-button"
                      onClick={() => handleChoice(conflict.decisionKey, filmA.id, [filmB.id])}
                    >
                      Choose {filmA.title}
                    </button>
                  )}
                  {isResolved && decision.chosen === filmA.id && (
                    <div className="chosen-badge">✓ Chosen</div>
                  )}
                </div>
                
                <div className="or-separator">OR</div>
                
                <div className="conflict-film">
                  <div className="film-info">
                    <h4>{filmB.title}</h4>
                    <span className={`interest-badge ${conflict.interests[1]}`}>
                      {formatInterestBadge(conflict.interests[1])}
                    </span>
                  </div>
                  {!isResolved && (
                    <button
                      className="choice-button"
                      onClick={() => handleChoice(conflict.decisionKey, filmB.id, [filmA.id])}
                    >
                      Choose {filmB.title}
                    </button>
                  )}
                  {isResolved && decision.chosen === filmB.id && (
                    <div className="chosen-badge">✓ Chosen</div>
                  )}
                </div>
              </div>
              
              {!isResolved && (
                <div className="conflict-actions">
                  <button
                    className="action-button neither"
                    onClick={() => handleNeither(conflict.decisionKey, [filmA.id, filmB.id])}
                  >
                    Neither
                  </button>
                  <button
                    className="action-button later"
                    onClick={() => handleDecideLater(conflict.decisionKey)}
                  >
                    Decide later
                  </button>
                </div>
              )}
              
              {isResolved && (
                <div className="conflict-actions">
                  {decision.autoResolved && decision.reason && (
                    <p className="auto-reason">{decision.reason}</p>
                  )}
                  <button
                    className="action-button change"
                    onClick={() => handleDecideLater(conflict.decisionKey)}
                  >
                    Change decision
                  </button>
                </div>
              )}
              
              {!isResolved && autoResolution && (
                <div className="auto-suggestion">
                  <p>💡 Suggestion: {autoResolution.reason}</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
      
      <div className="decisions-navigation">
        <button className="back-button" onClick={onBack}>
          ← Back to Attendance
        </button>
        <button 
          className="continue-button" 
          onClick={onContinue}
        >
          {unresolvedConflicts.length > 0 ? 'Build plan anyway' : 'Build my plan'}
        </button>
      </div>
    </div>
  )
}

function formatInterestBadge(interest) {
  const labels = {
    'must-see': 'Must See',
    'want-to-see': 'Want to See',
    'maybe': 'Maybe',
    'unrated': 'Unrated'
  }
  return labels[interest] || interest
}

export default DecisionsStep
