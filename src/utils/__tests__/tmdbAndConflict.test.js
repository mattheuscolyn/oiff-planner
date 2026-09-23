/**
 * TMDB poster helpers + conflict diagnosis / resolution tests
 */

import { describe, it, expect } from 'vitest'
import {
  tmdbPosterUrl,
  resolveFilmPoster,
  assertNoSecretsInPosterData
} from '../tmdbPosters'
import tmdbPosters from '../../data/tmdb-posters.json'
import {
  canScheduleRequiredFilms,
  diagnoseRequiredConflict,
  findMinimalConflictSet
} from '../../planner/requiredConflict'
import { resolveConflictChoice, describePrioritizeChoice } from '../../planner/conflictResolution'
import { generatePlanV3 } from '../../planner/optimizerV3'
import { INTEREST_LEVELS } from '../userState'
import { validatePlan } from '../planValidator'
import { films, screenings } from '../festivalData'
import { deriveFestivalAvailability } from '../festivalAvailability'

function overlap(s1, s2, f1, f2) {
  if (s1.date !== s2.date) return false
  const start1 = time(s1.startTime)
  const end1 = s1.endTime ? time(s1.endTime) : start1 + (f1?.runtime || 90)
  const start2 = time(s2.startTime)
  const end2 = s2.endTime ? time(s2.endTime) : start2 + (f2?.runtime || 90)
  return start1 < end2 && start2 < end1
}

function time(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function makeData(requiredFilmIds, filmToFeasible, filmMap, filmToScreenings = new Map()) {
  return {
    requiredFilmIds,
    filmToFeasibleScreenings: filmToFeasible,
    filmMap,
    filmToScreenings
  }
}

describe('tmdb poster helpers', () => {
  it('builds expected CDN URLs', () => {
    expect(tmdbPosterUrl('/abc.jpg', 'card')).toBe(
      'https://image.tmdb.org/t/p/w342/abc.jpg'
    )
    expect(tmdbPosterUrl('/abc.jpg', 'detail')).toBe(
      'https://image.tmdb.org/t/p/w500/abc.jpg'
    )
    expect(tmdbPosterUrl(null)).toBeNull()
    expect(tmdbPosterUrl('abc.jpg')).toBeNull()
  })

  it('falls back Eventive then placeholder', () => {
    const withEventive = resolveFilmPoster(
      { id: 'missing-tmdb', title: 'X', poster: 'https://example.com/p.jpg' },
      'card'
    )
    expect(withEventive.source).toBe('eventive')
    expect(withEventive.url).toContain('example.com')

    const placeholder = resolveFilmPoster({ id: 'none', title: 'Y' }, 'card')
    expect(placeholder.source).toBe('placeholder')
    expect(placeholder.url).toBeNull()
  })

  it('generated poster JSON has no secrets and unique OIFF ids', () => {
    expect(assertNoSecretsInPosterData(tmdbPosters)).toBe(true)
    const ids = Object.keys(tmdbPosters)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rec of Object.values(tmdbPosters)) {
      expect(typeof rec.tmdbId).toBe('number')
      if (rec.posterPath) expect(rec.posterPath.startsWith('/')).toBe(true)
    }
  })
})

describe('required conflict diagnosis', () => {
  const filmsMap = new Map([
    ['a', { id: 'a', title: 'A', runtime: 90 }],
    ['b', { id: 'b', title: 'B', runtime: 90 }],
    ['c', { id: 'c', title: 'C', runtime: 90 }]
  ])

  it('returns pairwise conflict with overlap evidence', () => {
    const sa = { id: 'sa', filmId: 'a', date: '2026-10-14', startTime: '10:00', endTime: '11:30' }
    const sb = { id: 'sb', filmId: 'b', date: '2026-10-14', startTime: '10:30', endTime: '12:00' }
    const data = makeData(
      ['a', 'b'],
      new Map([
        ['a', [sa]],
        ['b', [sb]]
      ]),
      filmsMap
    )
    const d = diagnoseRequiredConflict(data, overlap)
    expect(d.ok).toBe(false)
    expect(d.reasonCode).toBe('required-film-conflict')
    expect(d.conflict.filmIds.sort()).toEqual(['a', 'b'])
    expect(d.conflict.overlaps.length).toBeGreaterThan(0)
    expect(d.conflict.overlaps[0].screeningAId).toBeTruthy()
  })

  it('does not false-conflict when alternate screenings make films compatible', () => {
    const sa1 = { id: 'sa1', filmId: 'a', date: '2026-10-14', startTime: '10:00', endTime: '11:30' }
    const sa2 = { id: 'sa2', filmId: 'a', date: '2026-10-15', startTime: '10:00', endTime: '11:30' }
    const sb = { id: 'sb', filmId: 'b', date: '2026-10-14', startTime: '10:30', endTime: '12:00' }
    const data = makeData(
      ['a', 'b'],
      new Map([
        ['a', [sa1, sa2]],
        ['b', [sb]]
      ]),
      filmsMap
    )
    expect(diagnoseRequiredConflict(data, overlap).ok).toBe(true)
  })

  it('finds a 3-film minimal conflict rather than an arbitrary pair', () => {
    // Only two non-overlapping time slots; each film can use either.
    // Any pair fits; all three cannot (pigeonhole).
    const slotA = { date: '2026-10-14', startTime: '10:00', endTime: '11:00' }
    const slotB = { date: '2026-10-14', startTime: '12:00', endTime: '13:00' }
    const a1 = { id: 'a1', filmId: 'a', venue: 'A', ...slotA }
    const a2 = { id: 'a2', filmId: 'a', venue: 'A', ...slotB }
    const b1 = { id: 'b1', filmId: 'b', venue: 'B', ...slotA }
    const b2 = { id: 'b2', filmId: 'b', venue: 'B', ...slotB }
    const c1 = { id: 'c1', filmId: 'c', venue: 'C', ...slotA }
    const c2 = { id: 'c2', filmId: 'c', venue: 'C', ...slotB }

    const data = makeData(
      ['a', 'b', 'c'],
      new Map([
        ['a', [a1, a2]],
        ['b', [b1, b2]],
        ['c', [c1, c2]]
      ]),
      filmsMap
    )

    expect(canScheduleRequiredFilms(['a', 'b'], data, overlap)).toBe(true)
    expect(canScheduleRequiredFilms(['a', 'c'], data, overlap)).toBe(true)
    expect(canScheduleRequiredFilms(['b', 'c'], data, overlap)).toBe(true)
    expect(canScheduleRequiredFilms(['a', 'b', 'c'], data, overlap)).toBe(false)

    const minimal = findMinimalConflictSet(['a', 'b', 'c'], data, overlap)
    expect(minimal.sort()).toEqual(['a', 'b', 'c'])

    const d = diagnoseRequiredConflict(data, overlap)
    expect(d.conflict.filmIds.sort()).toEqual(['a', 'b', 'c'])
    expect(d.conflict.size).toBe(3)
  })

  it('returns distinct unavailable reasonCode', () => {
    const data = makeData(
      ['a'],
      new Map([['a', []]]),
      filmsMap,
      new Map([
        [
          'a',
          [{ id: 'sa', filmId: 'a', date: '2026-10-14', startTime: '10:00', endTime: '11:00' }]
        ]
      ])
    )
    const d = diagnoseRequiredConflict(data, overlap)
    expect(d.reasonCode).toBe('required-film-unavailable')
    expect(d.unavailable.filmId).toBe('a')
  })
})

