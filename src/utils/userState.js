const INTEREST_KEY = 'oiff-planner-interests'
const PLAN_KEY = 'oiff-planner-plan'
const VERSION_KEY = 'oiff-planner-version'
const CURRENT_VERSION = '2'

export const INTEREST_LEVELS = {
  MUST_SEE: 'must-see',
  WANT_TO_SEE: 'want-to-see',
  MAYBE: 'maybe',
  SKIP: 'skip',
  SEEN: 'seen'
}

function checkAndMigrateVersion() {
  if (!safeLocalStorage()) return
  
  try {
    const storedVersion = localStorage.getItem(VERSION_KEY)
    
    if (storedVersion !== CURRENT_VERSION) {
      localStorage.removeItem(INTEREST_KEY)
      localStorage.removeItem(PLAN_KEY)
      localStorage.setItem(VERSION_KEY, CURRENT_VERSION)
    }
  } catch (error) {
    console.error('Version check failed:', error)
  }
}

function safeLocalStorage() {
  try {
    const test = '__storage_test__'
    localStorage.setItem(test, test)
    localStorage.removeItem(test)
    return true
  } catch {
    return false
  }
}

export function getFilmInterests() {
  checkAndMigrateVersion()
  if (!safeLocalStorage()) return {}
  
  try {
    const stored = localStorage.getItem(INTEREST_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

export function setFilmInterest(filmId, interest) {
  if (!safeLocalStorage()) return
  
  try {
    const interests = getFilmInterests()
    
    if (interest === null || interest === undefined) {
      delete interests[filmId]
    } else {
      interests[filmId] = interest
    }
    
    localStorage.setItem(INTEREST_KEY, JSON.stringify(interests))
  } catch (error) {
    console.error('Failed to save interest:', error)
  }
}

export function getFilmInterest(filmId) {
  const interests = getFilmInterests()
  return interests[filmId] || null
}

export function getSelectedScreenings() {
  checkAndMigrateVersion()
  if (!safeLocalStorage()) return []
  
  try {
    const stored = localStorage.getItem(PLAN_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

export function setSelectedScreenings(screeningIds) {
  if (!safeLocalStorage()) return
  
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(screeningIds))
  } catch (error) {
    console.error('Failed to save plan:', error)
  }
}

export function isScreeningSelected(screeningId) {
  const selected = getSelectedScreenings()
  return selected.includes(screeningId)
}

export function toggleScreeningSelection(screeningId) {
  const selected = getSelectedScreenings()
  const newSelected = selected.includes(screeningId)
    ? selected.filter(id => id !== screeningId)
    : [...selected, screeningId]
  
  setSelectedScreenings(newSelected)
  return newSelected
}
