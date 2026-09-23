/**
 * RequiredConflictView — conflict resolution UI
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { INTEREST_LEVELS } from '../../utils/userState'

const { filmA, filmB, filmC, screenings } = vi.hoisted(() => {
  const filmA = {
    id: 'film-a',
    title: 'Once Upon a Time in Harlem',
    year: 2026,
    director: 'William Greaves',
    poster: 'https://example.com/a.jpg'
  }
  const filmB = {
    id: 'film-b',
    title: 'Iron Boy',
    year: 2026,
    director: 'Louis Clichy',
    poster: 'https://example.com/b.jpg'
  }
  const filmC = {
    id: 'film-c',
    title: 'Third Film',
    year: 2026,
    director: 'Someone',
    poster: 'https://example.com/c.jpg'
  }
  const screenings = {
    sa1: {
      id: 'sa1',
      filmId: 'film-a',
      date: '2026-10-14',
      startTime: '11:00',
      endTime: '12:40',
      venue: 'Orcas Center Main'
    },
    sb1: {
      id: 'sb1',
      filmId: 'film-b',
      date: '2026-10-14',
      startTime: '12:00',
      endTime: '13:30',
      venue: 'Sea View Theatre'
    },
    sc1: {
      id: 'sc1',
      filmId: 'film-c',
      date: '2026-10-15',
      startTime: '10:00',
      endTime: '11:30',
      venue: 'Orcas Center BlackBox'
    }
  }
  return { filmA, filmB, filmC, screenings }
})

vi.mock('../../utils/festivalData', async () => {
  const actual = await vi.importActual('../../utils/festivalData')
  const filmMap = {
    'film-a': filmA,
    'film-b': filmB,
    'film-c': filmC
  }
  return {
    ...actual,
    getFilmById: id => filmMap[id] || actual.getFilmById(id),
    getScreeningById: id => screenings[id] || actual.getScreeningById(id)
  }
})

import RequiredConflictView from '../RequiredConflictView'

describe('RequiredConflictView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders pairwise conflict with showtimes and prioritize actions', () => {
    const onPrioritize = vi.fn()

    render(
      <RequiredConflictView
        plan={{
          infeasible: true,
          reasonCode: 'required-film-conflict',
          conflict: {
            filmIds: ['film-a', 'film-b'],
            minimal: true,
            size: 2,
            films: [
              { filmId: 'film-a', feasibleScreeningIds: ['sa1'] },
              { filmId: 'film-b', feasibleScreeningIds: ['sb1'] }
            ],
            overlaps: [
              {
                screeningAId: 'sa1',
                screeningBId: 'sb1',
                filmAId: 'film-a',
                filmBId: 'film-b',
                date: '2026-10-14'
              }
            ]
          }
        }}
        interests={{
          'film-a': INTEREST_LEVELS.MUST_SEE,
          'film-b': INTEREST_LEVELS.MUST_SEE
        }}
        manualRequired={[]}
        onPrioritizeFilm={onPrioritize}
        onRelaxFilm={vi.fn()}
        onBackToRatings={vi.fn()}
        onBackToAttendance={vi.fn()}
      />
    )

    expect(screen.getByText('Two required films can’t both fit')).toBeTruthy()
    expect(screen.getByText('Once Upon a Time in Harlem')).toBeTruthy()
    expect(screen.getByText('Iron Boy')).toBeTruthy()
    expect(screen.getByText(/Orcas Center Main/)).toBeTruthy()
    expect(screen.getByText(/Sea View Theatre/)).toBeTruthy()
    expect(screen.getAllByText(/Conflicts with/).length).toBeGreaterThan(0)
    expect(screen.getByText('Back to ratings')).toBeTruthy()
    expect(screen.queryByText('Start Over')).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: /Prioritize Once Upon a Time in Harlem/i })
    )
    expect(onPrioritize).toHaveBeenCalledWith('film-a')
  })

  it('3+ conflict offers explicit relax actions', () => {
    const onRelax = vi.fn()
    render(
      <RequiredConflictView
        plan={{
          infeasible: true,
          reasonCode: 'required-film-conflict',
          conflict: {
            filmIds: ['film-a', 'film-b', 'film-c'],
            minimal: true,
            size: 3,
            films: [
              { filmId: 'film-a', feasibleScreeningIds: ['sa1'] },
              { filmId: 'film-b', feasibleScreeningIds: ['sb1'] },
              { filmId: 'film-c', feasibleScreeningIds: ['sc1'] }
            ],
            overlaps: []
          }
        }}
        interests={{
          'film-a': INTEREST_LEVELS.MUST_SEE,
          'film-b': INTEREST_LEVELS.MUST_SEE,
          'film-c': INTEREST_LEVELS.MUST_SEE
        }}
        manualRequired={[]}
        onPrioritizeFilm={vi.fn()}
        onRelaxFilm={onRelax}
        onBackToRatings={vi.fn()}
        onBackToAttendance={vi.fn()}
      />
    )

    expect(screen.getByText(/3 required films can’t all fit/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Relax requirement for Iron Boy/i }))
    expect(onRelax).toHaveBeenCalledWith('film-b')
  })
})
