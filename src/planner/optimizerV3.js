/**
 * Festival Plan Optimizer V3 — film-level required set + preference frontier
 *
 * Primary: maximize distinct film count among plans that include all required films
 * Secondary lex: Must > Want > Maybe > Unrated
 *
 * Alternatives are deduplicated by film set (not screening assignment).
 */

import { INTEREST_LEVELS } from '../utils/userState'
import {
  resolveRequiredFilms,
  filmSetKey,
  preferenceScore,
  comparePreferenceTuples
} from './requiredFilms'
import {
  countEligibleByInterest,
  buildCoverage,
  buildOmissions,
  summarizeAlternative
} from './planResult'

/** Default interactive budget — long enough to often prove on this fixed dataset */
export const DEFAULT_TIME_BUDGET_MS = 45000

/**
 * Generate plan using daily enumeration + global combination.
 */
export function generatePlanV3(config) {
  const {
    films,
    screenings,
    interests = {},
    constraints = {},
    attendanceConstraints = {},
    timeBudgetMs = DEFAULT_TIME_BUDGET_MS,
    onProgress = null
  } = config

  const startTime = performance.now()

  const requiredResolution = resolveRequiredFilms(interests, constraints)
  if (requiredResolution.contradiction) {
    return infeasibleResult(
      requiredResolution.contradiction.reason,
      startTime,
      { contradiction: requiredResolution.contradiction }
    )
  }

  const data = precomputeData(
    films,
    screenings,
    interests,
    constraints,
    attendanceConstraints,
    requiredResolution.requiredFilmIds
  )

  // Required films must have attendance-feasible screenings
  for (const filmId of data.requiredFilmIds) {
    const feasible = data.filmToFeasibleScreenings.get(filmId) || []
    if (feasible.length === 0) {
      const film = data.filmMap.get(filmId)
      return infeasibleResult(
        `Required film "${film?.title || filmId}" has no screening within your attendance window.`,
        startTime,
        { requiredFilmIds: data.requiredFilmIds }
      )
    }
  }

  // Quick check: required films cannot all be scheduled together
  const requiredFeasible = checkRequiredFeasibility(data)
  if (!requiredFeasible.ok) {
    return infeasibleResult(requiredFeasible.reason, startTime, {
      requiredFilmIds: data.requiredFilmIds,
      conflictingRequired: requiredFeasible.conflicting
    })
  }

  console.log(`[OptimizerV3] Candidate films: ${data.candidateFilms.length}`)
  console.log(`[OptimizerV3] Required films: ${data.requiredFilmIds.length}`)
  console.log(`[OptimizerV3] Candidate screenings: ${data.candidateScreenings.length}`)

  const dailySchedules = enumerateDailySchedules(data)
  const remainingBudget = Math.max(50, timeBudgetMs - (performance.now() - startTime))

  const result = findOptimalGlobalCombination(
    dailySchedules,
    data,
    interests,
    remainingBudget,
    onProgress
  )

  const totalMs = performance.now() - startTime
  console.log(`[OptimizerV3] Total time: ${totalMs.toFixed(1)}ms`)

  return enrichResult(result, data, interests, constraints, totalMs)
}

function infeasibleResult(reason, startTime, extra = {}) {
  return {
    screenings: [],
    interestCounts: {},
    filmCount: 0,
    infeasible: true,
    reason,
    coverage: null,
    omissions: [],
    alternatives: { sameSize: [], oneFewer: null },
    requiredFilmIds: extra.requiredFilmIds || [],
    metadata: {
      maxDistinctFilms: 0,
      optimalityProven: true,
      combinationsExplored: 0,
      elapsedMs: performance.now() - startTime,
      status: 'infeasible',
      ...extra
    }
  }
}

