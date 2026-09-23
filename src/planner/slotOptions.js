/**
 * Local slot alternatives for a finished plan.
 *
 * "Could replace this slot?" = attendance-valid screening that:
 *   1) overlaps the planned screening (competes for that time), AND
 *   2) fits when that planned screening is removed and the rest of the plan is held fixed.
 *
 * Distinct from global "Can I See Both?" which re-runs the optimizer.
 */

import { INTEREST_LEVELS } from '../utils/userState'
import { screeningsOverlap } from '../utils/planValidator'

const INTEREST_RANK = {
  [INTEREST_LEVELS.WANT_TO_SEE]: 0,
  [INTEREST_LEVELS.MAYBE]: 1,
  // unrated / null
  unrated: 2
}

function interestRank(interest) {
  if (interest === INTEREST_LEVELS.WANT_TO_SEE) return INTEREST_RANK[INTEREST_LEVELS.WANT_TO_SEE]
  if (interest === INTEREST_LEVELS.MAYBE) return INTEREST_RANK[INTEREST_LEVELS.MAYBE]
  return INTEREST_RANK.unrated
}

function isEligibleAlternate(filmId, interests, excludedFilmSet, planFilmIds) {
  if (planFilmIds.has(filmId)) return false
  if (excludedFilmSet.has(filmId)) return false
  const interest = interests[filmId]
  if (interest === INTEREST_LEVELS.SKIP || interest === INTEREST_LEVELS.SEEN) return false
  // Must films are required and should already be in a feasible plan
  if (interest === INTEREST_LEVELS.MUST_SEE) return false
  return true
}

/**
 * Hold all plan screenings fixed except `removedId`, insert `candidate`.
 */
export function canLocallyReplace(planScreenings, removedScreeningId, candidate, filmMap) {
  const rest = planScreenings.filter(s => s.id !== removedScreeningId)
  if (rest.some(s => s.filmId === candidate.filmId)) return false

  const candidateFilm = filmMap.get(candidate.filmId)
  for (const other of rest) {
    const otherFilm = filmMap.get(other.filmId)
    if (screeningsOverlap(candidate, other, candidateFilm, otherFilm)) {
      return false
    }
  }
  return true
}

function availabilityBadge({
  onlyPublishedScreening,
  onlyAttendanceValidScreening,
  onlyCurrentPlanFit,
  attendanceValidScreeningCount,
  otherAttendanceScreenings
}) {
  if (onlyPublishedScreening) {
    return { code: 'only-screening', label: 'Only screening' }
  }
  if (onlyAttendanceValidScreening) {
    return {
      code: 'only-attendance',
      label: 'Only screening during your attendance'
    }
  }
  if (onlyCurrentPlanFit) {
    return {
      code: 'only-plan-fit',
      label: 'Only way it fits this plan'
    }
  }
  const extra = Math.max(0, attendanceValidScreeningCount - 1)
  if (extra > 0) {
    return {
      code: 'has-others',
      label:
        extra === 1
          ? '1 other attendance screening'
          : `${extra} other attendance screenings`,
      otherScreenings: otherAttendanceScreenings
    }
  }
  return { code: 'none', label: null, otherScreenings: [] }
}

function compareSlotOptions(a, b) {
  const ir = interestRank(a.interest) - interestRank(b.interest)
  if (ir !== 0) return ir

  // Prefer scarcer films
  if (a.onlyPublishedScreening !== b.onlyPublishedScreening) {
    return a.onlyPublishedScreening ? -1 : 1
  }
  if (a.attendanceValidScreeningCount !== b.attendanceValidScreeningCount) {
    return a.attendanceValidScreeningCount - b.attendanceValidScreeningCount
  }
  if (a.date !== b.date) return a.date.localeCompare(b.date)
  if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime)
  return (a.filmTitle || '').localeCompare(b.filmTitle || '')
}

/**
 * @param {object} args
 * @param {Array} args.planScreenings
 * @param {Map} args.filmMap
 * @param {Map} args.filmToScreenings - all published
 * @param {Map} args.filmToFeasibleScreenings - attendance-valid
 * @param {object} args.interests
 * @param {Set|Array} args.excludedFilmIds
 * @param {Iterable} args.planFilmIds
 * @param {Array} [args.films] - for iterating candidates
 */
