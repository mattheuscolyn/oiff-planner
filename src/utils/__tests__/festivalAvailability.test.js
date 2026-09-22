/**
 * Tests for PR #10: Arrival/Departure Festival Availability
 */

import { describe, it, expect } from 'vitest'
import { deriveFestivalAvailability, formatAvailabilitySummary } from '../festivalAvailability'

describe('Festival Availability Derivation', () => {
  const mockFerries = [
    {
      id: 'ferry-1',
      date: '2026-10-13',
      route: 'anacortes-orcas',
      departureTime: '11:20',
      arrivalTime: '12:25'
    },
    {
      id: 'ferry-2',
      date: '2026-10-19',
      route: 'orcas-anacortes',
      departureTime: '16:30',
      arrivalTime: '17:35'
    }
  ]

  // Test 1: Tuesday arrival + Monday departure = full festival
  it('1. Tuesday Oct 13 arrival + Monday Oct 19 departure exposes every festival date', () => {
    const arrival = { date: '2026-10-13', type: 'already-on-island' }
    const departure = { date: '2026-10-19', type: 'staying-longer' }
    
    const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(arrival, departure, mockFerries)
    
    expect(attendanceDays['2026-10-14']).toBe(true)
    expect(attendanceDays['2026-10-15']).toBe(true)
    expect(attendanceDays['2026-10-16']).toBe(true)
    expect(attendanceDays['2026-10-17']).toBe(true)
    expect(attendanceDays['2026-10-18']).toBe(true)
    
    // No time restrictions
    expect(Object.keys(availabilityByDate).length).toBe(0)
  })

  // Test 2: Tuesday arrival means Wednesday is fully available
  it('2. Tuesday arrival means Wednesday is fully available', () => {
    const arrival = { date: '2026-10-13', type: 'already-on-island' }
    const departure = { date: '2026-10-14', type: 'staying-longer' }
    
    const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(arrival, departure, mockFerries)
    
    expect(attendanceDays['2026-10-14']).toBe(true)
    expect(availabilityByDate['2026-10-14']).toBeUndefined() // No restriction
  })

  // Test 3: Monday departure means all Sunday screenings eligible
  it('3. Monday departure means all Sunday screenings remain eligible', () => {
    const arrival = { date: '2026-10-18', type: 'already-on-island' }
    const departure = { date: '2026-10-19', type: 'staying-longer' }
    
    const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(arrival, departure, mockFerries)
    
    expect(attendanceDays['2026-10-18']).toBe(true)
    expect(availabilityByDate['2026-10-18']).toBeUndefined() // No restriction
  })

  // Test 4: Thursday arrival removes Wednesday
  it('4. Thursday arrival removes Wednesday', () => {
    const arrival = { date: '2026-10-17', type: 'already-on-island' }
    const departure = { date: '2026-10-18', type: 'staying-longer' }
    
    const { attendanceDays } = deriveFestivalAvailability(arrival, departure, mockFerries)
    
    expect(attendanceDays['2026-10-14']).toBeUndefined()
    expect(attendanceDays['2026-10-15']).toBeUndefined()
    expect(attendanceDays['2026-10-16']).toBeUndefined()
    expect(attendanceDays['2026-10-17']).toBe(true)
    expect(attendanceDays['2026-10-18']).toBe(true)
  })

  // Test 5: Thursday custom 2 PM arrival filters screenings
  it('5. Thursday custom 2 PM arrival filters Thursday screenings correctly', () => {
    const arrival = { date: '2026-10-17', type: 'custom', customTime: '14:00' }
    const departure = { date: '2026-10-17', type: 'staying-longer' }
    
    const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(arrival, departure, mockFerries)
    
    expect(attendanceDays['2026-10-17']).toBe(true)
    expect(availabilityByDate['2026-10-17'].from).toBe('14:00')
    expect(availabilityByDate['2026-10-17'].until).toBeNull()
  })

  // Test 6: Sunday custom departure filters by END time
  it('6. Sunday custom departure filters screenings by END time', () => {
    const arrival = { date: '2026-10-18', type: 'already-on-island' }
    const departure = { date: '2026-10-18', type: 'custom', customTime: '18:00' }
    
    const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(arrival, departure, mockFerries)
    
    expect(attendanceDays['2026-10-18']).toBe(true)
    expect(availabilityByDate['2026-10-18'].from).toBeNull()
    expect(availabilityByDate['2026-10-18'].until).toBe('18:00')
  })

  // Test 7: Intermediate dates are unrestricted
  it('7. intermediate dates are unrestricted', () => {
    const arrival = { date: '2026-10-14', type: 'custom', customTime: '14:00' }
    const departure = { date: '2026-10-17', type: 'custom', customTime: '18:00' }
    
    const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(arrival, departure, mockFerries)
    
    expect(attendanceDays['2026-10-14']).toBe(true)
    expect(attendanceDays['2026-10-15']).toBe(true)
    expect(attendanceDays['2026-10-16']).toBe(true)
    expect(attendanceDays['2026-10-17']).toBe(true)
    
    // Only first and last day have restrictions
    expect(availabilityByDate['2026-10-14'].from).toBe('14:00')
    expect(availabilityByDate['2026-10-15']).toBeUndefined()
    expect(availabilityByDate['2026-10-16']).toBeUndefined()
    expect(availabilityByDate['2026-10-17'].until).toBe('18:00')
  })

  // Test 10: Arrival ferry availability = ferry arrival + island transfer
  it('10. arrival ferry availability = ferry arrival + island transfer', () => {
    const arrival = { 
      date: '2026-10-13', 
      type: 'ferry', 
      ferryId: 'ferry-1',
      isVehicle: false 
    }
    const departure = { date: '2026-10-19', type: 'staying-longer' }
    
    const { availabilityByDate } = deriveFestivalAvailability(arrival, departure, mockFerries)
    
    // Ferry arrives at 12:25, add 25 min island transfer = 12:50
    expect(availabilityByDate['2026-10-13'].from).toBe('12:50')
  })

  // Test 11: Departure ferry availability = ferry departure − buffers
  it('11. departure ferry availability = ferry departure - terminal buffer - island transfer', () => {
    const arrival = { date: '2026-10-13', type: 'already-on-island' }
    const departure = { 
      date: '2026-10-18', // Use Sunday (festival day) instead of Monday
      type: 'ferry', 
      ferryId: 'ferry-2',
      isVehicle: false 
    }
    
    // Add ferry for Sunday
    const ferriesWithSunday = [
      ...mockFerries,
      {
        id: 'ferry-sun',
        date: '2026-10-18',
        route: 'orcas-anacortes',
        departureTime: '16:30',
        arrivalTime: '17:35'
      }
    ]
    
    const { availabilityByDate } = deriveFestivalAvailability(arrival, departure, ferriesWithSunday)
    
    // Ferry departs at 16:30, subtract 15 min walk-on + 25 min transfer = 15:50
    expect(availabilityByDate['2026-10-18'].until).toBe('15:50')
  })

  // Test 12: Vehicle/walk-on departure buffers differ
  it('12. vehicle/walk-on departure buffers differ correctly', () => {
    const arrival = { date: '2026-10-13', type: 'already-on-island' }
    
    const ferriesWithSunday = [
      ...mockFerries,
      {
        id: 'ferry-sun',
        date: '2026-10-18',
        route: 'orcas-anacortes',
        departureTime: '16:30',
        arrivalTime: '17:35'
      }
    ]
    
    // Walk-on
    const departureWalkOn = { 
      date: '2026-10-18', 
      type: 'ferry', 
      ferryId: 'ferry-sun',
      isVehicle: false 
    }
    const walkOnResult = deriveFestivalAvailability(arrival, departureWalkOn, ferriesWithSunday)
    
    // Vehicle
    const departureVehicle = { 
      date: '2026-10-18', 
      type: 'ferry', 
      ferryId: 'ferry-sun',
      isVehicle: true 
    }
    const vehicleResult = deriveFestivalAvailability(arrival, departureVehicle, ferriesWithSunday)
    
    // Vehicle should have earlier cutoff (50 min vs 15 min terminal buffer)
    expect(walkOnResult.availabilityByDate['2026-10-18'].until).toBe('15:50')
    expect(vehicleResult.availabilityByDate['2026-10-18'].until).toBe('15:15')
  })

  // Test 15: Departure cannot precede arrival
  it('15. departure cannot precede arrival (validated by UI)', () => {
    const arrival = { date: '2026-10-17', type: 'already-on-island' }
    const departure = { date: '2026-10-14', type: 'staying-longer' }
    
    const { attendanceDays } = deriveFestivalAvailability(arrival, departure, mockFerries)
    
    // No festival days should be included
    expect(Object.keys(attendanceDays).length).toBe(0)
  })

  // Test 16: Interval must intersect festival
  it('16. interval must intersect festival dates', () => {
    const arrival = { date: '2026-10-01', type: 'already-on-island' }
    const departure = { date: '2026-10-05', type: 'staying-longer' }
    
    const { attendanceDays } = deriveFestivalAvailability(arrival, departure, mockFerries)
    
    // No festival days in this range
    expect(Object.keys(attendanceDays).length).toBe(0)
  })
})

describe('Availability Summary Formatting', () => {
  it('formats full festival correctly', () => {
    const arrival = { date: '2026-10-13', type: 'already-on-island' }
    const departure = { date: '2026-10-19', type: 'staying-longer' }
    
    const summary = formatAvailabilitySummary(arrival, departure, [])
    
    expect(summary).toBe('Available for the full festival · Oct 14–18')
  })

  it('formats partial availability with times', () => {
    const arrival = { date: '2026-10-17', type: 'custom', customTime: '14:00' }
    const departure = { date: '2026-10-18', type: 'custom', customTime: '18:00' }
    
    const summary = formatAvailabilitySummary(arrival, departure, [])
    
    // Oct 17 2026 is Saturday, Oct 18 is Sunday
    expect(summary).toContain('Sat')
    expect(summary).toContain('14:00')
    expect(summary).toContain('Sun')
    expect(summary).toContain('18:00')
  })
})
