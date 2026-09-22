import { describe, it, expect } from 'vitest'
import {
  getSailingsForDate,
  parseTimeToMinutes,
  minutesToTime,
  calculateArrivalAvailability,
  calculateDepartureAvailability,
  isTimeAvailable,
  formatAvailabilitySummary,
  VEHICLE_TERMINAL_BUFFER,
  ISLAND_TRANSFER_BUFFER
} from '../ferryData'

describe('Ferry Data Utilities', () => {
  describe('getSailingsForDate', () => {
    it('should return sailings for a specific date and direction', () => {
      const sailings = getSailingsForDate('2026-10-14', 'to-orcas')
      expect(sailings.length).toBeGreaterThan(0)
      expect(sailings[0]).toHaveProperty('departingTerminal')
      expect(sailings[0]).toHaveProperty('arrivingTerminal')
    })
    
    it('should filter by correct day of week', () => {
      // Oct 14, 2026 is a Wednesday (day 3)
      const wednesdaySailings = getSailingsForDate('2026-10-14', 'to-orcas')
      // Oct 18, 2026 is a Sunday (day 0)
      const sundaySailings = getSailingsForDate('2026-10-18', 'to-orcas')
      
      // Sunday should have different sailings than weekday
      expect(wednesdaySailings.length).toBeGreaterThan(0)
      expect(sundaySailings.length).toBeGreaterThan(0)
    })
    
    it('should return to-orcas sailings from Anacortes', () => {
      const sailings = getSailingsForDate('2026-10-15', 'to-orcas')
      expect(sailings.every(s => s.departingTerminal === 'Anacortes')).toBe(true)
      expect(sailings.every(s => s.arrivingTerminal === 'Orcas Island')).toBe(true)
    })
    
    it('should return from-orcas sailings to Anacortes', () => {
      const sailings = getSailingsForDate('2026-10-15', 'from-orcas')
      expect(sailings.every(s => s.departingTerminal === 'Orcas Island')).toBe(true)
      expect(sailings.every(s => s.arrivingTerminal === 'Anacortes')).toBe(true)
    })
  })
  
  describe('parseTimeToMinutes', () => {
    it('should parse midnight correctly', () => {
      expect(parseTimeToMinutes('00:00')).toBe(0)
    })
    
    it('should parse noon correctly', () => {
      expect(parseTimeToMinutes('12:00')).toBe(720)
    })
    
    it('should parse afternoon time correctly', () => {
      expect(parseTimeToMinutes('14:30')).toBe(870) // 14*60 + 30
    })
    
    it('should parse late evening correctly', () => {
      expect(parseTimeToMinutes('23:59')).toBe(1439)
    })
  })
  
  describe('minutesToTime', () => {
    it('should convert 0 minutes to 00:00', () => {
      expect(minutesToTime(0)).toBe('00:00')
    })
    
    it('should convert 720 minutes to 12:00', () => {
      expect(minutesToTime(720)).toBe('12:00')
    })
    
    it('should convert 870 minutes to 14:30', () => {
      expect(minutesToTime(870)).toBe('14:30')
    })
    
    it('should handle values over 24 hours with modulo', () => {
      expect(minutesToTime(1440)).toBe('00:00') // Next day
      expect(minutesToTime(1500)).toBe('01:00')
    })
  })
  
  describe('calculateArrivalAvailability', () => {
    it('should add island transfer buffer after ferry arrival', () => {
      const sailing = {
        arrivalTime: '08:30'
      }
      
      const result = calculateArrivalAvailability(sailing, false)
      const arrivalMinutes = parseTimeToMinutes('08:30')
      const expectedMinutes = arrivalMinutes + ISLAND_TRANSFER_BUFFER
      
      expect(result).toBe(minutesToTime(expectedMinutes))
    })
    
    it('should calculate same availability for vehicle and walk-on arrival', () => {
      const sailing = {
        arrivalTime: '11:40'
      }
      
      const vehicleResult = calculateArrivalAvailability(sailing, true)
      const walkonResult = calculateArrivalAvailability(sailing, false)
      
      // After arrival, both should have same availability (only transfer buffer matters)
      expect(vehicleResult).toBe(walkonResult)
    })
  })
  
  describe('calculateDepartureAvailability', () => {
    it('should subtract vehicle terminal buffer and transfer buffer for vehicle', () => {
      const sailing = {
        departureTime: '19:30'
      }
      
      const result = calculateDepartureAvailability(sailing, true)
      const departureMinutes = parseTimeToMinutes('19:30')
      const expectedMinutes = departureMinutes - VEHICLE_TERMINAL_BUFFER - ISLAND_TRANSFER_BUFFER
      
      expect(result).toBe(minutesToTime(expectedMinutes))
    })
    
    it('should use smaller buffer for walk-on passengers', () => {
      const sailing = {
        departureTime: '19:30'
      }
      
      const vehicleResult = calculateDepartureAvailability(sailing, true)
      const walkonResult = calculateDepartureAvailability(sailing, false)
      
      const vehicleMinutes = parseTimeToMinutes(vehicleResult)
      const walkonMinutes = parseTimeToMinutes(walkonResult)
      
      // Walk-on should have more availability time (smaller buffer)
      expect(walkonMinutes).toBeGreaterThan(vehicleMinutes)
    })
  })
  
  describe('isTimeAvailable', () => {
    it('should return true for time within window', () => {
      expect(isTimeAvailable('14:00', '10:00', '18:00')).toBe(true)
    })
    
    it('should return true for time at start of window', () => {
      expect(isTimeAvailable('10:00', '10:00', '18:00')).toBe(true)
    })
    
    it('should return true for time at end of window', () => {
      expect(isTimeAvailable('18:00', '10:00', '18:00')).toBe(true)
    })
    
    it('should return false for time before window', () => {
      expect(isTimeAvailable('09:00', '10:00', '18:00')).toBe(false)
    })
    
    it('should return false for time after window', () => {
      expect(isTimeAvailable('19:00', '10:00', '18:00')).toBe(false)
    })
  })
  
  describe('formatAvailabilitySummary', () => {
    it('should format availability window for display', () => {
      const result = formatAvailabilitySummary('09:30', '17:45')
      expect(result).toContain('9:30')
      expect(result).toContain('5:45')
      expect(result).toContain('AM')
      expect(result).toContain('PM')
    })
  })
})
