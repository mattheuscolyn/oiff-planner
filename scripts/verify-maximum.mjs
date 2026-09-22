#!/usr/bin/env node
/**
 * Verify ground truth maximum achievable film counts
 * for the OIFF 2026 dataset under different availability scenarios
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load data files
const films = JSON.parse(readFileSync(join(__dirname, '../src/data/films.json'), 'utf-8'))
const screenings = JSON.parse(readFileSync(join(__dirname, '../src/data/screenings.json'), 'utf-8'))

// Simple parseTimeToMinutes implementation
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0
  const date = new Date(timeStr)
  return date.getHours() * 60 + date.getMinutes()
}

const FESTIVAL_DATES = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']

function getScreeningEndTime(screening, film) {
  if (screening.endTime) {
    return screening.endTime
  }
  // Fall back to startTime + runtime
  const start = new Date(screening.startTime)
  start.setMinutes(start.getMinutes() + film.runtime)
  return start.toISOString()
}

function screeningsOverlap(s1, s2, f1, f2) {
  const s1Start = new Date(s1.startTime).getTime()
  const s1End = new Date(getScreeningEndTime(s1, f1)).getTime()
  const s2Start = new Date(s2.startTime).getTime()
  const s2End = new Date(getScreeningEndTime(s2, f2)).getTime()
  
  return s1Start < s2End && s2Start < s1End
}

function isScreeningFeasible(screening, film, availFrom, availUntil) {
  if (!availFrom || !availUntil) return true
  
  const screeningStart = parseTimeToMinutes(screening.startTime)
  const screeningEnd = parseTimeToMinutes(getScreeningEndTime(screening, film))
  const availableFrom = parseTimeToMinutes(availFrom)
  const availableUntil = parseTimeToMinutes(availUntil)
  
  return screeningStart >= availableFrom && screeningEnd <= availableUntil
}

function findMaximumSchedule(availFrom = null, availUntil = null) {
  console.log(`\n=== Finding Maximum Schedule ===`)
  console.log(`Availability: ${availFrom || 'unrestricted'} - ${availUntil || 'unrestricted'}`)
  
  // Get feasible screenings for each day
  const screeningsByDay = {}
  for (const date of FESTIVAL_DATES) {
    screeningsByDay[date] = screenings.filter(s => {
      if (s.date !== date) return false
      const film = films.find(f => f.id === s.filmId)
      if (!film) return false
      return isScreeningFeasible(s, film, availFrom ? `${date}T${availFrom}` : null, availUntil ? `${date}T${availUntil}` : null)
    })
    console.log(`${date}: ${screeningsByDay[date].length} feasible screenings`)
  }
  
  // Greedy approach: for each day, find maximum non-overlapping schedule
  const dailyMaxSchedules = {}
  for (const date of FESTIVAL_DATES) {
    const dayScreenings = screeningsByDay[date]
    
    // Sort by start time
    dayScreenings.sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    
    // Greedy: pick earliest ending non-overlapping screenings
    const selected = []
    for (const screening of dayScreenings) {
      const film = films.find(f => f.id === screening.filmId)
      
      // Check if this screening overlaps with any selected
      let overlaps = false
      for (const sel of selected) {
        const selFilm = films.find(f => f.id === sel.filmId)
        if (screeningsOverlap(screening, sel, film, selFilm)) {
          overlaps = true
          break
        }
      }
      
      if (!overlaps) {
        selected.push(screening)
      }
    }
    
    dailyMaxSchedules[date] = selected
    const uniqueFilms = new Set(selected.map(s => s.filmId))
    console.log(`  → ${selected.length} screenings, ${uniqueFilms.size} unique films`)
  }
  
  // Combine across days, ensuring each film appears at most once
  const filmMap = new Map() // filmId -> best screening choice
  
  for (const date of FESTIVAL_DATES) {
    for (const screening of dailyMaxSchedules[date]) {
      if (!filmMap.has(screening.filmId)) {
        filmMap.set(screening.filmId, screening)
      }
    }
  }
  
  console.log(`\nTotal unique films across all days: ${filmMap.size}`)
  
  // List the films
  const selectedFilms = Array.from(filmMap.keys()).map(id => films.find(f => f.id === id))
  console.log(`\nSelected films:`)
  selectedFilms.forEach((f, i) => {
    const screening = filmMap.get(f.id)
    console.log(`  ${i + 1}. ${f.title} (${screening.date} ${new Date(screening.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })})`)
  })
  
  return filmMap.size
}

// Test 1: Default availability (9 AM - 11 PM)
const max1 = findMaximumSchedule('09:00', '23:00')

// Test 2: Unrestricted (all published screening times)
const max2 = findMaximumSchedule(null, null)

console.log(`\n\n=== GROUND TRUTH VERIFICATION ===`)
console.log(`Maximum with 9 AM - 11 PM: ${max1} films`)
console.log(`Maximum unrestricted: ${max2} films`)
console.log(`Expected: 23 films with 9-11 PM, 24 films unrestricted`)
