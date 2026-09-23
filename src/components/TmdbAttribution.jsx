import tmdbLogoPrimaryShort from '../assets/tmdb/tmdb-logo-primary-short.svg'
import './TmdbAttribution.css'

/**
 * TMDB attribution (required when using TMDB data/images).
 *
 * Logo: official “Primary short (blue)” SVG from
 * https://www.themoviedb.org/about/logos-attribution
 * bundled locally — do not modify proportions/colors.
 */
function TmdbAttribution() {
  return (
    <footer className="tmdb-attribution">
      <a
        className="tmdb-attribution-link"
        href="https://www.themoviedb.org/"
        target="_blank"
        rel="noopener noreferrer"
      >
        <img
          className="tmdb-logo"
          src={tmdbLogoPrimaryShort}
          alt="The Movie Database (TMDB)"
          width={96}
          height={41}
        />
      </a>
      <p>
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </footer>
  )
}

export default TmdbAttribution
