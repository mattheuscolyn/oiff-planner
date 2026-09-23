/**
 * Real-data QA for slot options + Pickpocket labels + local vs global distinction.
 * Run: node --experimental-vm-modules node_modules/vitest/vitest.mjs run ...
 * Or: npx vitest run src/planner/__tests__/slotOptionsRealData.qa.test.js
 */

import { describe, it, expect } from 'vitest'
import { generatePlanV3 } from '../optimizerV3'
import { shapePairCheckResult } from '../pairCheck'
import { films, screenings } from '../../utils/festivalData'
import { INTEREST_LEVELS } from '../../utils/userState'
import { deriveFestivalAvailability } from '../../utils/festivalAvailability'
import { getFerries } from '../../utils/ferryData'

const PICKPOCKET_ID = '6aaa7a51feb4d1d7423e75b8'

describe('slot options real-data QA', () => {
  it(
    'reports slot alternatives and finds local-vs-global distinction',
    { timeout: 120000 },
    () => {
      const ferries = getFerries()
      const arrival = { date: '2026-10-13', type: 'already-on-island' }
      const departure = { date: '2026-10-19', type: 'staying-longer' }
      const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(
        arrival,
        departure,
        ferries
      )

      // Rate everything Maybe except Skip/Seen unset — maximize interesting alternatives
      const interests = {}
      for (const f of films) {
        interests[f.id] = INTEREST_LEVELS.MAYBE
      }
      // Boost a few wants so preference has texture
      for (const f of films.slice(0, 15)) {
        interests[f.id] = INTEREST_LEVELS.WANT_TO_SEE
      }

      const plan = generatePlanV3({
        films,
        screenings,
        interests,
        constraints: { excludedFilms: [], requiredFilms: [] },
        attendanceConstraints: { attendanceDays, availabilityByDate },
        timeBudgetMs: 25000
      })

      expect(plan.infeasible).toBe(false)
      expect(plan.slotOptions).toBeTruthy()
      expect(plan.filmCount).toBeGreaterThanOrEqual(20)

      const report = []
      let rowsWithAlts = 0
      for (const s of plan.screenings) {
        const opts = plan.slotOptions[s.id] || []
        if (opts.length === 0) continue
        rowsWithAlts++
        const film = films.find(f => f.id === s.filmId)
        const line = {
          plannedFilm: film?.title,
          plannedScreening: `${s.date} ${s.startTime} ${s.venue}`,
          altCount: opts.length,
          alts: opts.slice(0, 8).map(o => ({
            film: o.filmTitle,
            screening: `${o.date} ${o.startTime} ${o.venue}`,
            published: o.totalPublishedScreeningCount,
            attendanceValid: o.attendanceValidScreeningCount,
            localFits: o.localFitScreeningCount,
            onlyPublished: o.onlyPublishedScreening,
            onlyAttendance: o.onlyAttendanceValidScreening,
            onlyPlanFit: o.onlyCurrentPlanFit,
            badge: o.availabilityBadge?.label
          }))
        }
        report.push(line)
      }

      console.log('\n=== SLOT OPTIONS QA (sample rows with alternatives) ===')
      console.log(JSON.stringify(report.slice(0, 6), null, 2))
      console.log(`Rows with ≥1 local alternative: ${rowsWithAlts}/${plan.screenings.length}`)

      expect(rowsWithAlts).toBeGreaterThan(0)

      // Pickpocket screening counts / label
      const pickpocketPublished = screenings.filter(s => s.filmId === PICKPOCKET_ID)
      console.log('\n=== PICKPOCKET ===')
      console.log(
        pickpocketPublished.map(s => `${s.date} ${s.startTime} ${s.venue} (${s.id})`)
      )
      expect(pickpocketPublished.length).toBeGreaterThanOrEqual(2)

      const pickInPlan = plan.screenings.find(s => s.filmId === PICKPOCKET_ID)
      if (pickInPlan) {
        // If Pickpocket is planned, it won't appear as an alternative to itself;
        // check its published count metadata isn't used as "Only screening" elsewhere
        console.log('Pickpocket is IN plan at', pickInPlan.date, pickInPlan.startTime, pickInPlan.venue)
      } else {
        // Find any slot option referring to Pickpocket
        let found = null
        for (const s of plan.screenings) {
          const hit = (plan.slotOptions[s.id] || []).find(o => o.filmId === PICKPOCKET_ID)
          if (hit) {
            found = { planned: s, opt: hit }
            break
          }
        }
        if (found) {
          console.log('Pickpocket as slot alt:', found.opt)
          expect(found.opt.onlyPublishedScreening).toBe(false)
          expect(found.opt.totalPublishedScreeningCount).toBe(pickpocketPublished.length)
          expect(found.opt.availabilityBadge?.code).not.toBe('only-screening')
        } else {
          console.log('Pickpocket not in plan and not a local slot alt for this interest mix')
        }
      }

      // Find local-replace AND globally compatible pair
      let distinction = null
      outer: for (const s of plan.screenings) {
        const opts = plan.slotOptions[s.id] || []
        for (const opt of opts.slice(0, 4)) {
          // Quick pair check with smaller budget
          const pair = generatePlanV3({
            films,
            screenings,
            interests,
            constraints: {
              excludedFilms: [],
              requiredFilms: [s.filmId, opt.filmId].filter(
                id => interests[id] !== INTEREST_LEVELS.MUST_SEE
              )
            },
            attendanceConstraints: { attendanceDays, availabilityByDate },
            timeBudgetMs: 12000
          })
          if (pair.infeasible) continue
          const shaped = shapePairCheckResult({
            currentPlan: plan,
            pairPlan: pair,
            filmIdA: s.filmId,
            filmIdB: opt.filmId,
            filmMap: new Map(films.map(f => [f.id, f]))
          })
          // Local alt screening differs from pair's chosen screening for alternate → distinction
          const pairScreeningB = shaped.screeningB
          if (
            shaped.feasible &&
            pairScreeningB &&
            pairScreeningB.id !== opt.screeningId
          ) {
            distinction = {
              plannedFilm: films.find(f => f.id === s.filmId)?.title,
              plannedScreening: `${s.date} ${s.startTime}`,
              localAltFilm: opt.filmTitle,
              localAltScreening: `${opt.date} ${opt.startTime} ${opt.venue}`,
              globalAltScreening: `${pairScreeningB.date} ${pairScreeningB.startTime} ${pairScreeningB.venue}`,
              pairFilmCount: shaped.pairFilmCount,
              currentFilmCount: shaped.currentFilmCount
            }
            break outer
          }
          // Also accept: both fit using same screening but that's weaker; keep looking for different
          if (shaped.feasible && !distinction) {
            distinction = {
              plannedFilm: films.find(f => f.id === s.filmId)?.title,
              plannedScreening: `${s.date} ${s.startTime}`,
              localAltFilm: opt.filmTitle,
              localAltScreening: `${opt.date} ${opt.startTime} ${opt.venue}`,
              globalAltScreening: pairScreeningB
                ? `${pairScreeningB.date} ${pairScreeningB.startTime} ${pairScreeningB.venue}`
                : null,
              pairFilmCount: shaped.pairFilmCount,
              currentFilmCount: shaped.currentFilmCount,
              note: 'both fit (may reuse local screening)'
            }
          }
        }
      }

      console.log('\n=== LOCAL ALT + GLOBAL BOTH ===')
      console.log(JSON.stringify(distinction, null, 2))
      expect(distinction).toBeTruthy()
      expect(distinction.pairFilmCount).toBeGreaterThan(0)
    }
  )
})
