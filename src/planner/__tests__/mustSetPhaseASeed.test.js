/**
 * Regression: six Must films that are jointly feasible must not falsely
 * report "No schedule can include all required films" under the default budget.
 */

import { describe, it, expect } from 'vitest'
import { generatePlanV3 } from '../optimizerV3'
import { films, screenings } from '../../utils/festivalData'
import { INTEREST_LEVELS } from '../../utils/userState'
import { deriveFestivalAvailability } from '../../utils/festivalAvailability'
import { getFerries } from '../../utils/ferryData'

const MUST_TITLES = [
  'La Gradiva',
  'The Meltdown',
  'Minotaur',
  'Mouse',
  'Nuisance Bear',
  'Rehearsals for a Revolution'
]

function filmIdByTitle(title) {
  const film = films.find(f => f.title === title)
  if (!film) throw new Error(`Missing film: ${title}`)
  return film.id
}

describe('Must set Phase A seed (user regression)', () => {
  it('finds a feasible plan for the six-Must set with other films eligible', () => {
    const mustIds = MUST_TITLES.map(filmIdByTitle)
    const interests = Object.fromEntries(
      mustIds.map(id => [id, INTEREST_LEVELS.MUST_SEE])
    )

    const arrival = {
      date: '2026-10-13',
      type: 'already-on-island',
      ferryId: null,
      isVehicle: false,
      customTime: null
    }
    const departure = {
      date: '2026-10-19',
      type: 'staying-longer',
      ferryId: null,
      isVehicle: false,
      customTime: null
    }
    const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(
      arrival,
      departure,
      getFerries()
    )

    const result = generatePlanV3({
      films,
      screenings,
      interests,
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: { attendanceDays, availabilityByDate },
      timeBudgetMs: 20000
    })

    expect(result.infeasible).toBe(false)
    for (const id of mustIds) {
      expect(result.screenings.some(s => s.filmId === id)).toBe(true)
    }
    expect(result.filmCount).toBeGreaterThanOrEqual(mustIds.length)
  }, 60000)
})