function precomputeData(
  films,
  screenings,
  interests,
  constraints,
  attendanceConstraints,
  requiredFilmIds
) {
  const {
    excludedFilms = [],
    includeSkip = false,
    includeSeen = false
  } = constraints

  const { attendanceDays = {}, availabilityByDate = {} } = attendanceConstraints
  const excludedFilmSet = new Set(excludedFilms)
  const requiredFilmSet = new Set(requiredFilmIds)

  const filmMap = new Map()
  films.forEach(f => filmMap.set(f.id, f))

  const screeningMap = new Map()
  const filmToScreenings = new Map()
  screenings.forEach(s => {
    screeningMap.set(s.id, s)
    if (!filmToScreenings.has(s.filmId)) filmToScreenings.set(s.filmId, [])
    filmToScreenings.get(s.filmId).push(s)
  })

  const candidateFilms = []
  const screeningsByDay = new Map()
  const filmToFeasibleScreenings = new Map()

  for (const film of films) {
    if (excludedFilmSet.has(film.id)) continue

    const interest = interests[film.id]
    if (!includeSkip && interest === INTEREST_LEVELS.SKIP) continue
    if (!includeSeen && interest === INTEREST_LEVELS.SEEN) continue

    const filmScreenings = filmToScreenings.get(film.id) || []
    const feasibleScreenings = filmScreenings.filter(s =>
      isScreeningWithinAttendance(s, film, attendanceDays, availabilityByDate)
    )

    // Still record empty feasible list for required validation
    filmToFeasibleScreenings.set(film.id, feasibleScreenings)

    if (feasibleScreenings.length === 0) continue

    candidateFilms.push(film)
    feasibleScreenings.forEach(s => {
      if (!screeningsByDay.has(s.date)) screeningsByDay.set(s.date, [])
      screeningsByDay.get(s.date).push(s)
    })
  }

  return {
    filmMap,
    screeningMap,
    filmToScreenings,
    filmToFeasibleScreenings,
    candidateFilms,
    candidateScreenings: Array.from(screeningsByDay.values()).flat(),
    screeningsByDay,
    excludedFilmSet,
    requiredFilmIds: [...requiredFilmSet],
    requiredFilmSet,
    attendanceDays,
    availabilityByDate,
    interests,
    films
  }
}

/**
 * Backtracking: can we pick one feasible screening per required film with no overlaps?
 */
function checkRequiredFeasibility(data) {
  const ids = data.requiredFilmIds
  if (ids.length === 0) return { ok: true }

  const options = ids.map(id => data.filmToFeasibleScreenings.get(id) || [])

  let conflicting = null

  function search(index, chosen) {
    if (index >= options.length) return true

    for (const screening of options[index]) {
      const film = data.filmMap.get(screening.filmId)
      let ok = true
      for (const prev of chosen) {
        const prevFilm = data.filmMap.get(prev.filmId)
        if (screeningsOverlapMinutes(screening, prev, film, prevFilm)) {
          ok = false
          conflicting = [screening.filmId, prev.filmId]
          break
        }
      }
      if (!ok) continue
      chosen.push(screening)
      if (search(index + 1, chosen)) return true
      chosen.pop()
    }
    return false
  }

  if (search(0, [])) return { ok: true }

  const titles = (conflicting || ids.slice(0, 2))
    .map(id => data.filmMap.get(id)?.title || id)
    .join(' and ')

  return {
    ok: false,
    conflicting: conflicting || ids,
    reason:
      `No schedule can include all required films` +
      (conflicting ? ` (${titles} conflict).` : '.')
  }
}

