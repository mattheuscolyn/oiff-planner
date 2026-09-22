/**
 * Festival Availability Derivation
 * 
 * This module provides the canonical logic for deriving festival attendance
 * constraints from arrival and departure choices.
 * 
 * PR #10: Replaces manual per-day attendance grid with automatic derivation.
 */

import { getFerryById, getFestivalDates } from './ferryData'

// Island transfer buffers (minutes)
const ISLAND_TRANSFER_BUFFER = 25 // Ferry terminal → venue or venue → ferry terminal

// Terminal arrival buffers for departure (minutes)
const VEHICLE_TERMINAL_BUFFER = 50 // Recommended for vehicle reservations
const WALKON_TERMINAL_BUFFER = 15  // Smaller buffer for walk-on passengers

/**
 * Derive festival availability from arrival and departure configuration
 * 
 * @param {Object} arrival - { date, type, ferryId, isVehicle, customTime }
 * @param {Object} departure - { date, type, ferryId, isVehicle, customTime }
 * @param {Array} ferries - Ferry data array
 * @returns {Object} - { attendanceDays: {date: true}, availabilityByDate: {date: {from, until}} }
 */
export function deriveFestivalAvailability(arrival, departure, ferries = []) {
  const festivalDates = getFestivalDates().map(d => d.date)
  const arrivalDate = arrival.date
  const departureDate = departure.date
  
  // Determine which festival days fall within the arrival→departure interval
  const attendanceDays = {}
  const availabilityByDate = {}
  
  festivalDates.forEach(festivalDate => {
    // Include festival date if it falls within the travel interval
    // BUT: arrival/departure dates themselves may be travel-only days
    // Only include actual festival dates (Oct 14-18)
    if (festivalDate >= arrivalDate && festivalDate <= departureDate) {
      attendanceDays[festivalDate] = true
      
      // Calculate time windows for this date
      const isArrivalDay = festivalDate === arrivalDate
      const isDepartureDay = festivalDate === departureDate
      
      let fromTime = null
      let untilTime = null
      
      // Arrival constraints
      if (isArrivalDay) {
        fromTime = calculateEarliestAvailability(arrival, ferries)
      }
      
      // Departure constraints
      if (isDepartureDay) {
        untilTime = calculateLatestAvailability(departure, ferries)
      }
      
      // Only set availability window if there's an actual constraint
      if (fromTime || untilTime) {
        availabilityByDate[festivalDate] = {
          from: fromTime,
          until: untilTime
        }
      }
      // If neither from nor until, the optimizer will treat as unrestricted for that day
    }
  })
  
  return { attendanceDays, availabilityByDate }
}

/**
 * Calculate earliest festival availability on arrival day
 */
function calculateEarliestAvailability(arrival, ferries) {
  const { type, ferryId, customTime } = arrival
  
  if (type === 'already-on-island') {
    // No restriction - available for all published screenings
    return null
  }
  
  if (type === 'custom' && customTime) {
    return customTime
  }
  
  if (type === 'ferry' && ferryId) {
    const ferry = getFerryById(ferryId, ferries)
    if (ferry && ferry.arrivalTime) {
      // Add island transfer buffer after ferry arrival
      return addMinutes(ferry.arrivalTime, ISLAND_TRANSFER_BUFFER)
    }
  }
  
  // Fallback: no constraint
  return null
}

/**
 * Calculate latest festival availability on departure day
 */
function calculateLatestAvailability(departure, ferries) {
  const { type, ferryId, isVehicle, customTime } = departure
  
  if (type === 'staying-longer') {
    // No restriction - available for all published screenings
    return null
  }
  
  if (type === 'custom' && customTime) {
    return customTime
  }
  
  if (type === 'ferry' && ferryId) {
    const ferry = getFerryById(ferryId, ferries)
    if (ferry && ferry.departureTime) {
      // Subtract terminal buffer + island transfer before ferry departure
      const terminalBuffer = isVehicle ? VEHICLE_TERMINAL_BUFFER : WALKON_TERMINAL_BUFFER
      const totalBuffer = terminalBuffer + ISLAND_TRANSFER_BUFFER
      return subtractMinutes(ferry.departureTime, totalBuffer)
    }
  }
  
  // Fallback: no constraint
  return null
}

/**
 * Add minutes to a time string (HH:MM format)
 */
function addMinutes(timeStr, minutes) {
  if (!timeStr) return null
  const [hours, mins] = timeStr.split(':').map(Number)
  const totalMinutes = hours * 60 + mins + minutes
  const newHours = Math.floor(totalMinutes / 60) % 24
  const newMins = totalMinutes % 60
  return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`
}

/**
 * Subtract minutes from a time string (HH:MM format)
 */
function subtractMinutes(timeStr, minutes) {
  if (!timeStr) return null
  const [hours, mins] = timeStr.split(':').map(Number)
  let totalMinutes = hours * 60 + mins - minutes
  if (totalMinutes < 0) totalMinutes = 0 // Don't go negative
  const newHours = Math.floor(totalMinutes / 60) % 24
  const newMins = totalMinutes % 60
  return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`
}

/**
 * Format availability summary for display
 */
export function formatAvailabilitySummary(arrival, departure, ferries = []) {
  const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(arrival, departure, ferries)
  
  const dates = Object.keys(attendanceDays).sort()
  if (dates.length === 0) return 'No festival days selected'
  
  // Check if it's the full festival
  const festivalDates = getFestivalDates().map(d => d.date)
  const isFullFestival = festivalDates.every(d => attendanceDays[d])
  
  // Check if there are any time restrictions
  const hasRestrictions = Object.keys(availabilityByDate).length > 0
  
  if (isFullFestival && !hasRestrictions) {
    return 'Available for the full festival · Oct 14–18'
  }
  
  // Format partial availability
  const firstDate = dates[0]
  const lastDate = dates[dates.length - 1]
  const firstAvail = availabilityByDate[firstDate]
  const lastAvail = availabilityByDate[lastDate]
  
  let summary = ''
  
  if (firstDate === lastDate) {
    // Single day
    summary = formatDate(firstDate)
    if (firstAvail?.from || firstAvail?.until) {
      if (firstAvail.from && firstAvail.until) {
        summary += ` ${firstAvail.from}–${firstAvail.until}`
      } else if (firstAvail.from) {
        summary += ` after ${firstAvail.from}`
      } else {
        summary += ` until ${firstAvail.until}`
      }
    }
  } else {
    // Multiple days
    summary = formatDate(firstDate)
    if (firstAvail?.from) {
      summary += ` after ${firstAvail.from}`
    }
    summary += ' → '
    summary += formatDate(lastDate)
    if (lastAvail?.until) {
      summary += ` until ${lastAvail.until}`
    }
  }
  
  return summary
}

/**
 * Format date for display (e.g., "Thu Oct 15")
 */
function formatDate(dateStr) {
  const date = new Date(dateStr + 'T12:00:00')
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${dayNames[date.getDay()]} ${monthNames[date.getMonth()]} ${date.getDate()}`
}
