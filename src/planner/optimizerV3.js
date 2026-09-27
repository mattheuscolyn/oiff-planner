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
import { diagnoseRequiredConflict, findRequiredScreeningAssignment } from './requiredConflict'
import {
  buildSlotOptions,
  enrichOmissionsWithSlotHints
} from './slotOptions'
import { validatePlan } from '../utils/planValidator'

/** @type {number} Preference search cap once the film-count maximum is already proven. */
const PROVEN_COUNT_PREFERENCE_MS = 1200
/** @type {number} One-fewer alternative cap once the film-count maximum is already proven. */
const PROVEN_COUNT_ONE_FEWER_MS = 350

/**
 * Independent check before Phase A may treat an incumbent as optimal.
 * Uses planValidator for overlaps, duplicates, and attendance windows, plus
 * the optimizer's feasible-screening set and required-film coverage.
 *
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCountIncumbent(solution, data) {
  const errors = []
  if (!solution?.screenings?.length) {
    return { valid: false, errors: ['Incumbent has no screenings'] }
  }

  const filmIds = solution.screenings.map(s => s.filmId)
  const distinct = new Set(filmIds)
  if (distinct.size !== filmIds.length) {
    errors.push('A film appears more than once')
  }
  if (solution.filmCount !== distinct.size) {
    errors.push(`filmCount ${solution.filmCount} does not match ${distinct.size} distinct films`)
  }

  for (const id of data.requiredFilmIds || []) {
    if (!distinct.has(id)) errors.push(`Missing required film ${id}`)
  }

  for (const screening of solution.screenings) {
    const feasible = data.filmToFeasibleScreenings?.get(screening.filmId) || []
    if (!feasible.some(s => s.id === screening.id)) {
      errors.push(`Screening ${screening.id} is not attendance-feasible`)
    }
  }

  const eligibleDates = Object.entries(data.attendanceDays || {})
    .filter(([, on]) => on)
    .map(([date]) => date)
  const fromTimes = {}
  const untilTimes = {}
  for (const [date, window] of Object.entries(data.availabilityByDate || {})) {
    if (!window) continue
    if (window.from) fromTimes[date] = window.from
    if (window.until) untilTimes[date] = window.until
  }

  const planCheck = validatePlan(
    { screenings: solution.screenings, filmCount: distinct.size },
    data.films || [...(data.filmMap?.values() || [])],
    [...(data.screeningMap?.values() || solution.screenings)],
    {
      ...(eligibleDates.length ? { eligibleDates } : {}),
      ...(Object.keys(fromTimes).length ? { fromTimes } : {}),
      ...(Object.keys(untilTimes).length ? { untilTimes } : {})
    }
  )

  return {
    valid: errors.length === 0 && planCheck.valid,
    errors: [...errors, ...planCheck.errors]
  }
}

function requiredOnlySolution(requiredSeedScreenings, interests) {
  if (!requiredSeedScreenings?.length) return null
  return solutionFromFilms(
    requiredSeedScreenings,
    new Set(requiredSeedScreenings.map(s => s.filmId)),
    interests
  )
}

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

  const requiredDiagnosis = diagnoseRequiredConflict(data, screeningsOverlapMinutes)
  if (!requiredDiagnosis.ok) {
    return infeasibleResult(requiredDiagnosis.reason, startTime, {
      reasonCode: requiredDiagnosis.reasonCode,
      conflict: requiredDiagnosis.conflict,
      unavailable: requiredDiagnosis.unavailable,
      requiredFilmIds: data.requiredFilmIds,
      conflictingRequired: requiredDiagnosis.conflict?.filmIds || null
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

  // Seed Phase A with a known required-covering assignment so a short time budget
  // cannot report "no schedule" after diagnosis already proved coverage is possible.
  const requiredSeedScreenings = findRequiredScreeningAssignment(
    data.requiredFilmIds,
    data,
    screeningsOverlapMinutes
  )
  const requiredOnlyCount = requiredSeedScreenings?.length
    ? new Set(requiredSeedScreenings.map(s => s.filmId)).size
    : 0
  const bareRequired = requiredOnlySolution(requiredSeedScreenings, interests)
  // Extend the feasible Must assignment with compatible day packs so Phase A
  // starts from a high-count incumbent instead of the bare required set.
  let countIncumbent = buildStrongCountIncumbent(
    requiredSeedScreenings,
    dailySchedules,
    data,
    interests
  )
  if (countIncumbent) {
    const incumbentCheck = validateCountIncumbent(countIncumbent, data)
    if (!incumbentCheck.valid) {
      console.log(
        `[OptimizerV3] Strong incumbent rejected: ${incumbentCheck.errors.join('; ')}`
      )
      countIncumbent = null
    }
  }
  if (!countIncumbent && bareRequired && validateCountIncumbent(bareRequired, data).valid) {
    countIncumbent = bareRequired
  }

  console.log(
    `[OptimizerV3] Count incumbent: ${countIncumbent?.filmCount ?? 0} (required-only seed ${requiredOnlyCount})`
  )

  // Phase A gets a share of the original budget, not of whatever is left after
  // daily enumeration. Preprocess must not shrink the count search to a few seconds.
  const phaseAShare = data.requiredFilmIds.length >= 3 ? 0.5 : 0.4
  const budgetA = timeBudgetMs * phaseAShare

  const phaseA = runCountPhase(dailySchedules, data, interests, budgetA, onProgress, {
    seedSolution: countIncumbent
  })
  if (!phaseA.bestSolution) {
    const titles = data.requiredFilmIds
      .map(id => data.filmMap.get(id)?.title || id)
      .join(', ')
    return infeasibleResult(
      data.requiredFilmIds.length > 0
        ? `No schedule can include all required films (${titles}).`
        : 'No valid schedule found',
      startTime,
      {
        reasonCode:
          data.requiredFilmIds.length > 0 ? 'required-film-search-miss' : 'infeasible',
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

  // Once the count maximum is proven, keep a short preference pass and a short
  // one-fewer pass. Do not spend the rest of the interactive budget there.
  const remainingAfterA = Math.max(50, timeBudgetMs - (performance.now() - startTime))
  const budgetB = maxFilmCountProven
    ? Math.min(PROVEN_COUNT_PREFERENCE_MS, remainingAfterA)
    : remainingAfterA * 0.55
  const budgetC = maxFilmCountProven
    ? Math.min(PROVEN_COUNT_ONE_FEWER_MS, Math.max(0, remainingAfterA - budgetB))
    : remainingAfterA * 0.45

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
    const remainingAfterB = Math.max(0, timeBudgetMs - (performance.now() - startTime))
    const schedulesForM1 = filterSchedulesForExactCount(dailySchedules, data, M - 1)
    const phaseCBudget = maxFilmCountProven
      ? Math.min(budgetC, remainingAfterB)
      : Math.max(remainingAfterB, budgetC * 0.5)
    phaseC = runFixedCountPreferencePhase(
      schedulesForM1,
      data,
      interests,
      M - 1,
      phaseCBudget,
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
    reasonCode: extra.reasonCode || 'infeasible',
    conflict: extra.conflict || null,
    unavailable: extra.unavailable || null,
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
      !isSchoolScreening(s) &&
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

function countScarceRequired(schedule, requiredDates) {
  let n = 0
  for (const id of schedule.films) {
    const dates = requiredDates.get(id)
    if (dates && dates.size <= 1) n++
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
 * Largest feasible day pack that contains every id in mustInclude and none of usedFilms.
 * @returns {object|null}
 */