function enumerateDailySchedules(data) {
  const dailySchedules = new Map()
  const maxPerDay = new Map()

  for (const [date, dayScreenings] of data.screeningsByDay.entries()) {
    console.log(`[OptimizerV3] Enumerating schedules for ${date} (${dayScreenings.length} screenings)...`)

    const sorted = dayScreenings.slice().sort(
      (a, b) => getScreeningStartMinutes(a) - getScreeningStartMinutes(b)
    )

    const schedules = []

    function enumerate(index, current, usedFilms) {
      schedules.push({
        screenings: current.slice(),
        films: new Set(usedFilms),
        filmCount: usedFilms.size,
        requiredCount: countRequiredIn(usedFilms, data.requiredFilmSet)
      })

      for (let i = index; i < sorted.length; i++) {
        const screening = sorted[i]
        if (usedFilms.has(screening.filmId)) continue
        const film = data.filmMap.get(screening.filmId)

        let overlaps = false
        for (const existing of current) {
          const existingFilm = data.filmMap.get(existing.filmId)
          if (screeningsOverlapMinutes(screening, existing, film, existingFilm)) {
            overlaps = true
            break
          }
        }

        if (!overlaps) {
          current.push(screening)
          usedFilms.add(screening.filmId)
          enumerate(i + 1, current, usedFilms)
          current.pop()
          usedFilms.delete(screening.filmId)
        }
      }
    }

    enumerate(0, [], new Set())
    const pruned = pruneDominatedSchedules(schedules)
    // Prefer schedules that cover more required films, then more films
    pruned.sort((a, b) => {
      if (b.requiredCount !== a.requiredCount) return b.requiredCount - a.requiredCount
      return b.filmCount - a.filmCount
    })

    maxPerDay.set(date, pruned.reduce((m, s) => Math.max(m, s.filmCount), 0))
    console.log(`[OptimizerV3]   ${schedules.length} schedules found, ${pruned.length} after pruning`)
    dailySchedules.set(date, pruned)
  }

  data.maxPerDay = maxPerDay
  return dailySchedules
}

function countRequiredIn(filmSet, requiredFilmSet) {
  let n = 0
  for (const id of requiredFilmSet) {
    if (filmSet.has(id)) n++
  }
  return n
}

function pruneDominatedSchedules(schedules) {
  const nonDominated = []
  for (const schedule of schedules) {
    let isDominated = false
    for (const other of schedules) {
      if (schedule === other) continue
      if (other.filmCount > schedule.filmCount) {
        const allIncluded = Array.from(schedule.films).every(id => other.films.has(id))
        if (allIncluded) {
          isDominated = true
          break
        }
      }
    }
    if (!isDominated) nonDominated.push(schedule)
  }
  return nonDominated
}

