/**
 * TMDB poster URL helpers + film poster resolution.
 * Uses only non-secret generated metadata from tmdb-posters.json.
 */

import tmdbPosters from '../data/tmdb-posters.json'

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

export const POSTER_SIZES = {
  thumb: 'w185',
  card: 'w342',
  detail: 'w500',
  conflict: 'w500'
}

/**
 * Build a TMDB CDN URL from a poster path.
 * @param {string|null|undefined} posterPath e.g. "/abc.jpg"
 * @param {'thumb'|'card'|'detail'|'conflict'|string} size
 */
export function tmdbPosterUrl(posterPath, size = 'card') {
  if (!posterPath || typeof posterPath !== 'string') return null
  if (!posterPath.startsWith('/')) return null
  const sizeKey = POSTER_SIZES[size] || size || POSTER_SIZES.card
  return `${TMDB_IMAGE_BASE}/${sizeKey}${posterPath}`
}

export function getTmdbRecord(filmId) {
  return tmdbPosters[filmId] || null
}

/**
 * Build ordered poster URL candidates: TMDB → Eventive.
 * Empty array means placeholder.
 */
export function getPosterCandidates(film, size = 'card') {
  if (!film) return []
  const candidates = []
  const record = getTmdbRecord(film.id)
  const tmdbUrl = tmdbPosterUrl(record?.posterPath, size)
  if (tmdbUrl) {
    candidates.push({ url: tmdbUrl, source: 'tmdb' })
  }
  if (film.poster) {
    // Avoid duplicating the same URL if Eventive somehow matched TMDB
    if (!candidates.some(c => c.url === film.poster)) {
      candidates.push({ url: film.poster, source: 'eventive' })
    }
  }
  return candidates
}

/**
 * Canonical poster resolution for a film object (first available candidate).
 * Priority: TMDB → Eventive film.poster → null (placeholder)
 */
export function resolveFilmPoster(film, size = 'card') {
  if (!film) {
    return { url: null, source: 'placeholder', alt: 'Film poster unavailable' }
  }

  const candidates = getPosterCandidates(film, size)
  const alt = candidates.length
    ? `${film.title} poster`
    : `${film.title} — no poster available`

  if (candidates.length === 0) {
    return { url: null, source: 'placeholder', alt }
  }

  const first = candidates[0]
  const record = getTmdbRecord(film.id)
  return {
    url: first.url,
    source: first.source,
    alt,
    tmdbId: record?.tmdbId,
    candidates
  }
}

/**
 * Attach poster metadata onto film objects (non-destructive).
 */
export function enrichFilmsWithPosters(filmList) {
  return filmList.map(film => {
    const record = getTmdbRecord(film.id)
    return {
      ...film,
      tmdb: record
        ? {
            id: record.tmdbId,
            posterPath: record.posterPath,
            matchConfidence: record.matchConfidence,
            matchedBy: record.matchedBy
          }
        : null,
      posterSources: {
        tmdbPath: record?.posterPath || null,
        eventive: film.poster || null
      }
    }
  })
}

/** Scan generated JSON for accidental secrets (defense in depth). */
export function assertNoSecretsInPosterData(data = tmdbPosters) {
  const blob = JSON.stringify(data)
  const forbidden = [
    /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\./, // JWT-like
    /api[_-]?key["']?\s*[:=]/i,
    /Bearer\s+[a-zA-Z0-9._-]+/i
  ]
  for (const re of forbidden) {
    if (re.test(blob)) {
      throw new Error('Possible secret detected in TMDB poster data')
    }
  }
  return true
}