function bestDisjointDaySchedule(schedules, mustInclude, usedFilms) {
  let best = null
  for (const sched of schedules) {
    let ok = true
    for (const id of mustInclude) {
      if (!sched.films.has(id)) {
        ok = false
        break
      }
    }
    if (!ok) continue
    for (const id of sched.films) {
      if (usedFilms.has(id)) {
        ok = false
        break
      }
    }
    if (!ok) continue
    if (!best || sched.filmCount > best.filmCount) best = sched
  }
  return best
}

function scheduleFromScreenings(screenings) {
  const films = new Set(screenings.map(s => s.filmId))
  return {
    screenings: screenings.slice(),
    films,
    filmCount: films.size
  }
}

function usedFilmsExceptDay(dayChoice, date) {
  const used = new Set()
  for (const [d, sched] of dayChoice) {
    if (d === date || !sched) continue
    for (const id of sched.films) used.add(id)
  }
  return used
}

function totalChosenFilms(dayChoice) {
  let n = 0
  for (const sched of dayChoice.values()) n += sched?.filmCount || 0
  return n
}

/**
 * Build a high-count feasible plan that still contains every Must film.
 * Starts from a known required assignment, replaces each seeded day with the
 * largest compatible pack that keeps those Must films, fills the other days,
 * then relocates a Must film when that frees a larger pack.
 *
 * @returns {object|null} solutionFromFilms result
 */
