import { useState, useMemo } from 'react'
import { films } from '../utils/festivalData'
import { INTEREST_LEVELS } from '../utils/userState'
import { useUserState } from '../contexts/UserStateContext'
import FilmCard from './FilmCard'
import FilmDetail from './FilmDetail'
import './FilmsView.css'

function FilmsView() {
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('schedule')
  const [selectedFilm, setSelectedFilm] = useState(null)
  const { interests, updateFilmInterest } = useUserState()

  const filteredFilms = useMemo(() => {
    let result = [...films]

    if (filter === 'must-see') {
      result = result.filter(f => interests[f.id] === INTEREST_LEVELS.MUST_SEE)
    } else if (filter === 'want-to-see') {
      result = result.filter(f => interests[f.id] === INTEREST_LEVELS.WANT_TO_SEE)
    } else if (filter === 'maybe') {
      result = result.filter(f => interests[f.id] === INTEREST_LEVELS.MAYBE)
    } else if (filter === 'unrated') {
      result = result.filter(f => !interests[f.id] || interests[f.id] === null)
    }

    if (sort === 'title') {
      result.sort((a, b) => a.title.localeCompare(b.title))
    } else if (sort === 'interest') {
      const interestOrder = {
        [INTEREST_LEVELS.MUST_SEE]: 0,
        [INTEREST_LEVELS.WANT_TO_SEE]: 1,
        [INTEREST_LEVELS.MAYBE]: 2,
        null: 3,
        [INTEREST_LEVELS.SKIP]: 4,
        [INTEREST_LEVELS.SEEN]: 5
      }
      result.sort((a, b) => {
        const orderA = interestOrder[interests[a.id]] ?? 3
        const orderB = interestOrder[interests[b.id]] ?? 3
        return orderA - orderB
      })
    }

    return result
  }, [filter, sort, interests])

  return (
    <div className="films-view">
      <div className="films-controls">
        <div className="control-group">
          <label htmlFor="filter-select">Filter:</label>
          <select 
            id="filter-select"
            value={filter} 
            onChange={(e) => setFilter(e.target.value)}
            className="control-select"
          >
            <option value="all">All Films</option>
            <option value="must-see">Must See</option>
            <option value="want-to-see">Want to See</option>
            <option value="maybe">Maybe</option>
            <option value="unrated">Unrated</option>
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="sort-select">Sort:</label>
          <select 
            id="sort-select"
            value={sort} 
            onChange={(e) => setSort(e.target.value)}
            className="control-select"
          >
            <option value="schedule">Festival Schedule</option>
            <option value="title">Title</option>
            <option value="interest">My Interest</option>
          </select>
        </div>
      </div>

      <div className="films-grid">
        {filteredFilms.map(film => (
          <FilmCard
            key={film.id}
            film={film}
            interest={interests[film.id]}
            onInterestChange={updateFilmInterest}
            onFilmClick={() => setSelectedFilm(film)}
          />
        ))}
      </div>

      {filteredFilms.length === 0 && (
        <div className="empty-state">
          <p>No films match your current filter.</p>
        </div>
      )}

      {selectedFilm && (
        <FilmDetail
          film={selectedFilm}
          onClose={() => setSelectedFilm(null)}
        />
      )}
    </div>
  )
}

export default FilmsView
