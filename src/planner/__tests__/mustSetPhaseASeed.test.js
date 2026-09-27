/**
 * Must films are hard constraints, but the count search must not stop at the
 * bare required assignment.
 */

import { describe, it, expect } from 'vitest'
import { generatePlanV3 } from '../optimizerV3'
import { generateCurrentPlan } from '../generateCurrentPlan'
import { films, screenings } from '../../utils/festivalData'
import { INTEREST_LEVELS } from '../../utils/userState'
import { validatePlan } from '../../utils/planValidator'

const MUST_TITLES = [
  'La Gradiva',
  'The Meltdown',
  'Minotaur',
  'Mouse',
  'Nuisance Bear',
  'Rehearsals for a Revolution'
]

const USER_ARRIVAL = {
  date: '2026-10-14',
  type: 'ferry',
  ferryId: 'ana-orc-0725',
  isVehicle: true,
  customTime: null
}

const USER_DEPARTURE = {
  date: '2026-10-19',
  type: 'ferry',
  ferryId: 'orc-ana-0650',
  isVehicle: true,
  customTime: null
}

function filmIdByTitle(title) {
  const film = films.find(f => f.title === title)
  if (!film) throw new Error(`Missing film: ${title}`)
  return film.id
}

describe('Must set count search (user ferry regression)', () => {
  it('packs far more than the six Must films for the Wed/Mon vehicle ferries', () => {
    const mustIds = MUST_TITLES.map(filmIdByTitle)
    const interests = Object.fromEntries(
      mustIds.map(id => [id, INTEREST_LEVELS.MUST_SEE])
    )

    const result = generateCurrentPlan({
      films,
      screenings,
      interests,
      constraints: { excludedFilms: [], requiredFilms: [] },
      arrival: USER_ARRIVAL,
      departure: USER_DEPARTURE,
      timeBudgetMs: 20000
    })

    expect(result.infeasible).toBe(false)
    for (const id of mustIds) {
      expect(result.screenings.some(s => s.filmId === id)).toBe(true)
    }
    // Capacity bound on this ferry window is 24, and the incumbent hits it.
    expect(result.filmCount).toBe(24)
    expect(result.metadata.maxFilmCountProven).toBe(true)
    expect(validatePlan(result, films, screenings).valid).toBe(true)
  }, 60000)
})

describe('Phase A improves a required-only seed', () => {
  it('packs compatible films across days even when the search budget is tiny', () => {
    const days = ['2026-10-14', '2026-10-15', '2026-10-16']
    const testFilms = []
    const testScreenings = []

    // Two Must films live inside day 1's block and also have a later showing,
    // so a required-only assignment is 2 films while each day can hold 6.
    for (const day of days) {
      for (let i = 0; i < 6; i++) {
        const id = `${day}-f${i}`
        const startH = 10 + i
        testFilms.push({ id, title: id, runtime: 50 })
        testScreenings.push({
          id: `${id}-s`,
          filmId: id,
          date: day,
          startTime: `${String(startH).padStart(2, '0')}:00`,
          endTime: `${String(startH).padStart(2, '0')}:50`,
          venue: 'Main'
        })
      }
    }

    const required = ['2026-10-14-f0', '2026-10-14-f1']
    // Alternate showings on the last day, overlapping that day's first two slots
    // so they are real options but do not increase the required-only seed.
    testScreenings.push(
      {
        id: 'alt-r0',
        filmId: required[0],
        date: '2026-10-16',
        startTime: '10:00',
        endTime: '10:50',
        venue: 'Main'
      },
      {
        id: 'alt-r1',
        filmId: required[1],
        date: '2026-10-16',
        startTime: '11:00',
        endTime: '11:50',
        venue: 'Main'
      }
    )

    const interests = {
      [required[0]]: INTEREST_LEVELS.MUST_SEE,
      [required[1]]: INTEREST_LEVELS.MUST_SEE
    }
    const attendanceDays = Object.fromEntries(days.map(d => [d, true]))

    const result = generatePlanV3({
      films: testFilms,
      screenings: testScreenings,
      interests,
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: { attendanceDays, availabilityByDate: {} },
      // Far too small for a cold required-first search of a larger instance,
      // and small enough that a 2-film seed would be returned if it were the incumbent.
      timeBudgetMs: 30
    })

    expect(result.infeasible).toBe(false)
    for (const id of required) {
      expect(result.screenings.some(s => s.filmId === id)).toBe(true)
    }
    // 6 + 6 + 6, with the two Must films already inside day 1.
    expect(result.filmCount).toBe(18)
  })
})
