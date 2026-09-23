import './TmdbAttribution.css'

/**
 * TMDB attribution (required when using TMDB data/images).
 * Logo is a simplified mark for attribution; not a TMDB endorsement.
 */
function TmdbAttribution() {
  return (
    <footer className="tmdb-attribution">
      <a
        className="tmdb-attribution-link"
        href="https://www.themoviedb.org/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="The Movie Database"
      >
        <svg
          className="tmdb-logo"
          viewBox="0 0 300 131"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-hidden="true"
        >
          <title>TMDB</title>
          <path
            fill="#01b4e4"
            d="M150.3 16.2c-6.4 0-11.6 5.2-11.6 11.6v75.3c0 6.4 5.2 11.6 11.6 11.6s11.6-5.2 11.6-11.6V27.8c0-6.4-5.2-11.6-11.6-11.6zm-48.4 0c-6.4 0-11.6 5.2-11.6 11.6v51.2L69.2 31.4c-1.8-5.3-7.6-8.2-12.9-6.4-5.3 1.8-8.2 7.6-6.4 12.9l28.4 82.3c1.5 4.3 5.5 7.1 10 7.1 0.1 0 0.2 0 0.3 0 4.7-0.2 8.8-3.4 9.9-8.1l9.5-40.1v35.1c0 6.4 5.2 11.6 11.6 11.6s11.6-5.2 11.6-11.6V27.8c0-6.4-5.2-11.6-11.6-11.6h-27.1zm146.9 0h-41.5c-6.4 0-11.6 5.2-11.6 11.6s5.2 11.6 11.6 11.6h13.3v63.7c0 6.4 5.2 11.6 11.6 11.6s11.6-5.2 11.6-11.6V39.4h16.6c6.4 0 11.6-5.2 11.6-11.6s-5.2-11.6-11.6-11.6h-1.6zM48.5 16.2C21.7 16.2 0 37.9 0 64.7s21.7 48.5 48.5 48.5 48.5-21.7 48.5-48.5S75.3 16.2 48.5 16.2zm0 73.8c-14 0-25.3-11.3-25.3-25.3S34.5 39.4 48.5 39.4s25.3 11.3 25.3 25.3-11.3 25.3-25.3 25.3z"
          />
        </svg>
      </a>
      <p>
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </footer>
  )
}

export default TmdbAttribution
