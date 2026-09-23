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

/** Default interactive budget — split across search phases */
export const DEFAULT_TIME_BUDGET_MS = 20000

/**
 * Generate plan using daily enumeration + phased global search.
 *
 * Phase A: maximize film count (prove via daily-capacity upper bound when hit)
 * Phase B: optimize preference among exactly-M film sets
 * Phase C: independently find best (M-1) film set
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
  annotateSchedulePreferences(dailySchedules, interests)

  const days = Array.from(dailySchedules.keys()).sort()
  const dailyMaxima = {}
  let globalCountUpperBound = 0
  for (const date of days) {
    const max = data.maxPerDay.get(date) || 0
    dailyMaxima[date] = max
    globalCountUpperBound += max
  }
  data.dailyMaxima = dailyMaxima
  data.globalCountUpperBound = globalCountUpperBound

  console.log(`[OptimizerV3] Daily maxima:`, dailyMaxima)
  console.log(`[OptimizerV3] Global count upper bound: ${globalCountUpperBound}`)

  const usedMs = performance.now() - startTime
  const remaining = Math.max(100, timeBudgetMs - usedMs)
  const budgetA = remaining * 0.25

  const phaseA = runCountPhase(dailySchedules, data, interests, budgetA, onProgress)
  if (!phaseA.bestSolution) {
    return infeasibleResult(
      data.requiredFilmIds.length > 0
        ? 'No schedule can include all required films.'
        : 'No valid schedule found',
      startTime,
      {
        requiredFilmIds: data.requiredFilmIds,
        combinationsExplored: phaseA.combinationsExplored,
        dailyMaxima,
        globalCountUpperBound
      }
    )
  }

  const M = phaseA.bestSolution.filmCount
  const maxFilmCountProven =
    phaseA.maxFilmCountProven || M === globalCountUpperBound

  console.log(
    `[OptimizerV3] Phase A: M=${M} maxFilmCountProven=${maxFilmCountProven} ms=${phaseA.elapsedMs.toFixed(0)}`
  )

  // Reallocate leftover time after early Phase A stop (e.g. hit capacity bound)
  const remainingAfterA = Math.max(100, timeBudgetMs - (performance.now() - startTime))
  const budgetB = remainingAfterA * 0.55
  const budgetC = remainingAfterA * 0.45

  const schedulesForM = filterSchedulesForExactCount(dailySchedules, data, M)
  const phaseB = runFixedCountPreferencePhase(
    schedulesForM,
    data,
    interests,
    M,
    budgetB,
    onProgress,
    {
      collectSameSize: true,
      phaseLabel: 'preference@M',
      seedSolution: phaseA.bestSolution,
      shortCircuitUniformPreference: preferencesAreUniform(data, interests)
    }
  )

  let bestSolution = phaseA.bestSolution
  let preferenceOptimalityProven = false
  let sameSizeAlts = []

  if (phaseB.bestSolution && phaseB.bestSolution.filmCount === M) {
    bestSolution = phaseB.bestSolution
    preferenceOptimalityProven = phaseB.exhausted
    sameSizeAlts = phaseB.sameSizeAlts || []
  } else {
    // Keep Phase A plan if preference search found nothing better
    bestSolution = phaseA.bestSolution
    preferenceOptimalityProven = false
    sameSizeAlts = phaseB.sameSizeAlts || []
  }

  console.log(
    `[OptimizerV3] Phase B: preferenceProven=${preferenceOptimalityProven} sameSize=${sameSizeAlts.length} ms=${phaseB.elapsedMs.toFixed(0)}`
  )

  let oneFewerBest = null
  let oneFewerPreferenceProven = false
  let phaseC = { combinationsExplored: 0, elapsedMs: 0 }
  if (M > 0) {
    const remainingAfterB = Math.max(50, timeBudgetMs - (performance.now() - startTime))
    const schedulesForM1 = filterSchedulesForExactCount(dailySchedules, data, M - 1)
    phaseC = runFixedCountPreferencePhase(
      schedulesForM1,
      data,
      interests,
      M - 1,
      Math.max(remainingAfterB, budgetC * 0.5),
      onProgress,
      {
        collectSameSize: false,
        phaseLabel: 'preference@M-1',
        shortCircuitUniformPreference: preferencesAreUniform(data, interests)
      }
    )
    if (phaseC.bestSolution) {
      oneFewerBest = phaseC.bestSolution
      oneFewerPreferenceProven = phaseC.exhausted
    }
    console.log(
      `[OptimizerV3] Phase C: oneFewer=${oneFewerBest?.filmCount ?? 'none'} proven=${oneFewerPreferenceProven} ms=${phaseC.elapsedMs.toFixed(0)}`
    )
  }

  const totalMs = performance.now() - startTime
  console.log(`[OptimizerV3] Total time: ${totalMs.toFixed(1)}ms`)

  return enrichResult(
    {
      bestSolution,
      sameSizeAlts,
      oneFewerBest,
      oneFewerPreferenceProven,
      maxFilmCountProven,
      preferenceOptimalityProven,
      combinationsExplored:
        phaseA.combinationsExplored +
        phaseB.combinationsExplored +
        phaseC.combinationsExplored,
      phaseMs: {
        count: phaseA.elapsedMs,
        preferenceAtMax: phaseB.elapsedMs,
        oneFewer: phaseC.elapsedMs
      },
      dailyMaxima,
      globalCountUpperBound
    },
    data,
    interests,
    constraints,
    totalMs
  )
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
      maxFilmCountProven: false,
      preferenceOptimalityProven: false,
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
    const pruned = pruneDominatedSchedules(schedules.filter(s => s.filmCount > 0))
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
  // Dedupe by film set only. Do NOT drop smaller non-dominated-looking
  // schedules: Phase C needs day packs of size max-1, and preference
  // search may need non-maximal day packs when the global target is below
  // the capacity upper bound.
  const byKey = new Map()
  for (const schedule of schedules) {
    const key = filmSetKey(schedule.films)
    if (!byKey.has(key)) {
      byKey.set(key, schedule)
    }
  }
  return Array.from(byKey.values())
}

function annotateSchedulePreferences(dailySchedules, interests) {
  for (const schedules of dailySchedules.values()) {
    for (const schedule of schedules) {
      const pref = preferenceScore(schedule.films, interests)
      schedule.wantCount = pref.wantToSeeCount
      schedule.maybeCount = pref.maybeCount
      schedule.unratedCount = pref.unratedCount
      schedule.mustCount = pref.mustSeeCount
      schedule.preferenceTuple = pref.tuple
    }
    // Prefer higher required, film count, wants, maybes; unrated last
    schedules.sort((a, b) => {
      if (b.requiredCount !== a.requiredCount) return b.requiredCount - a.requiredCount
      if (b.filmCount !== a.filmCount) return b.filmCount - a.filmCount
      if (b.wantCount !== a.wantCount) return b.wantCount - a.wantCount
      if (b.maybeCount !== a.maybeCount) return b.maybeCount - a.maybeCount
      if (a.unratedCount !== b.unratedCount) return a.unratedCount - b.unratedCount
      return 0
    })
  }
}

/**
 * Restrict day packs so exact global targetCount remains reachable.
 * slack = upperBound - target ⇒ keep schedules with filmCount >= dayMax - slack.
 * For target=24 (=bound) only max packs; for 23, max and max-1.
 */
