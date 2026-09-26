import {
  formatDate,
  formatTime,
  getFilmById,
  getScreeningById,
  getScreeningEndTime
} from '../utils/festivalData'
import { INTEREST_LEVELS } from '../utils/userState'
import FilmPoster from './FilmPoster'
import {
  describePrioritizeChoice
} from '../planner/conflictResolution'
import './RequiredConflictView.css'

function interestLabel(level) {
  switch (level) {
    case INTEREST_LEVELS.MUST_SEE:
      return 'Must'
    case INTEREST_LEVELS.WANT_TO_SEE:
      return 'Want'
    case INTEREST_LEVELS.MAYBE:
      return 'Maybe'
    default:
      return 'Unrated'
  }
}

function ScreeningEvidenceRow({ screening, film, overlaps, conflictFilms }) {
  const end = screening.endTime || getScreeningEndTime(screening)
  const related = overlaps.filter(
    o => o.screeningAId === screening.id || o.screeningBId === screening.id
  )

  return (
    <div className={`conflict-screening ${related.length ? 'is-overlap' : ''}`}>
      <div className="conflict-screening-when">
        <strong>{formatDate(screening.date)}</strong>
        <span>
          {formatTime(screening.startTime)} – {formatTime(end)}
        </span>
        <span className="conflict-screening-venue">{screening.venue}</span>
      </div>
      {related.map(o => {
        const otherScreeningId =
          o.screeningAId === screening.id ? o.screeningBId : o.screeningAId
        const otherFilmId = o.filmAId === film.id ? o.filmBId : o.filmAId
        const other = getScreeningById(otherScreeningId)
        const otherFilm = conflictFilms.find(f => f.id === otherFilmId)
        if (!other) return null
        return (
          <div key={`${o.screeningAId}-${o.screeningBId}`} className="conflict-overlap-note">
            Conflicts with {otherFilm?.title || 'the other film'} at{' '}
            {formatTime(other.startTime)}
          </div>
        )
      })}
    </div>
  )
}

function ConflictFilmCard({
  film,
  interest,
  isRequired,
  feasibleScreeningIds,
  overlaps,
  conflictFilms,
  onPrioritize,
  prioritizeCopy,
  showPrioritize
}) {
  const feasible = feasibleScreeningIds
    .map(id => getScreeningById(id))
    .filter(Boolean)
    .sort((a, b) =>
      a.date === b.date
        ? a.startTime.localeCompare(b.startTime)
        : a.date.localeCompare(b.date)
    )

  return (
    <article className="conflict-film-card">
      <div className="conflict-film-top">
        <FilmPoster film={film} size="conflict" lazy={false} />
        <div className="conflict-film-identity">
          <h3>{film.title}</h3>
          <div className="conflict-film-meta">
            {[film.year, film.director].filter(Boolean).join(' · ')}
          </div>
          <div className="conflict-film-badges">
            <span className={`interest-badge ${interest || 'unrated'}`}>
              {interestLabel(interest)}
            </span>
            {isRequired && <span className="required-badge">Must</span>}
          </div>
        </div>
      </div>

      <div className="conflict-showtimes">
        <h4>Available screenings</h4>
        {feasible.length === 0 ? (
          <p className="conflict-empty">No screenings within your attendance window.</p>
        ) : (
          feasible.map(s => (
            <ScreeningEvidenceRow
              key={s.id}
              screening={s}
              film={film}
              overlaps={overlaps}
              conflictFilms={conflictFilms}
            />
          ))
        )}
      </div>

      {showPrioritize && (
        <div className="conflict-choose">
          <p className="conflict-choose-detail">{prioritizeCopy.detail}</p>
          <button
            type="button"
            className="conflict-prioritize-btn"
            onClick={() => onPrioritize(film.id)}
          >
            {prioritizeCopy.headline}
          </button>
        </div>
      )}
    </article>
  )
}

/**
 * Structured required-film conflict / unavailable resolution UI.
 */
