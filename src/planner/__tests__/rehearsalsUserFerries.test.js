/**
 * User-reported attendance: Wed 8:20 arrival ferry + Mon 6:50 departure ferry.
 * Must Rehearsals must remain feasible via Saturday (Mon encore is after departure).
 */

import { describe, it, expect } from 'vitest'
import { films, screenings } from '../../utils/festivalData'
import { generatePlanV3 } from '../optimizerV3'
import { INTEREST_LEVELS } from '../../utils/userState'
import {
  deriveFestivalAvailability,
  classifyScreeningVsAttendance
} from '../../utils/festivalAvailability'
import { getFerries } from '../../utils/ferryData'

const REHEARSALS_ID = '6aaa7a51feb4d1d7423e75aa'

function userAttendance() {
  const ferries = getFerries()
  const arriveFerry = ferries.find(
    f => f.date === '2026-10-14' && f.route === 'anacortes-orcas' && f.arrivalTime === '08:20'
  )
  const departFerry = ferries.find(
    f => f.date === '2026-10-19' && f.route === 'orcas-anacortes' && f.departureTime === '06:50'
  )
  const arrival = {
    date: '2026-10-14',
    type: 'ferry',
    ferryId: arriveFerry.id,
    isVehicle: false
  }
  const departure = {
    date: '2026-10-19',
    type: 'ferry',
    ferryId: departFerry.id,
    isVehicle: false
  }
  return {
    ...deriveFestivalAvailability(arrival, departure, ferries),
    arrival,
    departure
  }
}

describe('Rehearsals with Wed 8:20 / Mon 6:50 ferries', () => {
  it('marks Sat inside attendance and Mon encore after departure', () => {
    const { attendanceDays, availabilityByDate } = userAttendance()
    expect(availabilityByDate['2026-10-14'].from).toBe('08:45')
    expect(availabilityByDate['2026-10-19'].until).toBe('06:10')

    const film = films.find(f => f.id === REHEARSALS_ID)
    const [sat, mon] = screenings
      .filter(s => s.filmId === REHEARSALS_ID)
      .sort((a, b) => a.date.localeCompare(b.date))

    expect(classifyScreeningVsAttendance(sat, film, attendanceDays, availabilityByDate)).toMatchObject({
      code: 'ok',
      eligible: true
    })
    expect(classifyScreeningVsAttendance(mon, film, attendanceDays, availabilityByDate)).toMatchObject({
      code: 'after-departure',
      eligible: false
    })
  })

  it(
    'Must Rehearsals alone is feasible via Saturday',
    { timeout: 45000 },
    () => {
      const { attendanceDays, availabilityByDate } = userAttendance()
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
      expect(pick?.date).toBe('2026-10-17')
      expect(pick?.startTime).toBe('10:00')
    }
  )
})
