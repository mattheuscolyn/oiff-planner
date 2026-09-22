import { getScreeningsForFilm, formatTime } from '../utils/festivalData'
import { INTEREST_LEVELS } from '../utils/userState'
import './FilmCard.css'

function FilmCard({ film, interest, onInterestChange, onFilmClick }) {
  const screenings = getScreeningsForFilm(film.id)

  const interestButtons = [
    { value: INTEREST_LEVELS.MUST_SEE, label: 'Must', emoji: '⭐' },
    { value: INTEREST_LEVELS.WANT_TO_SEE, label: 'Want', emoji: '👍' },
    { value: INTEREST_LEVELS.MAYBE, label: 'Maybe', emoji: '🤔' },
    { value: INTEREST_LEVELS.SKIP, label: 'Skip', emoji: '👎' },
    { value: INTEREST_LEVELS.SEEN, label: 'Seen', emoji: '✓' }
  ]

  const handleInterestClick = (e, value) => {
    e.stopPropagation()
    onInterestChange(film.id, interest === value ? null : value)
  }

  return (
    <article 
      className={`film-card ${interest || ''}`}
      onClick={onFilmClick}
    >
      <div className="film-card-header">
        <h3 className="film-title">{film.title}</h3>
        <div className="film-meta">
          {film.year} • {film.runtime} min • {film.director}
        </div>
        <div className="film-country">{film.country}</div>
      </div>

      <p className="film-synopsis">{film.synopsis}</p>

      <div className="film-screenings">
        <strong>Screenings:</strong>
        {screenings.map(s => (
          <div key={s.id} className="screening-info">
            {formatTime(s.startTime)} • {s.venue}
          </div>
        ))}
      </div>

      <div className="film-interest-controls" onClick={(e) => e.stopPropagation()}>
        {interestButtons.map(btn => (
          <button
            key={btn.value}
            className={`interest-btn ${interest === btn.value ? 'active' : ''}`}
            onClick={(e) => handleInterestClick(e, btn.value)}
            title={btn.label}
            aria-label={btn.label}
          >
            <span className="interest-emoji">{btn.emoji}</span>
            <span className="interest-label">{btn.label}</span>
          </button>
        ))}
      </div>
    </article>
  )
}

export default FilmCard
