/**
 * Rehearsals for a Revolution Must + Monday encore attendance.
 */

import { describe, it, expect } from 'vitest'
import { films, screenings } from '../../utils/festivalData'
import { generatePlanV3 } from '../optimizerV3'
import { INTEREST_LEVELS } from '../../utils/userState'
import { deriveFestivalAvailability } from '../../utils/festivalAvailability'
import { getFerries } from '../../utils/ferryData'

const REHEARSALS_ID = '6aaa7a51feb4d1d7423e75aa'

describe('Rehearsals Must with Monday encore', () => {
  it(
    'Must is feasible via Monday screening when Saturday morning is after arrival',
    { timeout: 45000 },
    () => {
      const ferries = getFerries()
      // Arrive Saturday afternoon — misses Sat 10:00 Rehearsals
      const arrival = { date: '2026-10-17', type: 'custom', customTime: '14:00' }
      const departure = { date: '2026-10-19', type: 'staying-longer' }
      const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(
        arrival,
        departure,
        ferries
      )

      expect(attendanceDays['2026-10-17']).toBe(true)
      expect(attendanceDays['2026-10-19']).toBe(true)
      expect(availabilityByDate['2026-10-17']?.from).toBe('14:00')

      const interests = Object.fromEntries(
        films.map(f => [f.id, INTEREST_LEVELS.MAYBE])
      )
      interests[REHEARSALS_ID] = INTEREST_LEVELS.MUST_SEE

      const result = generatePlanV3({
        films,
        screenings,
        interests,
        constraints: { excludedFilms: [], requiredFilms: [] },
        attendanceConstraints: { attendanceDays, availabilityByDate },
        timeBudgetMs: 20000
      })

      expect(result.infeasible).toBe(false)
      const pick = result.screenings.find(s => s.filmId === REHEARSALS_ID)
      expect(pick).toBeTruthy()
      expect(pick.date).toBe('2026-10-19')
      expect(pick.startTime).toBe('17:00')
    }
  )

  it('school screening alone does not satisfy Endless Frontier Must', () => {
    const ENDLESS = '6aaa7a51feb4d1d7423e75b4'
    const ferries = getFerries()
    const arrival = { date: '2026-10-13', type: 'already-on-island' }
    const departure = { date: '2026-10-19', type: 'staying-longer' }
    const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(
      arrival,
      departure,
      ferries
    )

    const interests = Object.fromEntries(
      films.map(f => [f.id, INTEREST_LEVELS.MAYBE])
    )
    interests[ENDLESS] = INTEREST_LEVELS.MUST_SEE

    const result = generatePlanV3({
      films,
      screenings,
      interests,
      constraints: { excludedFilms: [], requiredFilms: [] },
      attendanceConstraints: { attendanceDays, availabilityByDate },
      timeBudgetMs: 5000
    })

    expect(result.infeasible).toBe(true)
    expect(result.reasonCode).toBe('required-film-unavailable')
    expect(result.unavailable?.filmId).toBe(ENDLESS)
  })
})
