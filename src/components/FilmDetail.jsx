import { useEffect, useRef } from 'react'
import { 
  getScreeningsForFilm, 
  formatTime, 
  formatDate,
  getScreeningEndTime 
} from '../utils/festivalData'
import { INTEREST_LEVELS } from '../utils/userState'
import { useUserState } from '../contexts/UserStateContext'
import FilmPoster from './FilmPoster'
import './FilmDetail.css'

function FilmDetail({ film, onClose }) {
  const screenings = getScreeningsForFilm(film.id)
  const { interests, selectedScreeningIds, updateFilmInterest, toggleScreening } = useUserState()
  const interest = interests[film.id]
  const closeButtonRef = useRef(null)
  const previousFocusRef = useRef(null)

  useEffect(() => {
    previousFocusRef.current = document.activeElement
    document.body.style.overflow = 'hidden'
    
    setTimeout(() => {
      closeButtonRef.current?.focus()
    }, 100)

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)

    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', handleEscape)
      previousFocusRef.current?.focus()
    }
  }, [onClose])

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const handleToggleScreening = (screeningId) => {
    toggleScreening(screeningId)
  }

  const interestButtons = [
    { value: INTEREST_LEVELS.MUST_SEE, label: 'Must See' },
    { value: INTEREST_LEVELS.WANT_TO_SEE, label: 'Want to See' },
    { value: INTEREST_LEVELS.MAYBE, label: 'Maybe' },
    { value: INTEREST_LEVELS.SKIP, label: 'Skip' },
    { value: INTEREST_LEVELS.SEEN, label: 'Seen' }
  ]

  return (
    <div className="film-detail-backdrop" onClick={handleBackdropClick}>
      <div 
        className="film-detail-modal" 
        role="dialog" 
        aria-modal="true"
        aria-labelledby="film-detail-title"
      >
        <button 
          ref={closeButtonRef}
          className="detail-close" 
          onClick={onClose} 
          aria-label="Close"
        >
          ✕
        </button>

        <div className="detail-header">
          <FilmPoster film={film} size="detail" lazy={false} className="detail-poster" />
          <div className="detail-header-text">
            <h2 id="film-detail-title" className="detail-title">{film.title}</h2>
            <div className="detail-meta">
              {film.year} • {film.runtime} minutes
            </div>
            <div className="detail-credits">
              Directed by {film.director}
            </div>
            <div className="detail-country">{film.country}</div>
          </div>
        </div>

        <div className="detail-synopsis">
          <h3>Synopsis</h3>
          <p>{film.synopsis}</p>
        </div>

        <div className="detail-interest">
          <h3>My Interest</h3>
          <div className="detail-interest-buttons">
            {interestButtons.map(btn => (
              <button
                key={btn.value}
                className={`interest-detail-btn ${interest === btn.value ? 'active' : ''}`}
                onClick={() => updateFilmInterest(film.id, interest === btn.value ? null : btn.value)}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        <div className="detail-screenings">
          <h3>Screenings</h3>
          {screenings.map(screening => {
            const selected = selectedScreeningIds.includes(screening.id)
            return (
              <div key={screening.id} className="detail-screening-item">
                <div className="screening-time-info">
                  <div className="screening-date">{formatDate(screening.date)}</div>
                  <div className="screening-time">
                    {formatTime(screening.startTime)} – {formatTime(getScreeningEndTime(screening))}
                  </div>
                  <div className="screening-venue">{screening.venue}</div>
                </div>
                <button
                  className={`screening-add-btn ${selected ? 'selected' : ''}`}
                  onClick={() => handleToggleScreening(screening.id)}
                >
                  {selected ? 'Remove from Plan' : 'Add to Plan'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default FilmDetail
