/**
 * Enrich OIFF films with TMDB poster metadata.
 *
 * Auth (never logged):
 *   TMDB_API_READ_ACCESS_TOKEN  → Authorization: Bearer … (preferred)
 *   TMDB_API_KEY                → api_key query param (fallback)
 *
 * Output: src/data/tmdb-posters.json (non-secret poster paths only)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const FILMS_PATH = join(ROOT, 'src/data/films.json')
const OVERRIDES_PATH = join(ROOT, 'scripts/tmdb-overrides.json')
const OUT_PATH = join(ROOT, 'src/data/tmdb-posters.json')
const REPORT_PATH = join(ROOT, 'scripts/tmdb-enrichment-report.md')

const TMDB_API = 'https://api.themoviedb.org/3'
const RATE_MS = 260

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function getAuth() {
  const bearer = process.env.TMDB_API_READ_ACCESS_TOKEN || process.env.API_READ_ACCESS_TOKEN
  const apiKey = process.env.TMDB_API_KEY || process.env.API_KEY
  if (bearer) return { type: 'bearer', bearer }
  if (apiKey) return { type: 'api_key', apiKey }
  throw new Error(
    'Missing TMDB credentials. Set TMDB_API_READ_ACCESS_TOKEN (preferred) or TMDB_API_KEY.'
  )
}

function loadJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    if (fallback !== null) return fallback
    throw e
  }
}

export function normalizeTitle(title) {
  if (!title) return ''
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeDirector(director) {
  if (!director) return []
  return director
    .split(/[,&/]| and /i)
    .map(part => normalizeTitle(part))
    .filter(Boolean)
}

function titlesMatch(a, b) {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return false
  if (na === nb) return true
  // Allow "The X" vs "X"
  if (na.replace(/^the /, '') === nb.replace(/^the /, '')) return true
  return false
}

function yearClose(oiffYear, tmdbDate) {
  if (!oiffYear || !tmdbDate) return { exact: false, near: false }
  const ty = Number(String(tmdbDate).slice(0, 4))
  if (!ty) return { exact: false, near: false }
  const oy = Number(oiffYear)
  return {
    exact: ty === oy,
    near: Math.abs(ty - oy) <= 1
  }
}

function directorsOverlap(oiffDirector, tmdbCrew) {
  const ours = new Set(normalizeDirector(oiffDirector))
  if (ours.size === 0) return false
  const theirs = (tmdbCrew || [])
    .filter(c => c.job === 'Director')
    .map(c => normalizeTitle(c.name))
  return theirs.some(name => {
    if (ours.has(name)) return true
    for (const o of ours) {
      if (name.includes(o) || o.includes(name)) return true
    }
    return false
  })
}

async function tmdbFetch(path, auth, query = {}) {
  const url = new URL(`${TMDB_API}${path}`)
  const headers = { Accept: 'application/json' }
  if (auth.type === 'bearer') {
    headers.Authorization = `Bearer ${auth.bearer}`
  } else {
    url.searchParams.set('api_key', auth.apiKey)
  }
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }

  const res = await fetch(url, { headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TMDB ${res.status} ${path}: ${text.slice(0, 120)}`)
  }
  return res.json()
}

async function searchMovie(auth, title, year) {
  const data = await tmdbFetch('/search/movie', auth, {
    query: title,
    include_adult: false,
    year: year || undefined,
    primary_release_year: year || undefined
  })
  return data.results || []
}

async function movieCredits(auth, tmdbId) {
  const data = await tmdbFetch(`/movie/${tmdbId}/credits`, auth)
  return data.crew || []
}

async function movieDetails(auth, tmdbId) {
  return tmdbFetch(`/movie/${tmdbId}`, auth)
}

/**
 * Score a TMDB candidate against an OIFF film.
 * Returns null if too weak to accept.
 */
