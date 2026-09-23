/**
 * Development confidence check — also runnable via: npm run verify:planner
 */
import { describe, it, expect } from 'vitest'
import { films, screenings } from '../../utils/festivalData'
import { deriveFestivalAvailability } from '../../utils/festivalAvailability'
import { generatePlanV3 } from '../optimizerV3'
import { validatePlan } from '../../utils/planValidator'
import { INTEREST_LEVELS } from '../../utils/userState'

const BUDGET_MS = Number(process.env.VERIFY_BUDGET_MS || 120000)

describe('verify:planner', () => {
  it(
    'runs fixture + unrestricted real-data check',
    { timeout: BUDGET_MS * 2 + 30000 },
    () => {
      const arrival = { date: '2026-10-13', type: 'already-on-island' }
      const departure = { date: '2026-10-19', type: 'staying-longer' }
      const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(
        arrival,
        departure,
        []
      )

      const sorted = [...films].sort((a, b) => a.title.localeCompare(b.title))
      const interests = {}
      sorted.slice(0, 8).forEach(f => {
        interests[f.id] = INTEREST_LEVELS.MUST_SEE
      })
      sorted.slice(8, 20).forEach(f => {
        interests[f.id] = INTEREST_LEVELS.WANT_TO_SEE
      })
      sorted.slice(20, 30).forEach(f => {
        interests[f.id] = INTEREST_LEVELS.MAYBE
      })

      const mustN = Object.values(interests).filter(v => v === INTEREST_LEVELS.MUST_SEE).length
      const wantN = Object.values(interests).filter(v => v === INTEREST_LEVELS.WANT_TO_SEE).length
      const maybeN = Object.values(interests).filter(v => v === INTEREST_LEVELS.MAYBE).length

      console.log('=== OIFF Planner verification ===')
      console.log(`Films: ${films.length}  Screenings: ${screenings.length}`)
      console.log(`Budget: ${BUDGET_MS}ms`)
      console.log(`Fixture: ${mustN} Must, ${wantN} Want, ${maybeN} Maybe`)

      const result = generatePlanV3({
        films,
        screenings,
        interests,
        constraints: { excludedFilms: [], requiredFilms: [] },
        attendanceConstraints: { attendanceDays, availabilityByDate },
        timeBudgetMs: BUDGET_MS
      })

      const validation = validatePlan(result, films, screenings)

      console.log('--- Fixture result ---')
      console.log(`infeasible: ${result.infeasible}`)
      expect(result.infeasible).toBe(false)
      console.log(`filmCount: ${result.filmCount}`)
      console.log(
        `coverage: ${result.coverage?.must.included}/${result.coverage?.must.total} Must · ` +
          `${result.coverage?.want.included}/${result.coverage?.want.total} Want · ` +
          `${result.coverage?.maybe.included}/${result.coverage?.maybe.total} Maybe`
      )
      console.log(`status: ${result.metadata?.status}`)
      console.log(`maxFilmCountProven: ${result.metadata?.maxFilmCountProven}`)
      console.log(`preferenceOptimalityProven: ${result.metadata?.preferenceOptimalityProven}`)
      console.log(`combinationsExplored: ${result.metadata?.combinationsExplored}`)
      console.log(`elapsedMs: ${result.metadata?.elapsedMs?.toFixed(1)}`)
      console.log(`phaseMs:`, result.metadata?.phaseMs)
      console.log(`validation.valid: ${validation.valid}`)
      expect(validation.valid).toBe(true)
      console.log(`sameSize alternatives: ${result.alternatives?.sameSize?.length || 0}`)
      expect(result.alternatives?.oneFewer).toBeTruthy()
      expect(result.alternatives.oneFewer.filmCount).toBe(result.filmCount - 1)
      console.log(
        `oneFewer: ${result.alternatives.oneFewer.filmCount} films · ` +
          `adds=${result.alternatives.oneFewer.adds.map(a => a.title).join('|') || '—'} · ` +
          `drops=${result.alternatives.oneFewer.drops.map(d => d.title).join('|') || '—'}`
      )

      const unrestricted = generatePlanV3({
        films,
        screenings,
        interests: {},
        constraints: { excludedFilms: [], requiredFilms: [] },
        attendanceConstraints: { attendanceDays, availabilityByDate },
        timeBudgetMs: BUDGET_MS
      })

      console.log('--- Unrestricted (no ratings) ---')
      const dm = unrestricted.metadata?.dailyMaxima || {}
      const dayLabels = {
        '2026-10-14': 'Wed',
        '2026-10-15': 'Thu',
        '2026-10-16': 'Fri',
        '2026-10-17': 'Sat',
        '2026-10-18': 'Sun'
      }
      console.log('Daily maxima:')
      for (const [date, label] of Object.entries(dayLabels)) {
        console.log(`${label} ${dm[date] ?? '?'}`)
      }
      console.log(`Global count upper bound: ${unrestricted.metadata?.globalCountUpperBound}`)
      console.log(`Best plan: ${unrestricted.filmCount}`)
      console.log(`Max film count proven: ${unrestricted.metadata?.maxFilmCountProven}`)
      console.log(
        `Preference optimality proven: ${unrestricted.metadata?.preferenceOptimalityProven}`
      )
      console.log(`Best 23-film alternative: ${unrestricted.alternatives?.oneFewer?.filmCount ?? 'none'}`)
      console.log(`phaseMs:`, unrestricted.metadata?.phaseMs)
      console.log(`elapsedMs: ${unrestricted.metadata?.elapsedMs?.toFixed(1)}`)

      expect(unrestricted.filmCount).toBe(24)
      expect(unrestricted.metadata.maxFilmCountProven).toBe(true)
      expect(unrestricted.metadata.globalCountUpperBound).toBe(24)
      expect(unrestricted.alternatives.oneFewer).toBeTruthy()
      expect(unrestricted.alternatives.oneFewer.filmCount).toBe(23)
      expect(validatePlan(unrestricted, films, screenings).valid).toBe(true)
      expect(
        validatePlan(
          {
            screenings: unrestricted.alternatives.oneFewer.screenings,
            filmCount: 23
          },
          films,
          screenings
        ).valid
      ).toBe(true)

      console.log('OK')
    }
  )
})
