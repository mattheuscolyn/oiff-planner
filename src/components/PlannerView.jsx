import { useState, useRef } from 'react'
import { films, screenings } from '../utils/festivalData'
import { useUserState } from '../contexts/UserStateContext'
import { usePlanner } from '../contexts/PlannerContext'
import {
  appendUniqueId,
  applyExcludeFilm,
  removeRequiredFilm,
  DEFAULT_TIME_BUDGET_MS
} from '../planner/generateCurrentPlan'
import { generateCurrentPlanAsync } from '../planner/runPlanInWorker'
import { resolveConflictChoice } from '../planner/conflictResolution'
import {
  buildPairCheckConstraintOverrides,
  buildRequireBothUpdates,
  shapePairCheckError,
  shapePairCheckResult
} from '../planner/pairCheck'
import { INTEREST_LEVELS } from '../utils/userState'
import { setSelectedScreenings } from '../utils/userState'
import AttendanceStep from './AttendanceStep'
import ErrorBoundary from './ErrorBoundary'
import RequiredConflictView from './RequiredConflictView'
import FilmPoster from './FilmPoster'
import SlotOptionsPanel from './SlotOptionsPanel'
import './PlannerView.css'

function PlannerViewInner() {
  const { interests, updateFilmInterest } = useUserState()
  const {
    constraints,
    arrival,
    departure,
    generatedPlan,
    setGeneratedPlan,
    updateConstraints
  } = usePlanner()

  const [showingResults, setShowingResults] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [searchStatus, setSearchStatus] = useState('')
  const [generationError, setGenerationError] = useState(null)
  const [pairCheckLoading, setPairCheckLoading] = useState(false)
  const [pairCheckTarget, setPairCheckTarget] = useState(null)
  const [pairCheckResult, setPairCheckResult] = useState(null)
  const abortRef = useRef(null)
  const pairAbortRef = useRef(null)

  const clearPairCheck = () => {
    setPairCheckLoading(false)
    setPairCheckTarget(null)
    setPairCheckResult(null)
  }

  const runPlanGeneration = (constraintOverrides = {}, interestOverrides = null) => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
    if (pairAbortRef.current) {
      pairAbortRef.current.abort()
    }
    clearPairCheck()

    const controller = new AbortController()
    abortRef.current = controller

    setIsGenerating(true)
    setSearchStatus('Searching feasible schedules…')
    setGenerationError(null)

    generateCurrentPlanAsync({
      films,
      screenings,
      interests: interestOverrides || interests,
      constraints,
      arrival,
      departure,
      constraintOverrides,
      timeBudgetMs: DEFAULT_TIME_BUDGET_MS,
      signal: controller.signal,
      onProgress: ({ combinationsExplored, bestFilmCount, elapsedMs, phase }) => {
        const phaseHint = phase ? ` (${phase})` : ''
        setSearchStatus(
          `Searching${phaseHint}… best so far ${bestFilmCount} films · ${(elapsedMs / 1000).toFixed(1)}s · ${Number(combinationsExplored || 0).toLocaleString()} combos`
        )
      }
    })
      .then(plan => {
        if (controller.signal.aborted) return
        setGeneratedPlan(plan)
        setIsGenerating(false)
        setSearchStatus('')
      })
      .catch(error => {
        if (error?.name === 'AbortError' || controller.signal.aborted) return
        console.error('Plan generation failed:', error)
        setIsGenerating(false)
        setSearchStatus('')
        setGenerationError(error.message || 'An unexpected error occurred')
      })
  }

  const handleCanSeeBoth = (filmIdA, filmIdB) => {
    if (!generatedPlan || generatedPlan.infeasible) return
    if (pairAbortRef.current) {
      pairAbortRef.current.abort()
    }
    const controller = new AbortController()
    pairAbortRef.current = controller

    setPairCheckTarget({ filmIdA, filmIdB })
    setPairCheckResult(null)
    setPairCheckLoading(true)

    const overrides = buildPairCheckConstraintOverrides(
      constraints,
      filmIdA,
      filmIdB,
      interests
    )

    generateCurrentPlanAsync({
      films,
      screenings,
      interests,
      constraints,
      arrival,
      departure,
      constraintOverrides: overrides,
      timeBudgetMs: DEFAULT_TIME_BUDGET_MS,
      signal: controller.signal,
      onProgress: null
    })
      .then(pairPlan => {
        if (controller.signal.aborted) return
        const filmMap = new Map(films.map(f => [f.id, f]))
        const shaped = shapePairCheckResult({
          currentPlan: generatedPlan,
          pairPlan,
          filmIdA,
          filmIdB,
          filmMap
        })
        setPairCheckResult(shaped)
        setPairCheckLoading(false)
      })
      .catch(error => {
        if (error?.name === 'AbortError' || controller.signal.aborted) return
        console.error('Pair check failed:', error)
        setPairCheckResult(
          shapePairCheckError({
            error,
            filmIdA,
            filmIdB,
            currentPlan: generatedPlan
          })
        )
        setPairCheckLoading(false)
      })
  }

  const handleRequireBoth = (filmIdA, filmIdB) => {
    const updates = buildRequireBothUpdates(constraints, filmIdA, filmIdB, interests)
    updateConstraints(updates)
    clearPairCheck()
    runPlanGeneration(updates)
  }

  const handleDismissPairCheck = () => {
    if (pairAbortRef.current) {
      pairAbortRef.current.abort()
    }
    clearPairCheck()
  }

  const handleBuildPlan = () => {
    setShowingResults(true)
    runPlanGeneration()
  }

  const handleGenerate = () => runPlanGeneration()

  const handleUsePlan = () => {
    if (!generatedPlan?.screenings) return
    const screeningIds = generatedPlan.screenings.map(s => s.id)
    setSelectedScreenings(screeningIds)
    alert(`Plan applied! ${screeningIds.length} screenings added to My Plan.`)
  }

  const handleExcludeFilm = (filmId) => {
    const updates = applyExcludeFilm(constraints, filmId)
    updateConstraints(updates)
    runPlanGeneration(updates)
  }

  const handleRequireFilm = (filmId) => {
    if (interests[filmId] === INTEREST_LEVELS.MUST_SEE) return
    const newRequired = appendUniqueId(constraints.requiredFilms, filmId)
    updateConstraints({ requiredFilms: newRequired })
    runPlanGeneration({ requiredFilms: newRequired })
  }

  const handleUnrequireFilm = (filmId) => {
    if (interests[filmId] === INTEREST_LEVELS.MUST_SEE) return
    const newRequired = removeRequiredFilm(constraints.requiredFilms, filmId)
    updateConstraints({ requiredFilms: newRequired })
    runPlanGeneration({ requiredFilms: newRequired })
  }

  const applyConflictResolution = (mode, targetFilmId) => {
    const conflictIds =
      generatedPlan?.conflict?.filmIds ||
      (generatedPlan?.unavailable?.filmId ? [generatedPlan.unavailable.filmId] : [])
    if (!conflictIds.length) return

    const { interestUpdates, constraintUpdates } = resolveConflictChoice({
      mode,
      targetFilmId,
      conflictFilmIds: conflictIds,
      interests,
      constraints
    })

    for (const [filmId, level] of Object.entries(interestUpdates)) {
      if (interests[filmId] !== level) {
        updateFilmInterest(filmId, level)
      }
    }
    updateConstraints(constraintUpdates)
    runPlanGeneration(constraintUpdates, interestUpdates)
  }

  const handlePrioritizeFilm = (filmId) => applyConflictResolution('prioritize', filmId)
  const handleRelaxFilm = (filmId) => applyConflictResolution('relax', filmId)

  const handleStartOver = () => {
    setShowingResults(false)
    setGeneratedPlan(null)
  }

  const handleBackToRatings = () => {
    setShowingResults(false)
    setGeneratedPlan(null)
  }

  const manualRequired = new Set(constraints.requiredFilms || [])
  const effectiveRequired = new Set([
    ...manualRequired,
    ...Object.entries(interests)
      .filter(([, v]) => v === INTEREST_LEVELS.MUST_SEE)
      .map(([id]) => id)
      .filter(id => !(constraints.excludedFilms || []).includes(id))
  ])

  const isResolvableConflict =
    generatedPlan?.infeasible &&
    (generatedPlan.reasonCode === 'required-film-conflict' ||
      generatedPlan.reasonCode === 'required-film-unavailable')

  return (
    <div className="planner-view">
      {!showingResults && <AttendanceStep onContinue={handleBuildPlan} />}

      {showingResults && (
        <div className="plan-step">
          {isGenerating && (
            <div className="progress-container">
              <p className="progress-text">{searchStatus || 'Searching feasible schedules…'}</p>
              <p className="progress-hint">
                This can take up to about {Math.round(DEFAULT_TIME_BUDGET_MS / 1000)} seconds while the planner searches.
              </p>
            </div>
          )}

          {!isGenerating && generationError && (
            <div className="planner-error">
              <h2>Plan Generation Failed</h2>
              <p>{generationError}</p>
              <div className="error-actions">
                <button onClick={handleGenerate} className="retry-button">Try Again</button>
                <button onClick={handleStartOver} className="start-over-button">Back to Planner Setup</button>
              </div>
            </div>
          )}

          {!isGenerating && !generationError && !generatedPlan && (
            <div className="planner-no-plan">
              <h2>No Plan Generated</h2>
              <button onClick={handleStartOver} className="start-over-button">Back to Planner Setup</button>
            </div>
          )}

          {!isGenerating && !generationError && generatedPlan && (
            generatedPlan.infeasible ? (
              isResolvableConflict ? (
                <RequiredConflictView
                  plan={generatedPlan}
                  interests={interests}
                  manualRequired={[...manualRequired]}
                  onPrioritizeFilm={handlePrioritizeFilm}
                  onRelaxFilm={handleRelaxFilm}
                  onBackToRatings={handleBackToRatings}
                  onBackToAttendance={handleStartOver}
                />
              ) : (
                <div className="planner-error">
                  <h2>Unable to Generate Plan</h2>
                  <p>{generatedPlan.reason}</p>
                  <button onClick={handleBackToRatings}>Back to ratings</button>
                </div>
              )
            ) : (
              <>
                <div className="planner-header">
                  <h2>Your Festival Plan</h2>
                  {renderCoverageHeader(generatedPlan)}
                  <div className="planner-actions">
                    <button onClick={handleUsePlan} className="use-plan-button">Use This Plan</button>
                    <button onClick={handleStartOver} className="start-over-button">Start Over</button>
                  </div>
                </div>

                {renderPlanByDay(
                  generatedPlan.screenings,
                  interests,
                  effectiveRequired,
                  manualRequired,
                  handleRequireFilm,
                  handleUnrequireFilm,
                  handleExcludeFilm,
                  generatedPlan.slotOptions,
                  {
                    pairCheckResult,
                    pairCheckLoading,
                    pairCheckTarget,
                    onCanSeeBoth: handleCanSeeBoth,
                    onRequireBoth: handleRequireBoth,
                    onDismissPairCheck: handleDismissPairCheck
                  }
                )}

                {renderOmissions(generatedPlan.omissions, handleRequireFilm)}
                {renderAlternatives(generatedPlan.alternatives)}
              </>
            )
          )}
        </div>
      )}
    </div>
  )
}