export function scoreCandidate(film, candidate, { directorMatched = false } = {}) {
  const titleExact = titlesMatch(film.title, candidate.title) ||
    titlesMatch(film.title, candidate.original_title)
  const { exact: yearExact, near: yearNear } = yearClose(film.year, candidate.release_date)

  let score = 0
  const reasons = []

  if (titleExact) {
    score += 50
    reasons.push('title')
  } else {
    // Weak title similarity: shared normalized tokens
    const a = new Set(normalizeTitle(film.title).split(' ').filter(t => t.length > 2))
    const b = new Set(
      normalizeTitle(candidate.title || '').split(' ').filter(t => t.length > 2)
    )
    let shared = 0
    for (const t of a) if (b.has(t)) shared++
    if (a.size && shared / a.size >= 0.75) {
      score += 25
      reasons.push('title-partial')
    } else {
      return null
    }
  }

  if (yearExact) {
    score += 30
    reasons.push('year')
  } else if (yearNear) {
    score += 15
    reasons.push('year-near')
  }

  if (directorMatched) {
    score += 40
    reasons.push('director')
  }

  // Require strong evidence: title+year OR title+director OR title-exact with high score
  const acceptable =
    (titleExact && yearExact) ||
    (titleExact && directorMatched) ||
    (titleExact && yearNear && directorMatched) ||
    score >= 90

  if (!acceptable) return null

  let confidence = 'medium'
  if (titleExact && yearExact && directorMatched) confidence = 'high'
  else if (titleExact && (yearExact || directorMatched)) confidence = 'high'
  else if (titleExact && yearNear) confidence = 'medium'
  else confidence = 'low'

  if (confidence === 'low') return null

  return {
    score,
    confidence,
    matchedBy: reasons.join('+'),
    tmdbId: candidate.id,
    title: candidate.title,
    originalTitle: candidate.original_title,
    releaseDate: candidate.release_date || null,
    posterPath: candidate.poster_path || null
  }
}

async function matchFilm(auth, film, overrideId) {
  if (overrideId) {
    const details = await movieDetails(auth, overrideId)
    await sleep(RATE_MS)
    return {
      status: 'override',
      record: {
        tmdbId: details.id,
        title: details.title,
        originalTitle: details.original_title,
        releaseDate: details.release_date || null,
        posterPath: details.poster_path || null,
        matchConfidence: 'high',
        matchedBy: 'manual-override'
      }
    }
  }

  const years = [film.year, film.year - 1, film.year + 1].filter(
    (y, i, a) => y && a.indexOf(y) === i
  )

  /** @type {Map<number, object>} */
  const candidates = new Map()

  for (const year of [...years, null]) {
    const results = await searchMovie(auth, film.title, year)
    await sleep(RATE_MS)
    for (const r of results.slice(0, 8)) {
      if (!candidates.has(r.id)) candidates.set(r.id, r)
    }
  }

  if (candidates.size === 0) {
    return { status: 'unmatched', record: null, notes: 'no search results' }
  }

  const scored = []
  for (const candidate of candidates.values()) {
    let directorMatched = false
    // Fetch credits when title matches but year is soft, or multiple candidates
    const titleOk =
      titlesMatch(film.title, candidate.title) ||
      titlesMatch(film.title, candidate.original_title)
    if (titleOk && film.director) {
      const crew = await movieCredits(auth, candidate.id)
      await sleep(RATE_MS)
      directorMatched = directorsOverlap(film.director, crew)
    }
    const s = scoreCandidate(film, candidate, { directorMatched })
    if (s) scored.push(s)
  }

  scored.sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    return {
      status: 'ambiguous',
      record: null,
      notes: `no confident match among ${candidates.size} candidates`,
      candidates: [...candidates.values()].slice(0, 5).map(c => ({
        id: c.id,
        title: c.title,
        date: c.release_date
      }))
    }
  }

  const best = scored[0]
  const second = scored[1]
  // Ambiguous if two high-scoring distinct films
  if (
    second &&
    second.confidence === 'high' &&
    best.confidence === 'high' &&
    second.score >= best.score - 10 &&
    second.tmdbId !== best.tmdbId
  ) {
    return {
      status: 'ambiguous',
      record: null,
      notes: `top scores tied/close: ${best.tmdbId} (${best.score}) vs ${second.tmdbId} (${second.score})`,
      candidates: scored.slice(0, 3)
    }
  }

  return {
    status: 'matched',
    record: {
      tmdbId: best.tmdbId,
      title: best.title,
      originalTitle: best.originalTitle,
      releaseDate: best.releaseDate,
      posterPath: best.posterPath,
      matchConfidence: best.confidence,
      matchedBy: best.matchedBy
    }
  }
}