function filterSchedulesForExactCount(dailySchedules, data, targetCount) {
  const upper = data.globalCountUpperBound || 0
  const slack = Math.max(0, upper - targetCount)
  const filtered = new Map()
  for (const [date, schedules] of dailySchedules.entries()) {
    const dayMax = data.maxPerDay.get(date) || 0
    const minKeep = Math.max(0, dayMax - slack)
    filtered.set(
      date,
      schedules.filter(s => s.filmCount >= minKeep)
    )
  }
  return filtered
}

function preferencesAreUniform(data, interests) {
  const ranks = new Set()
  for (const film of data.candidateFilms) {
    const interest = interests[film.id]
    if (interest === INTEREST_LEVELS.SKIP || interest === INTEREST_LEVELS.SEEN) continue
    let rank = 1 // unrated
    if (interest === INTEREST_LEVELS.MUST_SEE) rank = 4
    else if (interest === INTEREST_LEVELS.WANT_TO_SEE) rank = 3
    else if (interest === INTEREST_LEVELS.MAYBE) rank = 2
    ranks.add(rank)
    if (ranks.size > 1) return false
  }
  return true
}

function solutionFromFilms(globalScreenings, globalFilms, interests) {
  const pref = preferenceScore(globalFilms, interests)
  return {
    screenings: globalScreenings.slice(),
    filmIds: new Set(globalFilms),
    ...pref,
    preferenceTuple: pref.tuple,
    interestCounts: {
      'must-see': pref.mustSeeCount,
      'want-to-see': pref.wantToSeeCount,
      maybe: pref.maybeCount,
      unrated: pref.unratedCount
    }
  }
}

