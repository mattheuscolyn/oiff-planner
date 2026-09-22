import festivalData from '../data/films.json'

export const { films, screenings, venues, festivalDates } = festivalData

export function getFilmById(filmId) {
  return films.find(f => f.id === filmId)
}

export function getScreeningById(screeningId) {
  return screenings.find(s => s.id === screeningId)
}

export function getScreeningsForFilm(filmId) {
  return screenings.filter(s => s.filmId === filmId)
}

export function getScreeningEndTime(screening) {
  if (screening.endTime) {
    return screening.endTime
  }
  
  const film = getFilmById(screening.filmId)
  if (!film || !film.runtime) return null
  
  const [hours, minutes] = screening.startTime.split(':').map(Number)
  const startMinutes = hours * 60 + minutes
  const endMinutes = startMinutes + film.runtime
  
  const endHours = Math.floor(endMinutes / 60)
  const endMins = endMinutes % 60
  
  return `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`
}

export const DEFAULT_TRANSITION_BUFFER = 15

export function screeningsOverlap(screening1, screening2) {
  if (screening1.date !== screening2.date) return false
  
  const [s1Hours, s1Minutes] = screening1.startTime.split(':').map(Number)
  const [s2Hours, s2Minutes] = screening2.startTime.split(':').map(Number)
  
  const s1Start = s1Hours * 60 + s1Minutes
  const s2Start = s2Hours * 60 + s2Minutes
  
  const film1 = getFilmById(screening1.filmId)
  const film2 = getFilmById(screening2.filmId)
  
  if (!film1 || !film2) return false
  
  const s1End = s1Start + film1.runtime
  const s2End = s2Start + film2.runtime
  
  return (s1Start < s2End && s2Start < s1End)
}

export function findConflictingScreenings(screening, allSelectedScreenings) {
  return allSelectedScreenings.filter(s => 
    s.id !== screening.id && screeningsOverlap(screening, s)
  )
}

export function hasAlternateScreening(filmId, excludeScreeningId) {
  const filmScreenings = getScreeningsForFilm(filmId)
  return filmScreenings.some(s => s.id !== excludeScreeningId)
}

export function getCompatibleAlternateScreenings(filmId, conflictingScreenings) {
  const allScreenings = getScreeningsForFilm(filmId)
  
  return allScreenings.filter(screening => {
    return !conflictingScreenings.some(conflict => 
      screeningsOverlap(screening, conflict)
    )
  })
}

export function hasCompatibleAlternate(filmId, conflictingScreenings) {
  const compatibles = getCompatibleAlternateScreenings(filmId, conflictingScreenings)
  return compatibles.length > 0
}

export function formatDate(dateString) {
  const date = new Date(dateString + 'T00:00:00')
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export function formatTime(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`
}

export function getScreeningsByDate(date) {
  return screenings.filter(s => s.date === date)
}