function formatReport(rows, summary) {
  const lines = [
    '# TMDB enrichment report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- OIFF films: ${summary.total}`,
    `- Matched to TMDB: ${summary.matched}`,
    `- With poster: ${summary.withPoster}`,
    `- Matched without poster: ${summary.withoutPoster}`,
    `- Unmatched: ${summary.unmatched}`,
    `- Ambiguous: ${summary.ambiguous}`,
    `- Manual overrides: ${summary.overrides}`,
    '',
    '## Matches',
    '',
    '| OIFF title | OIFF year | OIFF director | TMDB title | TMDB year | TMDB ID | Poster | Confidence | Reason |',
    '|---|---|---|---|---|---|---|---|---|'
  ]

  for (const row of rows.filter(r => r.record)) {
    const r = row.record
    const ty = r.releaseDate ? r.releaseDate.slice(0, 4) : ''
    lines.push(
      `| ${row.oiffTitle} | ${row.oiffYear || ''} | ${row.oiffDirector || ''} | ${r.title} | ${ty} | ${r.tmdbId} | ${r.posterPath || '—'} | ${r.matchConfidence} | ${r.matchedBy} |`
    )
  }

  const problems = rows.filter(r => !r.record)
  if (problems.length) {
    lines.push('', '## Unmatched / ambiguous', '')
    for (const row of problems) {
      lines.push(
        `- **${row.oiffTitle}** (${row.oiffId}): ${row.status} — ${row.notes || ''}`
      )
    }
  }

  lines.push('')
  return lines.join('\n')
}

async function main() {
  const auth = getAuth()
  console.log(`[enrich:tmdb] Auth mode: ${auth.type}`)

  const festival = loadJson(FILMS_PATH)
  const films = festival.films || []
  const overrides = loadJson(OVERRIDES_PATH, {})

  const posters = {}
  const rows = []
  const summary = {
    total: films.length,
    matched: 0,
    withPoster: 0,
    withoutPoster: 0,
    unmatched: 0,
    ambiguous: 0,
    overrides: 0
  }

  for (const film of films) {
    console.log(`[enrich:tmdb] ${film.title}`)
    const overrideId = overrides[film.id] || null
    let result
    try {
      result = await matchFilm(auth, film, overrideId)
    } catch (err) {
      console.error(`[enrich:tmdb] ERROR ${film.title}: ${err.message}`)
      result = { status: 'unmatched', record: null, notes: err.message }
    }

    rows.push({
      oiffId: film.id,
      oiffTitle: film.title,
      oiffYear: film.year,
      oiffDirector: film.director,
      status: result.status,
      notes: result.notes,
      record: result.record
    })

    if (result.status === 'override') summary.overrides++
    if (result.record) {
      summary.matched++
      posters[film.id] = {
        tmdbId: result.record.tmdbId,
        title: result.record.title,
        posterPath: result.record.posterPath,
        matchConfidence: result.record.matchConfidence,
        matchedBy: result.record.matchedBy,
        releaseDate: result.record.releaseDate
      }
      if (result.record.posterPath) summary.withPoster++
      else summary.withoutPoster++
    } else if (result.status === 'ambiguous') {
      summary.ambiguous++
    } else {
      summary.unmatched++
    }
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, `${JSON.stringify(posters, null, 2)}\n`, 'utf8')
  writeFileSync(REPORT_PATH, formatReport(rows, summary), 'utf8')

  console.log('[enrich:tmdb] Summary:', summary)
  console.log(`[enrich:tmdb] Wrote ${OUT_PATH}`)
  console.log(`[enrich:tmdb] Wrote ${REPORT_PATH}`)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  main().catch(err => {
    console.error(err.message || err)
    process.exit(1)
  })
}
