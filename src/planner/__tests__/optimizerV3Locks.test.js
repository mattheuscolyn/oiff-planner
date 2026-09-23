/**
 * Legacy screening-lock tests retired — locks replaced by film-level requiredFilms.
 * See filmLevelPlanner.test.js for the current contract.
 */
import { describe, it, expect } from 'vitest'
import { resolveRequiredFilms } from '../requiredFilms'
import { INTEREST_LEVELS } from '../../utils/userState'

describe('Legacy lockedScreenings removed', () => {
  it('planner uses film-level requiredFilms instead of screening locks', () => {
    const r = resolveRequiredFilms(
      { f1: INTEREST_LEVELS.MUST_SEE },
      { requiredFilms: [], excludedFilms: [] }
    )
    expect(r.requiredFilmIds).toEqual(['f1'])
  })
})
