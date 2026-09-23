/**
 * Pair-check UI trust: error vs infeasible headlines.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PairCheckResult } from '../../components/SlotOptionsPanel'
import { shapePairCheckError } from '../pairCheck'

vi.mock('../../utils/festivalData', async () => {
  const actual = await vi.importActual('../../utils/festivalData')
  return {
    ...actual,
    getFilmById: id => ({ id, title: id === 'a' ? 'Film A' : 'Film B' })
  }
})

describe('PairCheckResult trust copy', () => {
  it('worker/runtime error says Couldn’t check — not No feasible schedule', () => {
    const pairCheck = shapePairCheckError({
      error: new Error('Worker failed'),
      filmIdA: 'a',
      filmIdB: 'b',
      currentPlan: { filmCount: 24 }
    })
    render(
      <PairCheckResult
        pairCheck={pairCheck}
        filmAId="a"
        filmBId="b"
        onRequireBoth={() => {}}
        onDismiss={() => {}}
      />
    )
    expect(screen.getByText(/Couldn.?t check these films/i)).toBeInTheDocument()
    expect(screen.getByText(/Try again/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/No feasible schedule contains both/i)
    ).not.toBeInTheDocument()
  })

  it('genuine infeasible still says No feasible schedule contains both', () => {
    render(
      <PairCheckResult
        pairCheck={{
          status: 'infeasible',
          feasible: false,
          reasonCode: 'required-film-conflict',
          reason: 'Required films conflict',
          conflict: null
        }}
        filmAId="a"
        filmBId="b"
        onRequireBoth={() => {}}
        onDismiss={() => {}}
      />
    )
    expect(
      screen.getByText(/No feasible schedule contains both/i)
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Couldn.?t check these films/i)
    ).not.toBeInTheDocument()
  })

  it('unproven delta-0 copy does not claim maximum', () => {
    render(
      <PairCheckResult
        pairCheck={{
          status: 'feasible',
          feasible: true,
          filmCountDelta: 0,
          pairFilmCount: 24,
          currentFilmCount: 24,
          pairMaxFilmCountProven: false,
          currentMaxFilmCountProven: false,
          preferenceOptimalityProven: false,
          screeningA: null,
          screeningB: null,
          adds: [],
          drops: []
        }}
        filmAId="a"
        filmBId="b"
        onRequireBoth={() => {}}
        onDismiss={() => {}}
      />
    )
    const count = screen.getByText(/You can still see 24 films/i)
    expect(count.textContent.toLowerCase()).not.toContain('maximum')
    expect(count.textContent).toMatch(/best schedule found/i)
  })
})