function RequiredConflictView({
  plan,
  interests,
  onPrioritizeFilm,
  onRelaxFilm,
  onBackToRatings,
  onBackToAttendance
}) {
  if (plan?.reasonCode === 'required-film-unavailable' && plan.unavailable) {
    const film = getFilmById(plan.unavailable.filmId)
    const published = (plan.unavailable.publishedScreeningIds || [])
      .map(id => getScreeningById(id))
      .filter(Boolean)

    return (
      <div className="required-conflict-view">
        <header className="conflict-header">
          <h2>No screening during your attendance</h2>
          <p>
            <strong>{film?.title || 'This Must film'}</strong> has no showing within your
            arrival/departure window. Move it off Must or adjust attendance.
          </p>
        </header>

        {film && (
          <div className="conflict-film-grid single">
            <article className="conflict-film-card">
              <div className="conflict-film-top">
                <FilmPoster film={film} size="conflict" lazy={false} />
                <div className="conflict-film-identity">
                  <h3>{film.title}</h3>
                  <div className="conflict-film-meta">
                    {[film.year, film.director].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
              <div className="conflict-showtimes">
                <h4>Published screenings</h4>
                {published.length === 0 ? (
                  <p className="conflict-empty">No published screenings found.</p>
                ) : (
                  published.map(s => {
                    const assessment =
                      plan.unavailable.screenings?.find(row => row.screeningId === s.id) ||
                      null
                    const label =
                      assessment?.label ||
                      (/school screening/i.test(s.name || '')
                        ? 'School screening (not available for festival planning)'
                        : 'Outside your attendance window')
                    const isOk = assessment?.eligible === true
                    return (
                      <div
                        key={s.id}
                        className={`conflict-screening ${isOk ? 'inside' : 'outside'}`}
                      >
                        <div className="conflict-screening-when">
                          <strong>{formatDate(s.date)}</strong>
                          <span>
                            {formatTime(s.startTime)} –{' '}
                            {formatTime(s.endTime || getScreeningEndTime(s))}
                          </span>
                          <span className="conflict-screening-venue">{s.venue}</span>
                        </div>
                        <div className="conflict-overlap-note">{label}</div>
                      </div>
                    )
                  })
                )}
              </div>
              <div className="conflict-choose">
                <button
                  type="button"
                  className="conflict-prioritize-btn secondary"
                  onClick={() => onRelaxFilm(film.id)}
                >
                  Move {film.title} to Want
                </button>
              </div>
            </article>
          </div>
        )}

        <div className="conflict-secondary-actions">
          <button type="button" className="linkish" onClick={onBackToAttendance}>
            Adjust attendance
          </button>
          <button type="button" className="linkish" onClick={onBackToRatings}>
            Back to ratings
          </button>
        </div>
      </div>
    )
  }

  const conflict = plan?.conflict
  if (!conflict?.filmIds?.length) {
    return (
      <div className="required-conflict-view">
        <header className="conflict-header">
          <h2>Unable to generate plan</h2>
          <p>{plan?.reason || 'Must films cannot be scheduled together.'}</p>
        </header>
        <div className="conflict-secondary-actions">
          <button type="button" className="linkish" onClick={onBackToRatings}>
            Back to ratings
          </button>
        </div>
      </div>
    )
  }

  const conflictFilms = conflict.filmIds.map(id => getFilmById(id)).filter(Boolean)
  const overlaps = conflict.overlaps || []
  const isPair = conflictFilms.length === 2

  return (
    <div className="required-conflict-view">
      <header className="conflict-header">
        <h2>
          {isPair
            ? 'Two Must films can’t both fit'
            : `${conflictFilms.length} Must films can’t all fit`}
        </h2>
        <p>
          {isPair
            ? 'There is no combination of available screenings that lets you see both of these films. Choose which one should stay Must.'
            : 'There is no schedule that includes all of these Must films. Move one to Want, then we will try again.'}
        </p>
      </header>

      <div className={`conflict-film-grid ${isPair ? 'pair' : 'multi'}`}>
        {conflictFilms.map(film => {
          const entry = conflict.films.find(f => f.filmId === film.id)
          const interest = interests[film.id]
          const isRequired = interest === INTEREST_LEVELS.MUST_SEE

          let prioritizeCopy = null
          if (isPair) {
            const other = conflictFilms.find(f => f.id !== film.id)
            prioritizeCopy = describePrioritizeChoice({
              chosenFilm: film,
              otherFilm: other,
              interests
            })
          }

          return (
            <ConflictFilmCard
              key={film.id}
              film={film}
              interest={interest}
              isRequired={isRequired}
              feasibleScreeningIds={entry?.feasibleScreeningIds || []}
              overlaps={overlaps}
              conflictFilms={conflictFilms}
              showPrioritize={isPair}
              prioritizeCopy={prioritizeCopy}
              onPrioritize={onPrioritizeFilm}
            />
          )
        })}
      </div>

      {!isPair && (
        <div className="conflict-relax-list">
          <h3>Move one Must to Want</h3>
          <p>
            That film stays eligible and may still appear if it fits after regenerating.
          </p>
          {conflictFilms.map(film => (
            <button
              key={film.id}
              type="button"
              className="conflict-prioritize-btn secondary"
              onClick={() => onRelaxFilm(film.id)}
            >
              Move {film.title} to Want
            </button>
          ))}
        </div>
      )}

      <div className="conflict-secondary-actions">
        <button type="button" className="linkish" onClick={onBackToRatings}>
          Back to ratings
        </button>
      </div>
    </div>
  )
}

export default RequiredConflictView