export function buildStrongCountIncumbent(requiredScreenings, dailySchedules, data, interests) {
  const requiredIds = data.requiredFilmIds || []
  const seed = requiredScreenings || []
  if (!requiredIds.length && seed.length === 0 && dailySchedules.size === 0) return null

  const seedByDay = new Map()
  for (const screening of seed) {
    if (!seedByDay.has(screening.date)) seedByDay.set(screening.date, [])
    seedByDay.get(screening.date).push(screening)
  }

  const dayChoice = new Map()
  const dates = Array.from(dailySchedules.keys()).sort((a, b) => {
    const aSeeded = seedByDay.has(a) ? 0 : 1
    const bSeeded = seedByDay.has(b) ? 0 : 1
    if (aSeeded !== bSeeded) return aSeeded - bSeeded
    return (data.maxPerDay.get(b) || 0) - (data.maxPerDay.get(a) || 0)
  })

  for (const date of dates) {
    const seeded = seedByDay.get(date) || []
    const mustInclude = seeded
      .map(s => s.filmId)
      .filter(id => data.requiredFilmSet.has(id))
    const used = usedFilmsExceptDay(dayChoice, date)
    let best = bestDisjointDaySchedule(dailySchedules.get(date) || [], mustInclude, used)
    if (!best && seeded.length) {
      const seededSched = scheduleFromScreenings(seeded)
      let clashes = false
      for (const id of seededSched.films) {
        if (used.has(id)) {
          clashes = true
          break
        }
      }
      // Never reinsert a Must film that an earlier day pack already took.
      if (!clashes) best = seededSched
    }
    if (best) dayChoice.set(date, best)
  }

  // Move a Must film onto an alternate day when the swap increases total count.
  for (const id of requiredIds) {
    let fromDate = null
    for (const [d, sched] of dayChoice) {
      if (sched?.films.has(id)) {
        fromDate = d
        break
      }
    }
    if (!fromDate) continue

    const fromSched = dayChoice.get(fromDate)
    const otherRequiredOnFrom = []
    for (const fid of fromSched.films) {
      if (fid !== id && data.requiredFilmSet.has(fid)) otherRequiredOnFrom.push(fid)
    }

    const altDates = new Set(
      (data.filmToFeasibleScreenings.get(id) || []).map(s => s.date)
    )
    altDates.delete(fromDate)
    const baseCount = totalChosenFilms(dayChoice)

    for (const toDate of altDates) {
      const toSched = dayChoice.get(toDate)
      const otherRequiredOnTo = []
      if (toSched) {
        for (const fid of toSched.films) {
          if (data.requiredFilmSet.has(fid)) otherRequiredOnTo.push(fid)
        }
      }

      const usedFrom = usedFilmsExceptDay(dayChoice, fromDate)
      // The Must film is leaving this day; do not keep a pack that still includes it.
      usedFrom.add(id)
      const newFrom = bestDisjointDaySchedule(
        dailySchedules.get(fromDate) || [],
        otherRequiredOnFrom,
        usedFrom
      )
      // Dropping the only screening on this day is allowed when no other Must remains.
      if (!newFrom && otherRequiredOnFrom.length > 0) continue

      const usedTo = usedFilmsExceptDay(dayChoice, toDate)
      if (fromSched) {
        for (const fid of fromSched.films) usedTo.delete(fid)
      }
      if (newFrom) {
        for (const fid of newFrom.films) usedTo.add(fid)
      }
      usedTo.delete(id)

      const newTo = bestDisjointDaySchedule(
        dailySchedules.get(toDate) || [],
        [...otherRequiredOnTo, id],
        usedTo
      )
      if (!newTo) continue

      const newTotal =
        baseCount -
        (fromSched?.filmCount || 0) -
        (toSched?.filmCount || 0) +
        (newFrom?.filmCount || 0) +
        newTo.filmCount
      if (newTotal > baseCount) {
        if (newFrom) dayChoice.set(fromDate, newFrom)
        else dayChoice.delete(fromDate)
        dayChoice.set(toDate, newTo)
        break
      }
    }
  }

  // Upgrade any day whose Must films are still covered, now that placement is settled.
  for (const date of dailySchedules.keys()) {
    const current = dayChoice.get(date)
    const mustInclude = []
    if (current) {
      for (const fid of current.films) {
        if (!data.requiredFilmSet.has(fid)) continue
        let elsewhere = false
        for (const [d, sched] of dayChoice) {
          if (d !== date && sched?.films.has(fid)) elsewhere = true
        }
        if (!elsewhere) mustInclude.push(fid)
      }
    }
    const used = usedFilmsExceptDay(dayChoice, date)
    const best = bestDisjointDaySchedule(dailySchedules.get(date) || [], mustInclude, used)
    if (best && (!current || best.filmCount > current.filmCount)) {
      dayChoice.set(date, best)
    }
  }

  const screenings = []
  const films = new Set()
  for (const sched of dayChoice.values()) {
    if (!sched) continue
    for (const s of sched.screenings) screenings.push(s)
    for (const id of sched.films) films.add(id)
  }

  if (requiredIds.some(id => !films.has(id))) return null
  if (!screenings.length) return null
  return solutionFromFilms(screenings, films, interests)
}