function findOptimalGlobalCombination(dailySchedules, data, interests, timeBudgetMs, onProgress) {
  const startTime = performance.now()
  const deadline = startTime + timeBudgetMs

  // Process days with fewer schedules first (reduces branching early)
  const days = Array.from(dailySchedules.keys()).sort(
    (a, b) => (dailySchedules.get(a)?.length || 0) - (dailySchedules.get(b)?.length || 0)
  )

  console.log(`[OptimizerV3] Finding optimal global combination...`)
  console.log(`[OptimizerV3] Days to combine: ${days.length}`)

  // Precompute optimistic remaining capacity
  const suffixMax = new Array(days.length + 1).fill(0)
  for (let i = days.length - 1; i >= 0; i--) {
    const date = days[i]
    suffixMax[i] = suffixMax[i + 1] + (data.maxPerDay.get(date) || 0)
  }

  let bestTuple = null
  let bestSolution = null
  let bestKey = null
  let combinationsExplored = 0
  let timedOut = false

  // Bounded alternative storage (film-set deduped)
  const sameSizeAlts = new Map() // key -> alt, max ~8
  let oneFewerBest = null

  function considerSolution(globalScreenings, globalFilms) {
    for (const id of data.requiredFilmIds) {
      if (!globalFilms.has(id)) return
    }

    const pref = preferenceScore(globalFilms, interests)
    const key = filmSetKey(globalFilms)

    if (!bestSolution || comparePreferenceTuples(pref.tuple, bestTuple) > 0) {
      // Demote previous best into alternative pools if useful
      if (bestSolution) {
        ingestAlternative(bestKey, bestSolution, bestTuple)
      }
      bestSolution = {
        screenings: globalScreenings.slice(),
        filmIds: new Set(globalFilms),
        ...pref,
        interestCounts: {
          'must-see': pref.mustSeeCount,
          'want-to-see': pref.wantToSeeCount,
          maybe: pref.maybeCount,
          unrated: pref.unratedCount
        }
      }
      bestTuple = pref.tuple
      bestKey = key
      // Drop same-size alts that are no longer max
      for (const [k, alt] of sameSizeAlts) {
        if (alt.filmCount < bestTuple[0]) sameSizeAlts.delete(k)
      }
      if (oneFewerBest && oneFewerBest.filmCount < bestTuple[0] - 1) {
        oneFewerBest = null
      }
      return
    }

    if (pref.filmCount === bestTuple[0] && key !== bestKey) {
      ingestSameSize(key, globalScreenings, globalFilms, pref)
    } else if (pref.filmCount === bestTuple[0] - 1) {
      ingestOneFewer(globalScreenings, globalFilms, pref)
    }
  }

  function ingestAlternative(key, solution, tuple) {
    if (!solution || !key) return
    if (tuple[0] === bestTuple[0] && key !== bestKey) {
      ingestSameSize(key, solution.screenings, solution.filmIds, {
        filmCount: tuple[0],
        mustSeeCount: tuple[1],
        wantToSeeCount: tuple[2],
        maybeCount: tuple[3],
        unratedCount: tuple[4],
        tuple
      })
    } else if (tuple[0] === bestTuple[0] - 1) {
      ingestOneFewer(solution.screenings, solution.filmIds, {
        filmCount: tuple[0],
        mustSeeCount: tuple[1],
        wantToSeeCount: tuple[2],
        maybeCount: tuple[3],
        unratedCount: tuple[4],
        tuple
      })
    }
  }

  function ingestSameSize(key, screenings, filmIds, pref) {
    const existing = sameSizeAlts.get(key)
    if (existing && comparePreferenceTuples(pref.tuple, existing.preferenceTuple) <= 0) return
    sameSizeAlts.set(key, {
      filmIds: filmIds instanceof Set ? new Set(filmIds) : new Set(filmIds),
      screenings: screenings.slice(),
      preferenceTuple: pref.tuple,
      filmCount: pref.filmCount
    })
    if (sameSizeAlts.size > 8) {
      // Drop weakest by preference
      let worstKey = null
      let worstTuple = null
      for (const [k, alt] of sameSizeAlts) {
        if (!worstTuple || comparePreferenceTuples(alt.preferenceTuple, worstTuple) < 0) {
          worstTuple = alt.preferenceTuple
          worstKey = k
        }
      }
      if (worstKey) sameSizeAlts.delete(worstKey)
    }
  }

  function ingestOneFewer(screenings, filmIds, pref) {
    if (
      oneFewerBest &&
      comparePreferenceTuples(pref.tuple, oneFewerBest.preferenceTuple) <= 0
    ) {
      return
    }
    oneFewerBest = {
      filmIds: filmIds instanceof Set ? new Set(filmIds) : new Set(filmIds),
      screenings: screenings.slice(),
      preferenceTuple: pref.tuple,
      filmCount: pref.filmCount
    }
  }

  function combine(dayIndex, globalScreenings, globalFilms, requiredCovered) {
    combinationsExplored++

    if (combinationsExplored % 5000 === 0) {
      if (performance.now() >= deadline) {
        timedOut = true
        return
      }
      if (onProgress) {
        onProgress({
          combinationsExplored,
          bestFilmCount: bestSolution?.filmCount || 0,
          elapsedMs: performance.now() - startTime
        })
      }
    }

    if (performance.now() >= deadline) {
      timedOut = true
      return
    }

    if (dayIndex >= days.length) {
      considerSolution(globalScreenings, globalFilms)
      return
    }

    // Optimistic upper bound on film count
    if (bestTuple) {
      const optimistic = globalFilms.size + suffixMax[dayIndex]
      if (optimistic < bestTuple[0]) return
    }

    // Remaining required films must still be coverable from remaining days' screenings
    const requiredLeft = data.requiredFilmIds.length - requiredCovered
    if (requiredLeft > 0) {
      let canCover = 0
      for (let d = dayIndex; d < days.length; d++) {
        for (const sched of dailySchedules.get(days[d])) {
          // rough: any schedule that adds a missing required
          for (const fid of sched.films) {
            if (data.requiredFilmSet.has(fid) && !globalFilms.has(fid)) {
              canCover++
            }
          }
        }
      }
      // This bound is loose; skip aggressive prune if uncertain
      void canCover
    }

    const daySchedules = dailySchedules.get(days[dayIndex])

    for (const daySchedule of daySchedules) {
      if (dayScheduleConflictsWithGlobal(daySchedule, globalScreenings, globalFilms, data.filmMap)) {
        continue
      }

      let addedRequired = 0
      const addedFilms = []
      for (const fid of daySchedule.films) {
        if (data.requiredFilmSet.has(fid)) addedRequired++
        globalFilms.add(fid)
        addedFilms.push(fid)
      }
      const addedScreenings = daySchedule.screenings
      for (const s of addedScreenings) globalScreenings.push(s)

      combine(dayIndex + 1, globalScreenings, globalFilms, requiredCovered + addedRequired)

      // backtrack
      globalScreenings.length -= addedScreenings.length
      for (const fid of addedFilms) globalFilms.delete(fid)

      if (timedOut) return
    }

    // Skip day
    combine(dayIndex + 1, globalScreenings, globalFilms, requiredCovered)
  }

  combine(0, [], new Set(), 0)

  const elapsed = performance.now() - startTime
  const optimalityProven = !timedOut

  console.log(`[OptimizerV3] Combinations explored: ${combinationsExplored}`)
  console.log(`[OptimizerV3] Best solution: ${bestSolution?.filmCount || 0} films`)
  console.log(`[OptimizerV3] Same-size alts: ${sameSizeAlts.size}`)
  console.log(`[OptimizerV3] Timed out: ${timedOut}`)
  console.log(`[OptimizerV3] Optimality proven: ${optimalityProven}`)

  if (!bestSolution) {
    return {
      infeasible: true,
      reason:
        data.requiredFilmIds.length > 0
          ? 'No schedule can include all required films.'
          : 'No valid schedule found',
      screenings: [],
      filmCount: 0,
      sameSizeAlts: [],
      oneFewerBest: null,
      combinationsExplored,
      optimalityProven,
      elapsedMs: elapsed
    }
  }

  return {
    infeasible: false,
    bestSolution,
    sameSizeAlts: Array.from(sameSizeAlts.values()),
    oneFewerBest,
    combinationsExplored,
    optimalityProven,
    elapsedMs: elapsed
  }
}

