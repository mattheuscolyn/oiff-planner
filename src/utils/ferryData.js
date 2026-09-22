/**
 * Ferry Schedule Utilities
 * 
 * Functions for working with Washington State Ferries schedule data
 * and calculating festival availability based on ferry travel.
 */

import ferrySchedule from '../data/ferries.json'

// Constants for time buffers (in minutes)
export const VEHICLE_TERMINAL_BUFFER = 50 // 45-60 min recommended for vehicle check-in
export const WALKON_TERMINAL_BUFFER = 15 // Shorter buffer for walk-on passengers
export const ISLAND_TRANSFER_BUFFER = 25 // Travel time from Orcas ferry terminal to festival venues

/**
 * Get all sailings for a specific route and date
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} direction - 'to-orcas' or 'from-orcas'
 * @returns {Array} Array of applicable sailings
 */
export function getSailingsForDate(date, direction) {
  const targetDate = new Date(date + 'T00:00:00')
  const dayOfWeek = targetDate.getDay() // 0=Sunday, 6=Saturday
  
  const routeFilter = direction === 'to-orcas' ? 'anacortes-orcas' : 'orcas-anacortes'
  
  return ferrySchedule.sailings
    .filter(sailing => 
      sailing.route === routeFilter &&
      sailing.daysOfWeek.includes(dayOfWeek)
    )
    .map(sailing => ({
      ...sailing,
      date,
      displayLabel: `${sailing.departureTime} ${sailing.departingTerminal} → ${sailing.arrivalTime} ${sailing.arrivingTerminal}`
    }))
}

/**
 * Parse time string (HH:MM) and return minutes since midnight
 * @param {string} timeStr - Time in HH:MM format
 * @returns {number} Minutes since midnight
 */
export function parseTimeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * Convert minutes since midnight to HH:MM format
 * @param {number} minutes - Minutes since midnight
 * @returns {string} Time in HH:MM format
 */
export function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60) % 24
  const mins = Math.floor(minutes % 60)
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
}

/**
 * Format time for display (e.g., "1:30 PM")
 * @param {string} timeStr - Time in HH:MM format
 * @returns {string} Formatted time
 */
export function formatTimeDisplay(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`
}

/**
 * Calculate earliest festival availability after arrival ferry
 * @param {object} sailing - Ferry sailing object
 * @param {boolean} isVehicle - Whether traveling with vehicle
 * @returns {string} Earliest available time in HH:MM format
 */
export function calculateArrivalAvailability(sailing, isVehicle = false) {
  const arrivalMinutes = parseTimeToMinutes(sailing.arrivalTime)
  const buffer = isVehicle ? 0 : 0 // No buffer needed after arrival, only transfer time
  const availableMinutes = arrivalMinutes + buffer + ISLAND_TRANSFER_BUFFER
  return minutesToTime(availableMinutes)
}

/**
 * Calculate latest festival availability before departure ferry
 * @param {object} sailing - Ferry sailing object
 * @param {boolean} isVehicle - Whether traveling with vehicle
 * @returns {string} Latest available time in HH:MM format
 */
export function calculateDepartureAvailability(sailing, isVehicle = false) {
  const departureMinutes = parseTimeToMinutes(sailing.departureTime)
  const terminalBuffer = isVehicle ? VEHICLE_TERMINAL_BUFFER : WALKON_TERMINAL_BUFFER
  const latestMinutes = departureMinutes - terminalBuffer - ISLAND_TRANSFER_BUFFER
  return minutesToTime(latestMinutes)
}

/**
 * Check if a time falls within an availability window
 * @param {string} timeStr - Time to check (HH:MM)
 * @param {string} availableFrom - Start of availability window (HH:MM)
 * @param {string} availableUntil - End of availability window (HH:MM)
 * @returns {boolean} True if time is within window
 */
export function isTimeAvailable(timeStr, availableFrom, availableUntil) {
  const time = parseTimeToMinutes(timeStr)
  const fromTime = parseTimeToMinutes(availableFrom)
  const untilTime = parseTimeToMinutes(availableUntil)
  
  // Handle overnight windows (shouldn't happen for OIFF but be safe)
  if (untilTime < fromTime) {
    return time >= fromTime || time <= untilTime
  }
  
  return time >= fromTime && time <= untilTime
}

/**
 * Get formatted availability summary for display
 * @param {string} availableFrom - Start time (HH:MM)
 * @param {string} availableUntil - End time (HH:MM)
 * @returns {string} Formatted summary (e.g., "1:30 PM – 5:55 PM")
 */
export function formatAvailabilitySummary(availableFrom, availableUntil) {
  return `${formatTimeDisplay(availableFrom)} – ${formatTimeDisplay(availableUntil)}`
}

/**
 * Get official festival dates for OIFF 2026
 * @returns {Array} Array of date objects with festival day info
 */
export function getFestivalDates() {
  return [
    { date: '2026-10-14', label: 'Wednesday Oct 14', dayOfWeek: 3 },
    { date: '2026-10-15', label: 'Thursday Oct 15', dayOfWeek: 4 },
    { date: '2026-10-16', label: 'Friday Oct 16', dayOfWeek: 5 },
    { date: '2026-10-17', label: 'Saturday Oct 17', dayOfWeek: 6 },
    { date: '2026-10-18', label: 'Sunday Oct 18', dayOfWeek: 0 },
  ]
}

/**
 * Get default all-day availability times
 * @returns {object} Object with from and until times
 */
export function getDefaultAvailability() {
  return {
    from: '09:00',
    until: '23:00'
  }
}

/**
 * Get all ferries with dates
 */
export function getFerries() {
  // Generate ferries with specific dates for festival window
  const ferries = []
  const dates = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']
  
  dates.forEach(date => {
    const toOrcas = getSailingsForDate(date, 'to-orcas')
    const fromOrcas = getSailingsForDate(date, 'from-orcas')
    ferries.push(...toOrcas, ...fromOrcas)
  })
  
  return ferries
}

/**
 * Get ferry by ID
 */
export function getFerryById(id, ferryList) {
  const list = ferryList || getFerries()
  return list.find(f => f.id === id)
}
