import { createContext, useContext, useState, useCallback } from 'react'
import {
  getFilmInterests,
  setFilmInterest as persistFilmInterest,
  getSelectedScreenings,
  setSelectedScreenings as persistSelectedScreenings
} from '../utils/userState'

const UserStateContext = createContext(null)

export function UserStateProvider({ children }) {
  const [interests, setInterests] = useState(() => getFilmInterests())
  const [selectedScreeningIds, setSelectedScreeningIds] = useState(() => getSelectedScreenings())

  const updateFilmInterest = useCallback((filmId, interest) => {
    persistFilmInterest(filmId, interest)
    setInterests(getFilmInterests())
  }, [])

  const toggleScreening = useCallback((screeningId) => {
    const current = [...selectedScreeningIds]
    const newSelected = current.includes(screeningId)
      ? current.filter(id => id !== screeningId)
      : [...current, screeningId]
    
    persistSelectedScreenings(newSelected)
    setSelectedScreeningIds(newSelected)
  }, [selectedScreeningIds])

  const value = {
    interests,
    selectedScreeningIds,
    updateFilmInterest,
    toggleScreening
  }

  return (
    <UserStateContext.Provider value={value}>
      {children}
    </UserStateContext.Provider>
  )
}

export function useUserState() {
  const context = useContext(UserStateContext)
  if (!context) {
    throw new Error('useUserState must be used within UserStateProvider')
  }
  return context
}