function enrichResult(raw, data, interests, constraints, totalMs) {
  if (raw.infeasible && !raw.bestSolution) {
    return {
      screenings: [],
      interestCounts: {},
      filmCount: 0,
      infeasible: true,
      reason: raw.reason,
      coverage: null,
      omissions: [],
      alternatives: { sameSize: [], oneFewer: null },
      requiredFilmIds: data.requiredFilmIds,
      metadata: {
        maxDistinctFilms: 0,
        optimalityProven: raw.optimalityProven ?? true,
        combinationsExplored: raw.combinationsExplored || 0,
        elapsedMs: totalMs,
        status: 'infeasible'
      }
    }
  }

  const best = raw.bestSolution
  const eligibleTotals = countEligibleByInterest(
    data.films,
    interests,
    [...data.excludedFilmSet]
  )
  const coverage = buildCoverage(best.filmIds, interests, eligibleTotals)
  const omissions = buildOmissions({
    films: data.films,
    interests,
    excludedFilms: [...data.excludedFilmSet],
    planFilmIds: best.filmIds,
    requiredFilmIds: data.requiredFilmIds,
    filmToFeasibleScreenings: data.filmToFeasibleScreenings,
    planScreenings: best.screenings,
    filmMap: data.filmMap
  })

  // Must omitted from a "feasible" plan is an error state
  const mustOmitted = omissions.filter(o => o.interest === INTEREST_LEVELS.MUST_SEE)
  if (mustOmitted.length > 0) {
    return {
      screenings: [],
      interestCounts: {},
      filmCount: 0,
      infeasible: true,
      reason: `Required Must film(s) missing from plan: ${mustOmitted.map(o => o.film.title).join(', ')}`,
      coverage: null,
      omissions: mustOmitted,
      alternatives: { sameSize: [], oneFewer: null },
      requiredFilmIds: data.requiredFilmIds,
      metadata: {
        maxDistinctFilms: 0,
        optimalityProven: false,
        combinationsExplored: raw.combinationsExplored || 0,
        elapsedMs: totalMs,
        status: 'infeasible'
      }
    }
  }

  const maxCount = best.filmCount
  const sameSize = (raw.sameSizeAlts || [])
    .map(alt => summarizeAlternative(alt, best.filmIds, interests, data.filmMap, eligibleTotals))
    .sort((a, b) => comparePreferenceTuples(b.preferenceTuple, a.preferenceTuple))
    .slice(0, 5)

  let oneFewer = null
  if (raw.oneFewerBest) {
    oneFewer = summarizeAlternative(
      raw.oneFewerBest,
      best.filmIds,
      interests,
      data.filmMap,
      eligibleTotals
    )
  }

  return {
    screenings: best.screenings,
    filmIds: [...best.filmIds],
    interestCounts: best.interestCounts,
    filmCount: best.filmCount,
    mustSeeCount: best.mustSeeCount,
    wantToSeeCount: best.wantToSeeCount,
    maybeCount: best.maybeCount,
    unratedCount: best.unratedCount,
    infeasible: false,
    coverage,
    omissions,
    alternatives: {
      sameSize,
      oneFewer
    },
    requiredFilmIds: data.requiredFilmIds,
    metadata: {
      maxDistinctFilms: maxCount,
      optimalityProven: raw.optimalityProven,
      combinationsExplored: raw.combinationsExplored,
      elapsedMs: totalMs,
      distinctFilmSets: (raw.sameSizeAlts?.length || 0) + 1 + (raw.oneFewerBest ? 1 : 0),
      status: raw.optimalityProven ? 'maximum-proven' : 'best-found'
    }
  }
}