function renderCoverageHeader(plan) {
  const c = plan.coverage
  const meta = plan.metadata || {}
  const countProven = meta.maxFilmCountProven
  const prefProven = meta.preferenceOptimalityProven

  return (
    <div className="planner-stats-block">
      <div className="stat-primary">
        <span className="stat-value">{plan.filmCount}</span>
        <span className="stat-label">films</span>
      </div>
      {c && (
        <div className="coverage-line">
          {c.must.total > 0 && (
            <span>{c.must.included}/{c.must.total} Must</span>
          )}
          {c.want.total > 0 && (
            <span>{c.want.included}/{c.want.total} Want</span>
          )}
          {c.maybe.total > 0 && (
            <span>{c.maybe.included}/{c.maybe.total} Maybe</span>
          )}
          {c.unrated.included > 0 && (
            <span>+ {c.unrated.included} Unrated</span>
          )}
        </div>
      )}
      <div className={`optimality-badge ${countProven ? 'proven' : 'best-found'}`}>
        {countProven ? (
          prefProven ? (
            <>Maximum count proven · Best preference mix proven</>
          ) : (
            <>
              Maximum count proven
              <span className="optimality-sub">
                Best preference mix found within search budget
              </span>
            </>
          )
        ) : (
          <>Best found — maximum count not yet proven</>
        )}
        {meta.elapsedMs != null && (
          <span className="optimality-meta">
            {' '}· {(meta.elapsedMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>
    </div>
  )
}

function renderOmissions(omissions, onRequire) {
  if (!omissions?.length) return null
  return (
    <div className="omitted-section">
      <h3>Not in This Plan</h3>
      <p className="omitted-explanation">Rated films that did not fit this schedule:</p>
      {omissions.map(o => {
        const canRequire =
          onRequire &&
          (o.interest === INTEREST_LEVELS.WANT_TO_SEE ||
            o.interest === INTEREST_LEVELS.MAYBE)
        return (
          <div key={o.film.id} className="omitted-film">
            <div className="omitted-info">
              <strong>{o.film.title}</strong>
              <span className={`interest-badge ${o.interest}`}>{formatInterest(o.interest)}</span>
            </div>
            {o.reason && <div className="omission-reason">{o.reason}</div>}
            {o.slotHint && <div className="omission-slot-hint">{o.slotHint}</div>}
            {canRequire && (
              <button
                type="button"
                className="omitted-require-button"
                onClick={() => onRequire(o.film.id)}
              >
                Require
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function renderAlternatives(alternatives) {
  if (!alternatives) return null
  const { sameSize, oneFewer } = alternatives
  if ((!sameSize || sameSize.length === 0) && !oneFewer) return null

  return (
    <div className="alternatives-section">
      <h3>Other Good Options</h3>

      {sameSize?.length > 0 && (
        <div className="alt-group">
          <h4>Same size, different films</h4>
          {sameSize.map(alt => (
            <div key={alt.filmSetKey} className="alt-card">
              {renderAltSummary(alt)}
            </div>
          ))}
        </div>
      )}

      {oneFewer && (
        <div className="alt-group">
          <h4>One fewer film</h4>
          <div className="alt-card">
            {renderAltSummary(oneFewer)}
            {oneFewer.extraWants > 0 && (
              <p className="alt-callout">
                Includes {oneFewer.extraWants} additional Want
                {oneFewer.extraWants > 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function renderAltSummary(alt) {
  const c = alt.coverage
  return (
    <>
      <div className="alt-headline">
        {alt.filmCount} films
        {c && (
          <span className="alt-coverage">
            {c.must.total > 0 && ` · ${c.must.included}/${c.must.total} Must`}
            {c.want.total > 0 && ` · ${c.want.included}/${c.want.total} Want`}
            {c.maybe.total > 0 && ` · ${c.maybe.included}/${c.maybe.total} Maybe`}
          </span>
        )}
      </div>
      {alt.adds?.length > 0 && (
        <div className="alt-diff">Adds: {alt.adds.map(f => f.title).join(', ')}</div>
      )}
      {alt.drops?.length > 0 && (
        <div className="alt-diff">Drops: {alt.drops.map(f => f.title).join(', ')}</div>
      )}
    </>
  )
}

function renderPlanByDay(
  planScreenings,
  interests,
  effectiveRequired,
  manualRequired,
  onRequire,
  onUnrequire,
  onExclude,
  slotOptions = {},
  pairCheck = {}
) {
  const {
    pairCheckResult,
    pairCheckLoading,
    pairCheckTarget,
    onCanSeeBoth,
    onRequireBoth,
    onDismissPairCheck
  } = pairCheck

  const byDate = {}
  planScreenings.forEach(screening => {
    if (!byDate[screening.date]) byDate[screening.date] = []
    byDate[screening.date].push(screening)
  })

  return Object.keys(byDate).sort().map(date => {
    const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    })

    return (
      <div key={date} className="plan-day">
        <h3 className="day-header">{dateLabel}</h3>
        <div className="day-screenings">
          {byDate[date].map(screening => {
            const film = films.find(f => f.id === screening.filmId)
            if (!film) return null
            const interest = interests[film.id]
            const isMust = interest === INTEREST_LEVELS.MUST_SEE
            const isRequired = effectiveRequired.has(film.id)
            const isManual = manualRequired.has(film.id)
            const options = slotOptions?.[screening.id] || []
            const isPairForThisRow =
              pairCheckTarget?.filmIdA === screening.filmId

            return (
              <div key={screening.id} className="plan-screening">
                <FilmPoster film={film} size="thumb" className="plan-screening-poster" />
                <div className="screening-time">
                  <strong>{formatTime(screening.startTime)}</strong>
                  <span className="venue">{screening.venue}</span>
                </div>
                <div className="screening-film">
                  <div className="film-title">{film.title}</div>
                  <div className="film-meta-row">
                    {film.runtime && <span>{film.runtime} min</span>}
                    {interest && (
                      <span className={`interest-badge ${interest}`}>
                        {formatInterest(interest)}
                      </span>
                    )}
                    {isRequired && (
                      <span className="required-badge">
                        {isMust ? 'Must · Required' : 'Required'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="screening-actions">
                  {isMust ? null : isManual ? (
                    <button
                      className="action-btn unrequire"
                      onClick={() => onUnrequire(film.id)}
                      title="Remove manual requirement (optimizer may drop this film)"
                    >
                      Unrequire
                    </button>
                  ) : (
                    <button
                      className="action-btn require"
                      onClick={() => onRequire(film.id)}
                      title="Require this film (optimizer may move its screening)"
                    >
                      Require
                    </button>
                  )}
                  <button
                    className="action-btn exclude"
                    onClick={() => onExclude(film.id)}
                    title="Exclude this film"
                  >
                    Exclude
                  </button>
                </div>
                <SlotOptionsPanel
                  plannedScreening={screening}
                  options={options}
                  onRequireFilm={onRequire}
                  onCanSeeBoth={onCanSeeBoth}
                  pairCheck={isPairForThisRow ? pairCheckResult : null}
                  pairCheckLoading={isPairForThisRow && pairCheckLoading}
                  pairCheckTargetFilmId={
                    isPairForThisRow ? pairCheckTarget?.filmIdB : null
                  }
                  onRequireBoth={onRequireBoth}
                  onDismissPairCheck={onDismissPairCheck}
                />
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
    'must-see': 'Must',
    'want-to-see': 'Want',
    maybe: 'Maybe',
    unrated: 'Unrated'
  }
  return labels[interest] || interest
}

function PlannerView() {
  const { resetPlannerSession } = usePlanner()
  return (
    <ErrorBoundary
      onReset={() => {}}
      onResetPlanner={() => resetPlannerSession()}
    >
      <PlannerViewInner />
    </ErrorBoundary>
  )
}

export default PlannerView
