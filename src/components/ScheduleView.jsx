import { useState, useMemo } from 'react'
import { 
  festivalDates, 
  getScreeningsByDate,
  getFilmById,
  formatDate,
  formatTime,
  getScreeningEndTime,
  screeningsOverlap,
  getScreeningsForFilm
} from '../utils/festivalData'
import { 
  getFilmInterest, 
  getSelectedScreenings,
  INTEREST_LEVELS 
} from '../utils/userState'
import FilmDetail from './FilmDetail'
import './ScheduleView.css'

function ScheduleView({ onUpdate }) {
  const [filter, setFilter] = useState('all')
  const [selectedFilm, setSelectedFilm] = useState(null)

  const selectedScreeningIds = useMemo(() => {
    return getSelectedScreenings()
  }, [])

  const scheduleByDay = useMemo(() => {
    return festivalDates.map(date => {
      let screenings = getScreeningsByDate(date)

      screenings = screenings.map(screening => {
        const film = getFilmById(screening.filmId)
        const interest = getFilmInterest(film.id)
        const isSelected = selectedScreeningIds.includes(screening.id)
        
        const conflicts = screenings.filter(other => 
          other.id !== screening.id && screeningsOverlap(screening, other)
        )

        const hasAlternate = getScreeningsForFilm(screening.filmId).length > 1

        return {
          ...screening,
          film,
          interest,
          isSelected,
          conflicts,
          hasAlternate
        }
      })

      if (filter === 'interested') {
        screenings = screenings.filter(s => 
          s.interest === INTEREST_LEVELS.MUST_SEE || 
          s.interest === INTEREST_LEVELS.WANT_TO_SEE
        )
      } else if (filter === 'must-see') {
        screenings = screenings.filter(s => 
          s.interest === INTEREST_LEVELS.MUST_SEE
        )
      }

      screenings.sort((a, b) => {
        if (a.startTime < b.startTime) return -1
        if (a.startTime > b.startTime) return 1
        return 0
      })

      return { date, screenings }
    })
  }, [filter, selectedScreeningIds])

  const getInterestBadge = (interest) => {
    if (interest === INTEREST_LEVELS.MUST_SEE) return { text: 'Must See', class: 'must-see' }
    if (interest === INTEREST_LEVELS.WANT_TO_SEE) return { text: 'Want', class: 'want-to-see' }
    if (interest === INTEREST_LEVELS.MAYBE) return { text: 'Maybe', class: 'maybe' }
    return null
  }

  return (
    <div className="schedule-view">
      <div className="schedule-controls">
        <div className="control-group">
          <label htmlFor="schedule-filter">Filter:</label>
          <select 
            id="schedule-filter"
            value={filter} 
            onChange={(e) => setFilter(e.target.value)}
            className="control-select"
          >
            <option value="all">All Screenings</option>
            <option value="interested">My Interested Films</option>
            <option value="must-see">Must See Only</option>
          </select>
        </div>
      </div>

      <div className="schedule-days">
        {scheduleByDay.map(day => (
          <section key={day.date} className="schedule-day">
            <h2 className="day-header">{formatDate(day.date)}</h2>
            
            {day.screenings.length === 0 ? (
              <p className="empty-day">No screenings match your filter.</p>
            ) : (
              <div className="screenings-list">
                {day.screenings.map(screening => {
                  const interestBadge = getInterestBadge(screening.interest)
                  const hasConflicts = screening.conflicts.length > 0

                  return (
                    <article 
                      key={screening.id} 
                      className={`screening-item ${hasConflicts ? 'has-conflict' : ''} ${screening.isSelected ? 'in-plan' : ''}`}
                      onClick={() => setSelectedFilm(screening.film)}
                    >
                      <div className="screening-time-block">
                        <div className="screening-start">{formatTime(screening.startTime)}</div>
                        <div className="screening-end">{formatTime(getScreeningEndTime(screening))}</div>
                      </div>

                      <div className="screening-details">
                        <h3 className="screening-title">
                          {screening.film.title}
                          {screening.isSelected && (
                            <span className="in-plan-badge">In Plan</span>
                          )}
                        </h3>
                        <div className="screening-meta">
                          {screening.film.runtime} min • {screening.venue}
                        </div>
                        {interestBadge && (
                          <span className={`interest-badge ${interestBadge.class}`}>
                            {interestBadge.text}
                          </span>
                        )}
                        
                        {hasConflicts && (
                          <div className="conflict-warning">
                            ⚠️ Conflicts with {screening.conflicts.length} other screening{screening.conflicts.length > 1 ? 's' : ''}
                            {screening.hasAlternate && (
                              <span className="alternate-note"> • Alternate screening available</span>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        ))}
      </div>

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

export default ScheduleView