function dayScheduleConflictsWithGlobal(daySchedule, globalScreenings, globalFilms, filmMap) {
  for (const filmId of daySchedule.films) {
    if (globalFilms.has(filmId)) return true
  }
  for (const screening of daySchedule.screenings) {
    const film = filmMap.get(screening.filmId)
    for (const existing of globalScreenings) {
      const existingFilm = filmMap.get(existing.filmId)
      if (screeningsOverlapMinutes(screening, existing, film, existingFilm)) {
        return true
      }
    }
  }
  return false
}

function screeningsOverlapMinutes(s1, s2, film1, film2) {
  if (s1.date !== s2.date) return false
  const start1 = getScreeningStartMinutes(s1)
  const end1 = getScreeningEndMinutes(s1, film1)
  const start2 = getScreeningStartMinutes(s2)
  const end2 = getScreeningEndMinutes(s2, film2)
  return start1 < end2 && start2 < end1
}

function isScreeningWithinAttendance(screening, film, attendanceDays, availabilityByDate) {
  if (!attendanceDays[screening.date]) return false
  const dayAvail = availabilityByDate?.[screening.date]
  if (!dayAvail) return true
  const screeningStart = getScreeningStartMinutes(screening)
  const screeningEnd = getScreeningEndMinutes(screening, film)
  if (dayAvail.from) {
    if (screeningStart < parseTimeToMinutes(dayAvail.from)) return false
  }
  if (dayAvail.until) {
    if (screeningEnd > parseTimeToMinutes(dayAvail.until)) return false
  }
  return true
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0
  if (typeof timeStr === 'string' && timeStr.includes(':')) {
    const [hours, minutes] = timeStr.split(':').map(Number)
    if (!isNaN(hours) && !isNaN(minutes)) return hours * 60 + minutes
  }
  return 0
}

function parseTimeToMinutes(timeStr) {
  return timeToMinutes(timeStr)
}

function getScreeningStartMinutes(screening) {
  return timeToMinutes(screening.startTime)
}

function getScreeningEndMinutes(screening, film) {
  if (screening.endTime) return timeToMinutes(screening.endTime)
  if (film && film.runtime) return timeToMinutes(screening.startTime) + film.runtime
  return timeToMinutes(screening.startTime)
}
