import { useState, useMemo } from 'react'
import {
  festivalDates,
  getScreeningById,
  getFilmById,
  formatDate,
  formatTime,
  getScreeningEndTime,
  getScreeningsForFilm,
  findConflictingScreenings
} from '../utils/festivalData'
import {
  getSelectedScreenings,
  getFilmInterests,
  INTEREST_LEVELS
} from '../utils/userState'
import FilmDetail from './FilmDetail'
import './MyPlanView.css'

function MyPlanView({ onUpdate }) {
  const [selectedFilm, setSelectedFilm] = useState(null)

  const selectedScreeningIds = useMemo(() => getSelectedScreenings(), [])
  const interests = useMemo(() => getFilmInterests(), [])

  const planByDay = useMemo(() => {
    const selectedScreenings = selectedScreeningIds
      .map(id => getScreeningById(id))
      .filter(Boolean)

    const byDay = festivalDates.map(date => {
      const dayScreenings = selectedScreenings
        .filter(s => s.date === date)
        .map(screening => {
          const film = getFilmById(screening.filmId)
          const conflicts = findConflictingScreenings(screening, selectedScreenings)
          return { screening, film, conflicts }
        })
        .sort((a, b) => a.screening.startTime.localeCompare(b.screening.startTime))

      let stats = null
      if (dayScreenings.length > 0) {
        const totalRuntime = dayScreenings.reduce((sum, item) => sum + item.film.runtime, 0)
        const firstStart = dayScreenings[0].screening.startTime
        const lastScreening = dayScreenings[dayScreenings.length - 1].screening
        const lastEnd = getScreeningEndTime(lastScreening)

        stats = {
          count: dayScreenings.length,
          totalRuntime,
          firstStart,
          lastEnd
        }
      }

      return { date, screenings: dayScreenings, stats }
    }).filter(day => day.screenings.length > 0)

    return byDay
  }, [selectedScreeningIds])

  const notScheduled = useMemo(() => {
    const selectedFilmIds = new Set(
      selectedScreeningIds
        .map(id => getScreeningById(id))
        .filter(Boolean)
        .map(s => s.filmId)
    )

    const interestedFilms = Object.entries(interests)
      .filter(([, interest]) => 
        interest === INTEREST_LEVELS.MUST_SEE || 
        interest === INTEREST_LEVELS.WANT_TO_SEE
      )
      .map(([filmId, interest]) => {
        const film = getFilmById(filmId)
        if (!film || selectedFilmIds.has(filmId)) return null

        const allScreenings = getScreeningsForFilm(filmId)
        const selectedScreenings = selectedScreeningIds
          .map(id => getScreeningById(id))
          .filter(Boolean)

        const conflictingScreenings = allScreenings.filter(screening =>
          findConflictingScreenings(screening, selectedScreenings).length > 0
        )

        let reason = 'No screening selected yet'
        if (conflictingScreenings.length === allScreenings.length) {
          reason = 'All screenings conflict with your plan'
        } else if (conflictingScreenings.length > 0 && allScreenings.length > 1) {
          reason = 'Some screenings conflict, but alternates available'
        }

        return { film, interest, reason, allScreenings }
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.interest === b.interest) {
          return a.film.title.localeCompare(b.film.title)
        }
        return a.interest === INTEREST_LEVELS.MUST_SEE ? -1 : 1
      })

    return interestedFilms
  }, [selectedScreeningIds, interests])

  return (
    <div className="my-plan-view">
      {planByDay.length === 0 && notScheduled.length === 0 && (
        <div className="empty-state">
          <h2>Your plan is empty</h2>
          <p>Browse films and add screenings to build your festival itinerary.</p>
        </div>
      )}

      {planByDay.length > 0 && (
        <section className="plan-scheduled">
          <h2 className="plan-section-title">My Schedule</h2>
          
          {planByDay.map(day => (
            <article key={day.date} className="plan-day">
              <h3 className="plan-day-header">{formatDate(day.date)}</h3>
              
              {day.stats && (
                <div className="day-stats">
                  <span>{day.stats.count} film{day.stats.count > 1 ? 's' : ''}</span>
                  <span>{day.stats.totalRuntime} min total</span>
                  <span>{formatTime(day.stats.firstStart)} – {formatTime(day.stats.lastEnd)}</span>
                </div>
              )}

              <div className="plan-screenings">
                {day.screenings.map(({ screening, film, conflicts }) => (
                  <div 
                    key={screening.id} 
                    className={`plan-screening ${conflicts.length > 0 ? 'has-conflict' : ''}`}
                    onClick={() => setSelectedFilm(film)}
                  >
                    <div className="plan-screening-time">
                      <div className="plan-time-start">{formatTime(screening.startTime)}</div>
                      <div className="plan-time-end">{formatTime(getScreeningEndTime(screening))}</div>
                    </div>

                    <div className="plan-screening-info">
                      <h4 className="plan-film-title">{film.title}</h4>
                      <div className="plan-screening-meta">
                        {film.runtime} min • {screening.venue}
                      </div>
                      {conflicts.length > 0 && (
                        <div className="plan-conflict-warning">
                          ⚠️ Conflicts with {conflicts.map(c => {
                            const conflictFilm = getFilmById(c.filmId)
                            return conflictFilm.title
                          }).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}

      {notScheduled.length > 0 && (
        <section className="plan-not-scheduled">
          <h2 className="plan-section-title">Not Currently Scheduled</h2>
          <p className="section-description">
            Films you're interested in that aren't in your plan yet.
          </p>

          <div className="not-scheduled-list">
            {notScheduled.map(({ film, interest, reason, allScreenings }) => (
              <article 
                key={film.id} 
                className="not-scheduled-item"
                onClick={() => setSelectedFilm(film)}
              >
                <div className="not-scheduled-header">
                  <h4 className="not-scheduled-title">{film.title}</h4>
                  <span className={`interest-badge ${interest}`}>
                    {interest === INTEREST_LEVELS.MUST_SEE ? 'Must See' : 'Want to See'}
                  </span>
                </div>
                <div className="not-scheduled-reason">{reason}</div>
                <div className="not-scheduled-screenings">
                  {allScreenings.length} screening{allScreenings.length > 1 ? 's' : ''} available
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {selectedFilm && (
        <FilmDetail
          film={selectedFilm}
          interest={getFilmInterest(selectedFilm.id)}
          onClose={() => setSelectedFilm(null)}
          onInterestChange={() => onUpdate()}
          onUpdate={onUpdate}
        />
      )}
    </div>
  )
}

export default MyPlanView
