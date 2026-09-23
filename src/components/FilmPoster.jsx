import { useState } from 'react'
import { getPosterCandidates } from '../utils/tmdbPosters'
import './FilmPoster.css'

/**
 * Shared film poster with TMDB → Eventive → placeholder fallback.
 * Runtime image-load failures advance through the candidate chain.
 */
function FilmPoster({ film, size = 'card', className = '', lazy = true }) {
  const candidates = getPosterCandidates(film, size)
  const sourceKey = `${film?.id ?? ''}|${size}|${film?.poster ?? ''}|${film?.tmdb?.posterPath ?? ''}`

  const [candidateIndex, setCandidateIndex] = useState(0)
  const [activeKey, setActiveKey] = useState(sourceKey)

  // Reset candidate index when the film/size/source identity changes
  // (render-time adjust — avoids leaking failed state across films).
  if (activeKey !== sourceKey) {
    setActiveKey(sourceKey)
    setCandidateIndex(0)
  }

  const index = activeKey === sourceKey ? candidateIndex : 0
  const active = candidates[index] || null
  const showPlaceholder = !active
  const alt = film?.title
    ? showPlaceholder
      ? `${film.title} — no poster available`
      : `${film.title} poster`
    : 'Film poster unavailable'

  const sourceClass = showPlaceholder ? 'placeholder' : active.source

  return (
    <div
      className={`film-poster film-poster--${size} source-${sourceClass} ${className}`.trim()}
    >
      {!showPlaceholder ? (
        <img
          key={`${sourceKey}-${active.source}-${index}`}
          src={active.url}
          alt={alt}
          loading={lazy ? 'lazy' : 'eager'}
          decoding="async"
          onError={() => {
            setCandidateIndex(i => i + 1)
          }}
        />
      ) : (
        <div className="film-poster-placeholder" role="img" aria-label={alt}>
          <span className="film-poster-placeholder-title">{film?.title || 'No poster'}</span>
        </div>
      )}
    </div>
  )
}

export default FilmPoster
