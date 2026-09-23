import { useState } from 'react'
import { resolveFilmPoster } from '../utils/tmdbPosters'
import './FilmPoster.css'

/**
 * Shared film poster with TMDB → Eventive → placeholder fallback.
 */
function FilmPoster({ film, size = 'card', className = '', lazy = true }) {
  const resolved = resolveFilmPoster(film, size)
  const [failed, setFailed] = useState(false)

  const showPlaceholder = !resolved.url || failed

  return (
    <div
      className={`film-poster film-poster--${size} source-${showPlaceholder ? 'placeholder' : resolved.source} ${className}`.trim()}
      aria-hidden={showPlaceholder ? undefined : undefined}
    >
      {!showPlaceholder ? (
        <img
          src={resolved.url}
          alt={resolved.alt}
          loading={lazy ? 'lazy' : 'eager'}
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="film-poster-placeholder" role="img" aria-label={resolved.alt}>
          <span className="film-poster-placeholder-title">{film?.title || 'No poster'}</span>
        </div>
      )}
    </div>
  )
}

export default FilmPoster