export function buildSlotOptions({
  planScreenings,
  filmMap,
  filmToScreenings,
  filmToFeasibleScreenings,
  interests = {},
  excludedFilmIds = [],
  planFilmIds,
  films
}) {
  const excluded = excludedFilmIds instanceof Set
    ? excludedFilmIds
    : new Set(excludedFilmIds)
  const inPlan = planFilmIds instanceof Set
    ? planFilmIds
    : new Set(planFilmIds)

  const candidateFilms = (films || [...filmMap.values()]).filter(f =>
    isEligibleAlternate(f.id, interests, excluded, inPlan)
  )

  /** @type {Record<string, object[]>} */
  const slotOptions = {}
  /** filmId -> planned screening ids it can replace */
  const filmToReplaceableSlots = new Map()

  for (const planned of planScreenings) {
    const plannedFilm = filmMap.get(planned.filmId)
    const byFilm = new Map()

    for (const film of candidateFilms) {
      const published = filmToScreenings.get(film.id) || []
      const attendanceValid = filmToFeasibleScreenings.get(film.id) || []
      const localFits = []

      for (const candidate of attendanceValid) {
        if (!screeningsOverlap(candidate, planned, film, plannedFilm)) continue
        if (!canLocallyReplace(planScreenings, planned.id, candidate, filmMap)) continue
        localFits.push(candidate)
      }

      if (localFits.length === 0) continue

      localFits.sort((a, b) =>
        a.date === b.date
          ? a.startTime.localeCompare(b.startTime)
          : a.date.localeCompare(b.date)
      )
      const chosen = localFits[0]

      const onlyPublishedScreening = published.length === 1
      const onlyAttendanceValidScreening =
        attendanceValid.length === 1 && published.length > 1
      const onlyCurrentPlanFit =
        localFits.length === 1 && attendanceValid.length > 1

      const otherAttendanceScreenings = attendanceValid
        .filter(s => s.id !== chosen.id)
        .map(s => ({
          screeningId: s.id,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime || null,
          venue: s.venue
        }))

      const badge = availabilityBadge({
        onlyPublishedScreening,
        onlyAttendanceValidScreening,
        onlyCurrentPlanFit,
        attendanceValidScreeningCount: attendanceValid.length,
        otherAttendanceScreenings
      })

      const option = {
        filmId: film.id,
        filmTitle: film.title,
        screeningId: chosen.id,
        date: chosen.date,
        startTime: chosen.startTime,
        endTime: chosen.endTime || null,
        venue: chosen.venue,
        interest: interests[film.id] || null,
        attendanceValidScreeningCount: attendanceValid.length,
        totalPublishedScreeningCount: published.length,
        localFitScreeningCount: localFits.length,
        onlyPublishedScreening,
        onlyAttendanceValidScreening,
        onlyCurrentPlanFit,
        overlapsPlannedScreening: true,
        availabilityBadge: badge,
        otherAttendanceScreenings
      }

      byFilm.set(film.id, option)

      if (!filmToReplaceableSlots.has(film.id)) {
        filmToReplaceableSlots.set(film.id, [])
      }
      filmToReplaceableSlots.get(film.id).push({
        plannedScreeningId: planned.id,
        plannedFilmId: planned.filmId,
        plannedFilmTitle: plannedFilm?.title || planned.filmId,
        plannedDate: planned.date,
        plannedStartTime: planned.startTime,
        alternateScreeningId: chosen.id
      })
    }

    const ranked = [...byFilm.values()].sort(compareSlotOptions)
    slotOptions[planned.id] = ranked
  }

  return { slotOptions, filmToReplaceableSlots }
}

/**
 * Attach could-replace hints onto omission entries.
 */
export function enrichOmissionsWithSlotHints(omissions, filmToReplaceableSlots) {
  if (!omissions?.length) return omissions || []
  return omissions.map(o => {
    const slots = filmToReplaceableSlots.get(o.film.id) || []
    if (slots.length === 0) {
      return { ...o, couldReplaceSlots: [], slotHint: null }
    }
    const first = slots[0]
    const slotHint =
      slots.length === 1
        ? `Could replace ${first.plannedFilmTitle} (${formatCompactWhen(first.plannedDate, first.plannedStartTime)})`
        : `Could fit in ${slots.length} current schedule slots`
    return {
      ...o,
      couldReplaceSlots: slots,
      slotHint
    }
  })
}

function formatCompactWhen(date, startTime) {
  try {
    const day = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short'
    })
    return `${day} ${startTime}`
  } catch {
    return `${date} ${startTime}`
  }
}

/**
 * Diff current plan screenings vs a pair-check plan for UI.
 */
export function summarizePairCheckDiff(currentPlan, pairPlan, filmMap) {
  const currentIds = new Set(currentPlan.filmIds || currentPlan.screenings.map(s => s.filmId))
  const pairIds = new Set(pairPlan.filmIds || pairPlan.screenings.map(s => s.filmId))
  const adds = []
  const drops = []
  for (const id of pairIds) {
    if (!currentIds.has(id)) {
      const f = filmMap.get(id)
      adds.push({ id, title: f?.title || id })
    }
  }
  for (const id of currentIds) {
    if (!pairIds.has(id)) {
      const f = filmMap.get(id)
      drops.push({ id, title: f?.title || id })
    }
  }
  return { adds, drops }
}