/**
 * Phase A — maximize film count. Hitting the daily-capacity upper bound
 * proves the count immediately without exhaustive enumeration.
 */
function runCountPhase(dailySchedules, data, interests, timeBudgetMs, onProgress, options = {}) {
  const startTime = performance.now()
  const deadline = startTime + timeBudgetMs
  const upperBound = data.globalCountUpperBound || 0
  const seedSolution = options.seedSolution || null

  const days = Array.from(dailySchedules.keys()).sort(
    (a, b) => (dailySchedules.get(a)?.length || 0) - (dailySchedules.get(b)?.length || 0)
  )

  const suffixMax = new Array(days.length + 1).fill(0)
  for (let i = days.length - 1; i >= 0; i--) {
    suffixMax[i] = suffixMax[i + 1] + (data.maxPerDay.get(days[i]) || 0)
  }

  // requiredFilmId -> dates with an attendance-feasible screening
  const requiredDates = new Map()
  for (const id of data.requiredFilmIds) {
    const dates = new Set()
    for (const s of data.filmToFeasibleScreenings.get(id) || []) {
      dates.add(s.date)
    }
    requiredDates.set(id, dates)
  }

  // High film-count packs first so a large feasible plan is found before
  // required-heavy but small packs. Scarce Must films break ties.
  const orderedByDay = days.map(date => {
    const list = (dailySchedules.get(date) || []).slice()
    list.sort((a, b) => {
      if (b.filmCount !== a.filmCount) return b.filmCount - a.filmCount
      const scarceB = countScarceRequired(b, requiredDates)
      const scarceA = countScarceRequired(a, requiredDates)
      if (scarceB !== scarceA) return scarceB - scarceA
      return b.requiredCount - a.requiredCount
    })
    return list
  })

  let bestCount = seedSolution ? seedSolution.filmCount : -1
  let bestSolution = seedSolution
  let combinationsExplored = 0
  let timedOut = false
  let hitUpperBound = false

  if (seedSolution && upperBound > 0 && bestCount >= upperBound) {
    hitUpperBound = true
  }

  function lastChanceRequiredIds(dayIndex, globalFilms) {
    const date = days[dayIndex]
    const laterDates = new Set(days.slice(dayIndex + 1))
    const ids = []
    for (const id of data.requiredFilmIds) {
      if (globalFilms.has(id)) continue
      const dates = requiredDates.get(id)
      if (!dates || !dates.has(date)) continue
      let laterHas = false
      for (const d of dates) {
        if (laterDates.has(d)) {
          laterHas = true
          break
        }
      }
      if (!laterHas) ids.push(id)
    }
    return ids
  }

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
    const neededNow = lastChanceRequiredIds(dayIndex, globalFilms)
    const mustUseDay = neededNow.length > 0

    for (const daySchedule of daySchedules) {
      if (neededNow.some(id => !daySchedule.films.has(id))) continue
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

    // Skip day only when it is not the last chance to cover a required film
    if (
      !mustUseDay &&
      globalFilms.size + suffixMax[dayIndex + 1] > bestCount
    ) {
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

  // Put the incumbent's day pack first so a short search reaches complete plans
  // and same-size swaps immediately, instead of wandering before the first leaf.
  const incumbentFilmsByDay = new Map()
  if (seedSolution?.screenings) {
    for (const screening of seedSolution.screenings) {
      if (!incumbentFilmsByDay.has(screening.date)) {
        incumbentFilmsByDay.set(screening.date, new Set())
      }
      incumbentFilmsByDay.get(screening.date).add(screening.filmId)
    }
  }
  const orderedByDay = days.map(date => {
    const schedules = (dailySchedules.get(date) || []).slice()
    const films = incumbentFilmsByDay.get(date)
    if (!films) return schedules
    schedules.sort((a, b) => {
      const aMatch = sameFilmSet(a.films, films) ? 0 : 1
      const bMatch = sameFilmSet(b.films, films) ? 0 : 1
      return aMatch - bMatch
    })
    return schedules
  })

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
  const rawOmissions = buildOmissions({
    films: data.films,
    interests,
    excludedFilms: [...data.excludedFilmSet],
    planFilmIds: best.filmIds,
    requiredFilmIds: data.requiredFilmIds,
    filmToFeasibleScreenings: data.filmToFeasibleScreenings,
    planScreenings: best.screenings,
    filmMap: data.filmMap
  })

  const { slotOptions, filmToReplaceableSlots } = buildSlotOptions({
    planScreenings: best.screenings,
    filmMap: data.filmMap,
    filmToScreenings: data.filmToScreenings,
    filmToFeasibleScreenings: data.filmToFeasibleScreenings,
    interests,
    excludedFilmIds: data.excludedFilmSet,
    planFilmIds: best.filmIds,
    films: data.films
  })

  const omissions = enrichOmissionsWithSlotHints(rawOmissions, filmToReplaceableSlots)

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
      slotOptions: {},
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
    slotOptions,
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

function sameFilmSet(a, b) {
  if (!a || !b || a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
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

/** School / private screenings are not general-attendance festival showtimes. */
function isSchoolScreening(screening) {
  const name = screening?.name || ''
  return /school screening/i.test(name)
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
