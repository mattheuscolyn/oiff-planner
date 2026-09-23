/**
 * FilmPoster runtime fallback: TMDB → Eventive → placeholder
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import FilmPoster from '../FilmPoster'
import { getPosterCandidates } from '../../utils/tmdbPosters'

vi.mock('../../utils/tmdbPosters', async () => {
  const actual = await vi.importActual('../../utils/tmdbPosters')
  return {
    ...actual,
    getPosterCandidates: vi.fn()
  }
})

describe('getPosterCandidates (real)', () => {
  it('orders TMDB then Eventive', async () => {
    const real = await vi.importActual('../../utils/tmdbPosters')
    // Use a film id that exists in tmdb-posters.json if any
    const ids = Object.keys(
      (await import('../../data/tmdb-posters.json')).default
    )
    const filmId = ids[0]
    const film = {
      id: filmId,
      title: 'Test',
      poster: 'https://example.com/eventive.jpg'
    }
    const c = real.getPosterCandidates(film, 'card')
    expect(c[0].source).toBe('tmdb')
    expect(c[1].source).toBe('eventive')
    expect(c[1].url).toBe('https://example.com/eventive.jpg')
  })

  it('starts with Eventive when no TMDB', async () => {
    const real = await vi.importActual('../../utils/tmdbPosters')
    const c = real.getPosterCandidates(
      { id: 'no-tmdb-id', title: 'X', poster: 'https://example.com/e.jpg' },
      'card'
    )
    expect(c).toEqual([{ url: 'https://example.com/e.jpg', source: 'eventive' }])
  })

  it('empty when neither source exists', async () => {
    const real = await vi.importActual('../../utils/tmdbPosters')
    expect(real.getPosterCandidates({ id: 'none', title: 'Y' }, 'card')).toEqual([])
  })
})

describe('FilmPoster image-load fallback', () => {
  beforeEach(() => {
    getPosterCandidates.mockReset()
  })

  it('shows TMDB when it succeeds', () => {
    getPosterCandidates.mockReturnValue([
      { url: 'https://tmdb.example/a.jpg', source: 'tmdb' },
      { url: 'https://eventive.example/a.jpg', source: 'eventive' }
    ])
    render(<FilmPoster film={{ id: 'f1', title: 'Film One' }} size="card" />)
    const img = screen.getByRole('img', { name: 'Film One poster' })
    expect(img.getAttribute('src')).toBe('https://tmdb.example/a.jpg')
    expect(img.closest('.film-poster').className).toContain('source-tmdb')
  })

  it('advances to Eventive when TMDB fails', () => {
    getPosterCandidates.mockReturnValue([
      { url: 'https://tmdb.example/a.jpg', source: 'tmdb' },
      { url: 'https://eventive.example/a.jpg', source: 'eventive' }
    ])
    render(<FilmPoster film={{ id: 'f1', title: 'Film One' }} size="card" />)
    const img = screen.getByRole('img', { name: 'Film One poster' })
    act(() => {
      fireEvent.error(img)
    })
    const next = screen.getByRole('img', { name: 'Film One poster' })
    expect(next.getAttribute('src')).toBe('https://eventive.example/a.jpg')
    expect(next.closest('.film-poster').className).toContain('source-eventive')
  })

  it('shows placeholder when TMDB and Eventive both fail', () => {
    getPosterCandidates.mockReturnValue([
      { url: 'https://tmdb.example/a.jpg', source: 'tmdb' },
      { url: 'https://eventive.example/a.jpg', source: 'eventive' }
    ])
    render(<FilmPoster film={{ id: 'f1', title: 'Film One' }} size="card" />)
    act(() => {
      fireEvent.error(screen.getByRole('img', { name: 'Film One poster' }))
    })
    act(() => {
      fireEvent.error(screen.getByRole('img', { name: 'Film One poster' }))
    })
    expect(screen.getByRole('img', { name: /no poster available/i })).toBeTruthy()
    expect(screen.getByText('Film One')).toBeTruthy()
    expect(document.querySelector('.film-poster').className).toContain('source-placeholder')
  })

  it('starts with Eventive when no TMDB candidate', () => {
    getPosterCandidates.mockReturnValue([
      { url: 'https://eventive.example/only.jpg', source: 'eventive' }
    ])
    render(<FilmPoster film={{ id: 'f2', title: 'Film Two' }} size="card" />)
    expect(screen.getByRole('img').getAttribute('src')).toBe(
      'https://eventive.example/only.jpg'
    )
  })

  it('shows placeholder when there are no candidates', () => {
    getPosterCandidates.mockReturnValue([])
    render(<FilmPoster film={{ id: 'f3', title: 'Film Three' }} size="card" />)
    expect(screen.queryByRole('img', { name: 'Film Three poster' })).toBeNull()
    expect(screen.getByRole('img', { name: /no poster available/i })).toBeTruthy()
  })

  it('resets failed-source state when switching films', () => {
    getPosterCandidates.mockImplementation(film => {
      if (film.id === 'f1') {
        return [
          { url: 'https://tmdb.example/a.jpg', source: 'tmdb' },
          { url: 'https://eventive.example/a.jpg', source: 'eventive' }
        ]
      }
      return [
        { url: 'https://tmdb.example/b.jpg', source: 'tmdb' },
        { url: 'https://eventive.example/b.jpg', source: 'eventive' }
      ]
    })

    const { rerender } = render(
      <FilmPoster film={{ id: 'f1', title: 'Film One' }} size="card" />
    )
    act(() => {
      fireEvent.error(screen.getByRole('img', { name: 'Film One poster' }))
    })
    expect(screen.getByRole('img').getAttribute('src')).toBe(
      'https://eventive.example/a.jpg'
    )

    rerender(<FilmPoster film={{ id: 'f2', title: 'Film Two' }} size="card" />)
    expect(screen.getByRole('img', { name: 'Film Two poster' }).getAttribute('src')).toBe(
      'https://tmdb.example/b.jpg'
    )
  })
})