/**
 * Phase A — maximize film count. Hitting the daily-capacity upper bound
 * proves the count immediately without exhaustive enumeration.
 */
function runCountPhase(dailySchedules, data, interests, timeBudgetMs, onProgress) {
  const startTime = performance.now()
  const deadline = startTime + timeBudgetMs
  const upperBound = data.globalCountUpperBound || 0

  const days = Array.from(dailySchedules.keys()).sort(
    (a, b) => (dailySchedules.get(a)?.length || 0) - (dailySchedules.get(b)?.length || 0)
  )

  const suffixMax = new Array(days.length + 1).fill(0)
  for (let i = days.length - 1; i >= 0; i--) {
    suffixMax[i] = suffixMax[i + 1] + (data.maxPerDay.get(days[i]) || 0)
  }

  // Prefer high film-count day schedules for Phase A
  const orderedByDay = days.map(date => {
    const list = (dailySchedules.get(date) || []).slice()
    list.sort((a, b) => {
      if (b.requiredCount !== a.requiredCount) return b.requiredCount - a.requiredCount
      return b.filmCount - a.filmCount
    })
    return list
  })

  let bestCount = -1
  let bestSolution = null
  let combinationsExplored = 0
  let timedOut = false
  let hitUpperBound = false

  function combine(dayIndex, globalScreenings, globalFilms, requiredCovered) {
    combinationsExplored++

    if (combinationsExplored % 2000 === 0) {
      if (performance.now() >= deadline) {
        timedOut = true
        return
      }
      if (onProgress) {
        onProgress({
          phase: 'count',
          combinationsExplored,
          bestFilmCount: bestCount > 0 ? bestCount : 0,
          elapsedMs: performance.now() - startTime
        })
      }
    }

    if (performance.now() >= deadline) {
      timedOut = true
      return
    }

    if (hitUpperBound) return

    if (dayIndex >= days.length) {
      if (requiredCovered < data.requiredFilmIds.length) return
      const count = globalFilms.size
      if (count > bestCount) {
        bestCount = count
        bestSolution = solutionFromFilms(globalScreenings, globalFilms, interests)
        if (upperBound > 0 && bestCount >= upperBound) {
          hitUpperBound = true
        }
      }
      return
    }

    const optimistic = globalFilms.size + suffixMax[dayIndex]
    if (optimistic <= bestCount) return

    const daySchedules = orderedByDay[dayIndex]

    for (const daySchedule of daySchedules) {
      if (dayScheduleConflictsWithGlobal(daySchedule, globalScreenings, globalFilms, data.filmMap)) {
        continue
      }

      // Bound: even taking this schedule cannot beat best
      if (globalFilms.size + daySchedule.filmCount + suffixMax[dayIndex + 1] <= bestCount) {
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

      globalScreenings.length -= addedScreenings.length
      for (const fid of addedFilms) globalFilms.delete(fid)

      if (timedOut || hitUpperBound) return
    }

    // Skip day (only useful if required coverage / count still possible)
    if (globalFilms.size + suffixMax[dayIndex + 1] > bestCount) {
      combine(dayIndex + 1, globalScreenings, globalFilms, requiredCovered)
    }
  }

  combine(0, [], new Set(), 0)

  const elapsedMs = performance.now() - startTime
  const exhausted = !timedOut
  const maxFilmCountProven =
    hitUpperBound || (exhausted && bestSolution != null)

  return {
    bestSolution,
    combinationsExplored,
    elapsedMs,
    exhausted,
    maxFilmCountProven,
    hitUpperBound
  }
}

/**
 * Phase B/C — optimize preference among plans with exactly `targetCount` films.
 */
function runFixedCountPreferencePhase(
  dailySchedules,
  data,
  interests,
  targetCount,
  timeBudgetMs,
  onProgress,
  options = {}
) {
  const { collectSameSize = false, phaseLabel = 'fixed-count', seedSolution = null, shortCircuitUniformPreference = false } = options
  const startTime = performance.now()
  const deadline = startTime + timeBudgetMs

  if (targetCount < 0) {
    return {
      bestSolution: null,
      sameSizeAlts: [],
      combinationsExplored: 0,
      elapsedMs: 0,
      exhausted: true
    }
  }

  // When every eligible film has the same preference rank, any feasible
  // targetCount plan is preference-optimal.
  if (shortCircuitUniformPreference && seedSolution && seedSolution.filmCount === targetCount) {
    return {
      bestSolution: seedSolution,
      sameSizeAlts: [],
      combinationsExplored: 0,
      elapsedMs: performance.now() - startTime,
      exhausted: true
    }
  }

  const days = Array.from(dailySchedules.keys()).sort(
    (a, b) => (dailySchedules.get(a)?.length || 0) - (dailySchedules.get(b)?.length || 0)
  )

  const suffixMax = new Array(days.length + 1).fill(0)
  for (let i = days.length - 1; i >= 0; i--) {
    suffixMax[i] = suffixMax[i + 1] + (data.maxPerDay.get(days[i]) || 0)
  }

  // Prefer preference-rich day schedules (already annotated/sorted)
  const orderedByDay = days.map(date => (dailySchedules.get(date) || []).slice())

  let bestTuple = null
  let bestSolution = null
  let bestKey = null
  let combinationsExplored = 0
  let timedOut = false
  let uniformDone = false
  const sameSizeAlts = new Map()

  if (seedSolution && seedSolution.filmCount === targetCount) {
    bestSolution = seedSolution
    bestTuple = seedSolution.preferenceTuple || preferenceScore(seedSolution.filmIds, interests).tuple
    bestKey = filmSetKey(seedSolution.filmIds)
    if (shortCircuitUniformPreference && !collectSameSize) {
      return {
        bestSolution,
        sameSizeAlts: [],
        combinationsExplored: 0,
        elapsedMs: performance.now() - startTime,
        exhausted: true
      }
    }
  }

  function coversRequired(globalFilms) {
    for (const id of data.requiredFilmIds) {
      if (!globalFilms.has(id)) return false
    }
    return true
  }

  function ingestSameSize(key, screenings, filmIds, pref) {
    if (!collectSameSize) return
    if (key === bestKey) return
    const existing = sameSizeAlts.get(key)
    if (existing && comparePreferenceTuples(pref.tuple, existing.preferenceTuple) <= 0) return
    sameSizeAlts.set(key, {
      filmIds: new Set(filmIds),
      screenings: screenings.slice(),
      preferenceTuple: pref.tuple,
      filmCount: pref.filmCount
    })
    if (sameSizeAlts.size > 8) {
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

  function consider(globalScreenings, globalFilms) {
    if (globalFilms.size !== targetCount) return
    if (!coversRequired(globalFilms)) return

    const pref = preferenceScore(globalFilms, interests)
    const key = filmSetKey(globalFilms)

    if (!bestSolution || comparePreferenceTuples(pref.tuple, bestTuple) > 0) {
      if (bestSolution && collectSameSize) {
        ingestSameSize(bestKey, bestSolution.screenings, bestSolution.filmIds, {
          tuple: bestTuple,
          filmCount: bestTuple[0]
        })
      }
      bestSolution = solutionFromFilms(globalScreenings, globalFilms, interests)
      bestTuple = pref.tuple
      bestKey = key
      for (const [k, alt] of sameSizeAlts) {
        if (alt.filmCount !== targetCount) sameSizeAlts.delete(k)
      }
      if (shortCircuitUniformPreference) {
        uniformDone = true
      }
      return
    }

    if (collectSameSize && key !== bestKey) {
      ingestSameSize(key, globalScreenings, globalFilms, pref)
    }
  }

  function combine(dayIndex, globalScreenings, globalFilms, requiredCovered) {
    combinationsExplored++

    if (uniformDone) return

    if (combinationsExplored % 2000 === 0) {
      if (performance.now() >= deadline) {
        timedOut = true
        return
      }
      if (onProgress) {
        onProgress({
          phase: phaseLabel,
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
      consider(globalScreenings, globalFilms)
      return
    }

    const size = globalFilms.size
    if (size + suffixMax[dayIndex] < targetCount) return
    if (size > targetCount) return

    const daySchedules = orderedByDay[dayIndex]

    for (const daySchedule of daySchedules) {
      if (dayScheduleConflictsWithGlobal(daySchedule, globalScreenings, globalFilms, data.filmMap)) {
        continue
      }

      const nextSize = size + daySchedule.filmCount
      if (nextSize > targetCount) continue
      if (nextSize + suffixMax[dayIndex + 1] < targetCount) continue

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

      globalScreenings.length -= addedScreenings.length
      for (const fid of addedFilms) globalFilms.delete(fid)

      if (timedOut || uniformDone) return
    }

    if (size + suffixMax[dayIndex + 1] >= targetCount) {
      combine(dayIndex + 1, globalScreenings, globalFilms, requiredCovered)
    }
  }

  combine(0, [], new Set(), 0)

  const elapsedMs = performance.now() - startTime
  const exhausted = !timedOut || uniformDone

  return {
    bestSolution,
    sameSizeAlts: Array.from(sameSizeAlts.values()),
    combinationsExplored,
    elapsedMs,
    exhausted
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
        maxFilmCountProven: false,
        preferenceOptimalityProven: false,
        combinationsExplored: raw.combinationsExplored || 0,
        elapsedMs: totalMs,
        status: 'infeasible',
        dailyMaxima: raw.dailyMaxima,
        globalCountUpperBound: raw.globalCountUpperBound
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
        maxFilmCountProven: false,
        preferenceOptimalityProven: false,
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
    oneFewer.preferenceOptimalityProven = !!raw.oneFewerPreferenceProven
  }

  const maxFilmCountProven = !!raw.maxFilmCountProven
  const preferenceOptimalityProven = !!raw.preferenceOptimalityProven

  let status = 'best-found'
  if (maxFilmCountProven && preferenceOptimalityProven) {
    status = 'maximum-proven'
  } else if (maxFilmCountProven) {
    status = 'count-proven'
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
      maxFilmCountProven,
      preferenceOptimalityProven,
      // Back-compat: only true when both count and preference are proven
      optimalityProven: maxFilmCountProven && preferenceOptimalityProven,
      combinationsExplored: raw.combinationsExplored,
      elapsedMs: totalMs,
      phaseMs: raw.phaseMs || null,
      dailyMaxima: raw.dailyMaxima || data.dailyMaxima || null,
      globalCountUpperBound: raw.globalCountUpperBound ?? data.globalCountUpperBound ?? null,
      distinctFilmSets: (raw.sameSizeAlts?.length || 0) + 1 + (raw.oneFewerBest ? 1 : 0),
      status
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
