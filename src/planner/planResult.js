/**
 * Build user-facing plan result metadata: coverage, omissions, alternative diffs.
 */

import { INTEREST_LEVELS } from '../utils/userState'
import { filmSetKey } from './requiredFilms'

/**
 * Eligible rated pools for coverage denominators.
 */
export function countEligibleByInterest(films, interests, excludedFilms = []) {
  const excluded = new Set(excludedFilms)
  const totals = {
    must: 0,
    want: 0,
    maybe: 0,
    unrated: 0
  }

  for (const film of films) {
    if (excluded.has(film.id)) continue
    const interest = interests[film.id]
    if (interest === INTEREST_LEVELS.SKIP || interest === INTEREST_LEVELS.SEEN) continue
    if (interest === INTEREST_LEVELS.MUST_SEE) totals.must++
    else if (interest === INTEREST_LEVELS.WANT_TO_SEE) totals.want++
    else if (interest === INTEREST_LEVELS.MAYBE) totals.maybe++
    else totals.unrated++
  }

  return totals
}

export function buildCoverage(planFilmIds, interests, eligibleTotals) {
  const included = {
    must: 0,
    want: 0,
    maybe: 0,
    unrated: 0
  }

  for (const id of planFilmIds) {
    const interest = interests[id]
    if (interest === INTEREST_LEVELS.MUST_SEE) included.must++
    else if (interest === INTEREST_LEVELS.WANT_TO_SEE) included.want++
    else if (interest === INTEREST_LEVELS.MAYBE) included.maybe++
    else if (
      interest !== INTEREST_LEVELS.SKIP &&
      interest !== INTEREST_LEVELS.SEEN
    ) {
      included.unrated++
    }
  }

  return {
    filmCount: planFilmIds.size ?? planFilmIds.length,
    must: { included: included.must, total: eligibleTotals.must },
    want: { included: included.want, total: eligibleTotals.want },
    maybe: { included: included.maybe, total: eligibleTotals.maybe },
    unrated: { included: included.unrated, total: eligibleTotals.unrated }
  }
}

/**
 * Omitted eligible Must/Want/Maybe films with derived reasons.
 */
export function buildOmissions({
  films,
  interests,
  excludedFilms = [],
  planFilmIds,
  requiredFilmIds = [],
  filmToFeasibleScreenings,
  planScreenings = [],
  filmMap
}) {
  const excluded = new Set(excludedFilms)
  const inPlan = new Set(planFilmIds)
  const required = new Set(requiredFilmIds)
  const omissions = []

  for (const film of films) {
    if (excluded.has(film.id) || inPlan.has(film.id)) continue
    const interest = interests[film.id]
    if (
      interest !== INTEREST_LEVELS.MUST_SEE &&
      interest !== INTEREST_LEVELS.WANT_TO_SEE &&
      interest !== INTEREST_LEVELS.MAYBE
    ) {
      continue
    }

    const feasible = filmToFeasibleScreenings?.get(film.id) || []
    let reason = 'No compatible screening in this plan'

    if (feasible.length === 0) {
      reason = 'No screening within your attendance window'
    } else if (required.size > 0) {
      // Check whether every feasible screening overlaps some plan screening
      let allConflict = feasible.length > 0
      for (const candidate of feasible) {
        let conflicts = false
        for (const taken of planScreenings) {
          if (taken.filmId === film.id) continue
          if (screeningsOverlapSimple(candidate, taken, filmMap)) {
            conflicts = true
            break
          }
        }
        if (!conflicts) {
          allConflict = false
          break
        }
      }
      if (allConflict) {
        reason = 'Conflicts with films already in this plan'
      }
    }

    omissions.push({
      film,
      interest,
      reason,
      wasRequired: required.has(film.id)
    })
  }

  // Must omissions are severe — sort Must first
  const rank = {
    [INTEREST_LEVELS.MUST_SEE]: 0,
    [INTEREST_LEVELS.WANT_TO_SEE]: 1,
    [INTEREST_LEVELS.MAYBE]: 2
  }
  omissions.sort((a, b) => (rank[a.interest] ?? 9) - (rank[b.interest] ?? 9))

  return omissions
}

function screeningsOverlapSimple(s1, s2, filmMap) {
  if (s1.date !== s2.date) return false
  const f1 = filmMap?.get(s1.filmId)
  const f2 = filmMap?.get(s2.filmId)
  const start1 = toMinutes(s1.startTime)
  const end1 = s1.endTime ? toMinutes(s1.endTime) : start1 + (f1?.runtime || 0)
  const start2 = toMinutes(s2.startTime)
  const end2 = s2.endTime ? toMinutes(s2.endTime) : start2 + (f2?.runtime || 0)
  return start1 < end2 && start2 < end1
}

function toMinutes(timeStr) {
  if (!timeStr || !timeStr.includes(':')) return 0
  const [h, m] = timeStr.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return 0
  return h * 60 + m
}

/**
 * Diff two film sets for alternative cards.
 */
export function diffFilmSets(currentIds, alternativeIds, filmMap) {
  const current = new Set(currentIds)
  const alt = new Set(alternativeIds)
  const adds = []
  const drops = []

  for (const id of alt) {
    if (!current.has(id)) {
      adds.push(filmMap.get(id) || { id, title: id })
    }
  }
  for (const id of current) {
    if (!alt.has(id)) {
      drops.push(filmMap.get(id) || { id, title: id })
    }
  }

  return { adds, drops }
}

export function summarizeAlternative(alt, currentFilmIds, interests, filmMap, eligibleTotals) {
  const altIds = alt.filmIds instanceof Set ? alt.filmIds : new Set(alt.filmIds)
  const current = currentFilmIds instanceof Set ? currentFilmIds : new Set(currentFilmIds)
  const { adds, drops } = diffFilmSets(current, altIds, filmMap)
  const coverage = buildCoverage(altIds, interests, eligibleTotals)

  const currentWant = [...current].filter(
    id => interests[id] === INTEREST_LEVELS.WANT_TO_SEE
  ).length
  const altWant = coverage.want.included

  return {
    filmSetKey: filmSetKey(altIds),
    filmCount: altIds.size,
    coverage,
    adds: adds.map(f => ({ id: f.id, title: f.title })),
    drops: drops.map(f => ({ id: f.id, title: f.title })),
    extraWants: Math.max(0, altWant - currentWant),
    screenings: alt.screenings,
    preferenceTuple: alt.preferenceTuple
  }
}
