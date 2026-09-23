/**
 * Required-film conflict diagnosis — minimal infeasible subsets + evidence.
 * Uses the same overlap/attendance primitives as optimizerV3.
 */

/**
 * @param {object} data - precomputeData result (filmMap, filmToFeasibleScreenings, requiredFilmIds, …)
 * @param {(s1,s2,f1,f2)=>boolean} screeningsOverlapMinutes
 */
export function canScheduleRequiredFilms(filmIds, data, screeningsOverlapMinutes) {
  const options = filmIds.map(id => data.filmToFeasibleScreenings.get(id) || [])
  if (options.some(o => o.length === 0)) return false

  function search(index, chosen) {
    if (index >= options.length) return true
    for (const screening of options[index]) {
      const film = data.filmMap.get(screening.filmId)
      let ok = true
      for (const prev of chosen) {
        const prevFilm = data.filmMap.get(prev.filmId)
        if (screeningsOverlapMinutes(screening, prev, film, prevFilm)) {
          ok = false
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

  return search(0, [])
}

/**
 * Deletion method: shrink to a minimal infeasible subset.
 */
export function findMinimalConflictSet(filmIds, data, screeningsOverlapMinutes) {
  let conflict = [...filmIds]
  let changed = true
  while (changed && conflict.length > 1) {
    changed = false
    for (const id of [...conflict]) {
      const without = conflict.filter(x => x !== id)
      if (
        without.length >= 1 &&
        !canScheduleRequiredFilms(without, data, screeningsOverlapMinutes)
      ) {
        // Still infeasible without `id` → `id` is not needed in this conflict set
        if (without.every(fid => (data.filmToFeasibleScreenings.get(fid) || []).length > 0)) {
          conflict = without
          changed = true
          break
        }
        // If without has an unavailable film, keep focusing on availability separately
        if (without.length >= 2) {
          conflict = without
          changed = true
          break
        }
      }
    }
  }
  return conflict
}

/**
 * Pairwise overlap evidence among attendance-feasible screenings.
 */
export function buildOverlapEvidence(filmIds, data, screeningsOverlapMinutes) {
  const overlaps = []
  for (let i = 0; i < filmIds.length; i++) {
    for (let j = i + 1; j < filmIds.length; j++) {
      const aId = filmIds[i]
      const bId = filmIds[j]
      const aScreens = data.filmToFeasibleScreenings.get(aId) || []
      const bScreens = data.filmToFeasibleScreenings.get(bId) || []
      for (const sa of aScreens) {
        const fa = data.filmMap.get(aId)
        for (const sb of bScreens) {
          const fb = data.filmMap.get(bId)
          if (screeningsOverlapMinutes(sa, sb, fa, fb)) {
            overlaps.push({
              screeningAId: sa.id,
              screeningBId: sb.id,
              filmAId: aId,
              filmBId: bId,
              date: sa.date
            })
          }
        }
      }
    }
  }
  return overlaps
}

/**
 * Full diagnosis for required-film infeasibility.
 */
export function diagnoseRequiredConflict(data, screeningsOverlapMinutes) {
  const ids = data.requiredFilmIds || []

  // Distinct case: a required film has zero attendance-feasible screenings
  for (const filmId of ids) {
    const feasible = data.filmToFeasibleScreenings.get(filmId) || []
    if (feasible.length === 0) {
      const allScreenings = data.filmToScreenings?.get(filmId) || []
      return {
        ok: false,
        reasonCode: 'required-film-unavailable',
        reason: `Required film "${data.filmMap.get(filmId)?.title || filmId}" has no screening within your attendance window.`,
        conflict: null,
        unavailable: {
          filmId,
          publishedScreeningIds: allScreenings.map(s => s.id)
        }
      }
    }
  }

  if (ids.length === 0) return { ok: true }
  if (canScheduleRequiredFilms(ids, data, screeningsOverlapMinutes)) {
    return { ok: true }
  }

  const minimalIds = findMinimalConflictSet(ids, data, screeningsOverlapMinutes)
  const overlaps = buildOverlapEvidence(minimalIds, data, screeningsOverlapMinutes)

  const films = minimalIds.map(filmId => ({
    filmId,
    feasibleScreeningIds: (data.filmToFeasibleScreenings.get(filmId) || []).map(s => s.id)
  }))

  const titles = minimalIds
    .map(id => data.filmMap.get(id)?.title || id)
    .join(', ')

  return {
    ok: false,
    reasonCode: 'required-film-conflict',
    reason:
      minimalIds.length === 2
        ? `No schedule can include both required films (${titles}).`
        : `No schedule can include all of these required films (${titles}).`,
    conflict: {
      filmIds: minimalIds,
      minimal: true,
      size: minimalIds.length,
      films,
      overlaps
    },
    unavailable: null
  }
}