describe('conflict resolution actions', () => {
  const harlem = { id: 'h', title: 'Harlem' }
  const iron = { id: 'i', title: 'Iron Boy' }

  it('Must vs Must: choosing one demotes the other to Want', () => {
    const r = resolveConflictChoice({
      mode: 'prioritize',
      targetFilmId: 'h',
      conflictFilmIds: ['h', 'i'],
      interests: {
        h: INTEREST_LEVELS.MUST_SEE,
        i: INTEREST_LEVELS.MUST_SEE
      },
      constraints: { requiredFilms: [] }
    })
    expect(r.interestUpdates.h).toBe(INTEREST_LEVELS.MUST_SEE)
    expect(r.interestUpdates.i).toBe(INTEREST_LEVELS.WANT_TO_SEE)
    expect(r.constraintUpdates.requiredFilms).not.toContain('i')
  })

  it('Must over manual Want: removes require, preserves Want', () => {
    const r = resolveConflictChoice({
      mode: 'prioritize',
      targetFilmId: 'h',
      conflictFilmIds: ['h', 'i'],
      interests: {
        h: INTEREST_LEVELS.MUST_SEE,
        i: INTEREST_LEVELS.WANT_TO_SEE
      },
      constraints: { requiredFilms: ['i'] }
    })
    expect(r.interestUpdates.i).toBe(INTEREST_LEVELS.WANT_TO_SEE)
    expect(r.constraintUpdates.requiredFilms).not.toContain('i')
  })

  it('manual Want over Must: demotes Must to Want', () => {
    const r = resolveConflictChoice({
      mode: 'prioritize',
      targetFilmId: 'i',
      conflictFilmIds: ['h', 'i'],
      interests: {
        h: INTEREST_LEVELS.MUST_SEE,
        i: INTEREST_LEVELS.WANT_TO_SEE
      },
      constraints: { requiredFilms: ['i'] }
    })
    expect(r.interestUpdates.h).toBe(INTEREST_LEVELS.WANT_TO_SEE)
    expect(r.constraintUpdates.requiredFilms).toContain('i')
    expect(r.constraintUpdates.requiredFilms).not.toContain('h')
  })

  it('describePrioritizeChoice explains Must demotion', () => {
    const copy = describePrioritizeChoice({
      chosenFilm: harlem,
      otherFilm: iron,
      interests: {
        h: INTEREST_LEVELS.MUST_SEE,
        i: INTEREST_LEVELS.MUST_SEE
      }
    })
    expect(copy.detail).toMatch(/Want/)
  })
})

describe('Harlem / Iron Boy real data', () => {
  const HARLEM = '6aaa7a51feb4d1d7423e75a2'
  const IRON = '6aaa7a51feb4d1d7423e7590'

  it('alone as Must pair are NOT a conflict (compatible via other days)', { timeout: 30000 }, () => {
    const arrival = { date: '2026-10-13', type: 'already-on-island' }
    const departure = { date: '2026-10-19', type: 'staying-longer' }
    const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(
      arrival,
      departure,
      []
    )
    const result = generatePlanV3({
      films,
      screenings,
      interests: {
        [HARLEM]: INTEREST_LEVELS.MUST_SEE,
        [IRON]: INTEREST_LEVELS.MUST_SEE
      },
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: { attendanceDays, availabilityByDate },
      timeBudgetMs: 15000
    })
    // These two alone should schedule (Wed Harlem + Thu Iron Boy)
    expect(result.infeasible).toBe(false)
    expect(result.screenings.some(s => s.filmId === HARLEM)).toBe(true)
    expect(result.screenings.some(s => s.filmId === IRON)).toBe(true)
    expect(validatePlan(result, films, screenings).valid).toBe(true)
  })
})
