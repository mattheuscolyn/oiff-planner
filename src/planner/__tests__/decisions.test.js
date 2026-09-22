import { describe, it, expect } from 'vitest'
import {
  isScreeningFeasible,
  getFeasibleScreenings,
  hasCompatibleScreeningPair,
  detectUnavoidableConflicts,
  getDecisionKey,
  getAutoResolution
} from '../decisions'

describe('Decisions Detection', () => {
  const mockFilms = [
    { id: 'film-1', title: 'Film A', runtime: 120 },
    { id: 'film-2', title: 'Film B', runtime: 90 },
    { id: 'film-3', title: 'Film C', runtime: 100 }
  ]
  
  const mockScreenings = [
    { id: 's1', filmId: 'film-1', date: '2026-10-14', time: '10:00', startTime: '10:00', endTime: '12:00', venue: 'Main' },
    { id: 's2', filmId: 'film-1', date: '2026-10-14', time: '19:00', startTime: '19:00', endTime: '21:00', venue: 'Main' },
    { id: 's3', filmId: 'film-2', date: '2026-10-14', time: '10:30', startTime: '10:30', endTime: '12:00', venue: 'BlackBox' },
    { id: 's4', filmId: 'film-2', date: '2026-10-15', time: '14:00', startTime: '14:00', endTime: '15:30', venue: 'Main' },
    { id: 's5', filmId: 'film-3', date: '2026-10-14', time: '10:00', startTime: '10:00', endTime: '11:40', venue: 'BlackBox' }
  ]
  
  describe('isScreeningFeasible', () => {
    it('should return false for non-selected day', () => {
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': false,
          '2026-10-15': true
        },
        availabilityByDate: {}
      }
      
      const result = isScreeningFeasible(
        mockScreenings[0],
        mockFilms[0],
        attendanceConstraints
      )
      
      expect(result).toBe(false)
    })
    
    it('should return true for selected day with no time constraints', () => {
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': true
        },
        availabilityByDate: {}
      }
      
      const result = isScreeningFeasible(
        mockScreenings[0],
        mockFilms[0],
        attendanceConstraints
      )
      
      expect(result).toBe(true)
    })
    
    it('should return false for screening starting before availability window', () => {
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': true
        },
        availabilityByDate: {
          '2026-10-14': {
            from: '11:00',
            until: '23:00'
          }
        }
      }
      
      const result = isScreeningFeasible(
        mockScreenings[0], // 10:00 start
        mockFilms[0], // 120 min runtime
        attendanceConstraints
      )
      
      expect(result).toBe(false)
    })
    
    it('should return false for screening ending after availability window', () => {
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': true
        },
        availabilityByDate: {
          '2026-10-14': {
            from: '09:00',
            until: '11:00'
          }
        }
      }
      
      const result = isScreeningFeasible(
        mockScreenings[0], // 10:00 start
        mockFilms[0], // 120 min runtime, ends at 12:00
        attendanceConstraints
      )
      
      expect(result).toBe(false)
    })
    
    it('should return true for screening within availability window', () => {
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': true
        },
        availabilityByDate: {
          '2026-10-14': {
            from: '09:00',
            until: '13:00'
          }
        }
      }
      
      const result = isScreeningFeasible(
        mockScreenings[0], // 10:00 start
        mockFilms[0], // 120 min runtime, ends at 12:00
        attendanceConstraints
      )
      
      expect(result).toBe(true)
    })
  })
  
  describe('getFeasibleScreenings', () => {
    it('should return only feasible screenings', () => {
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': true,
          '2026-10-15': false
        },
        availabilityByDate: {}
      }
      
      const result = getFeasibleScreenings(
        mockFilms[1], // Film B
        mockScreenings,
        attendanceConstraints,
        []
      )
      
      // Film B has screenings on both days, but only Oct 14 is selected
      expect(result.length).toBe(1)
      expect(result[0].date).toBe('2026-10-14')
    })
    
    it('should always include locked screenings', () => {
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': false,
          '2026-10-15': true
        },
        availabilityByDate: {}
      }
      
      const result = getFeasibleScreenings(
        mockFilms[1], // Film B
        mockScreenings,
        attendanceConstraints,
        ['s3'] // Lock the Oct 14 screening even though day is not selected
      )
      
      // Should include both the locked Oct 14 screening and the feasible Oct 15 screening
      expect(result.length).toBe(2)
    })
  })
  
  describe('hasCompatibleScreeningPair', () => {
    it('should return false when all screenings conflict', () => {
      // Film A at 10:00 (120 min) and Film C at 10:00 (100 min) conflict
      // But Film A also has 19:00 screening which doesn't conflict
      // So we need to test with only conflicting screenings
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': true,
          '2026-10-15': false // Exclude Film B's alternate day
        },
        availabilityByDate: {
          '2026-10-14': {
            from: '09:00',
            until: '13:00' // This excludes Film A's 19:00 screening
          }
        }
      }
      
      const result = hasCompatibleScreeningPair(
        mockFilms[0], // Film A (only 10:00 is feasible)
        mockFilms[2], // Film C (only 10:00)
        mockScreenings,
        attendanceConstraints,
        []
      )
      
      // With availability constraint, both films only have feasible screening at 10:00
      expect(result).toBe(false)
    })
    
    it('should return true when compatible screenings exist', () => {
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': true
        },
        availabilityByDate: {}
      }
      
      const result = hasCompatibleScreeningPair(
        mockFilms[0], // Film A - 10:00 and 19:00
        mockFilms[1], // Film B - 10:30
        mockScreenings,
        attendanceConstraints,
        []
      )
      
      // Film A at 19:00 and Film B at 10:30 don't conflict
      expect(result).toBe(true)
    })
    
    it('should return false when one film has no feasible screenings', () => {
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': false,
          '2026-10-15': true
        },
        availabilityByDate: {}
      }
      
      const result = hasCompatibleScreeningPair(
        mockFilms[0], // Film A - only on Oct 14
        mockFilms[1], // Film B - Oct 14 and Oct 15
        mockScreenings,
        attendanceConstraints,
        []
      )
      
      // Film A has no feasible screenings since Oct 14 is not selected
      expect(result).toBe(false)
    })
  })
  
  describe('detectUnavoidableConflicts', () => {
    it('should detect conflict when films have no compatible screenings', () => {
      const interests = {
        'film-1': 'must-see',
        'film-3': 'want-to-see'
      }
      
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': true
        },
        availabilityByDate: {
          '2026-10-14': {
            from: '09:00',
            until: '13:00' // Excludes Film A's 19:00 screening
          }
        }
      }
      
      // First verify that the films have no compatible pair
      const hasCompatible = hasCompatibleScreeningPair(
        mockFilms[0],
        mockFilms[2],
        mockScreenings,
        attendanceConstraints,
        []
      )
      expect(hasCompatible).toBe(false)
      
      const conflicts = detectUnavoidableConflicts(
        mockFilms,
        mockScreenings,
        interests,
        attendanceConstraints,
        [],
        {}
      )
      
      // Film A and Film C both have only 10:00 feasible, creating unavoidable conflict
      expect(conflicts.length).toBeGreaterThan(0)
      const conflict = conflicts.find(c => 
        c.films.some(f => f.id === 'film-1') &&
        c.films.some(f => f.id === 'film-3')
      )
      expect(conflict).toBeDefined()
    })
    
    it('should not detect conflict when films have compatible screenings', () => {
      const interests = {
        'film-1': 'must-see',
        'film-2': 'want-to-see'
      }
      
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': true
        },
        availabilityByDate: {}
      }
      
      const conflicts = detectUnavoidableConflicts(
        mockFilms,
        mockScreenings,
        interests,
        attendanceConstraints,
        [],
        {}
      )
      
      // Film A (10:00, 19:00) and Film B (10:30) have compatible option (19:00 and 10:30)
      const conflict = conflicts.find(c => 
        c.films.some(f => f.id === 'film-1') &&
        c.films.some(f => f.id === 'film-2')
      )
      expect(conflict).toBeUndefined()
    })
    
    it('should only consider interested films', () => {
      const interests = {
        'film-1': 'must-see'
        // Film 2 and 3 not rated
      }
      
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': true
        },
        availabilityByDate: {}
      }
      
      const conflicts = detectUnavoidableConflicts(
        mockFilms,
        mockScreenings,
        interests,
        attendanceConstraints,
        [],
        {}
      )
      
      // No conflicts because only one film is rated
      expect(conflicts.length).toBe(0)
    })
    
    it('should skip conflicts that are already decided', () => {
      const interests = {
        'film-1': 'must-see',
        'film-3': 'want-to-see'
      }
      
      const attendanceConstraints = {
        attendanceDays: {
          '2026-10-14': true
        },
        availabilityByDate: {}
      }
      
      const existingDecisions = {
        'film-1_vs_film-3': {
          chosen: 'film-1',
          excluded: ['film-3']
        }
      }
      
      const conflicts = detectUnavoidableConflicts(
        mockFilms,
        mockScreenings,
        interests,
        attendanceConstraints,
        [],
        existingDecisions
      )
      
      // Should not include the already-decided conflict
      const conflict = conflicts.find(c => 
        c.films.some(f => f.id === 'film-1') &&
        c.films.some(f => f.id === 'film-3')
      )
      expect(conflict).toBeUndefined()
    })
  })
  
  describe('getDecisionKey', () => {
    it('should create stable key regardless of order', () => {
      const key1 = getDecisionKey('film-1', 'film-2')
      const key2 = getDecisionKey('film-2', 'film-1')
      
      expect(key1).toBe(key2)
    })
    
    it('should create unique keys for different pairs', () => {
      const key1 = getDecisionKey('film-1', 'film-2')
      const key2 = getDecisionKey('film-1', 'film-3')
      
      expect(key1).not.toBe(key2)
    })
  })
  
  describe('getAutoResolution', () => {
    it('should auto-resolve when one film is must-see and other is maybe', () => {
      const conflict = {
        films: [
          { id: 'film-1', title: 'Film A' },
          { id: 'film-2', title: 'Film B' }
        ],
        interests: ['must-see', 'maybe']
      }
      
      const resolution = getAutoResolution(conflict)
      
      expect(resolution).toBeDefined()
      expect(resolution.chosen).toBe('film-1')
      expect(resolution.reason).toContain('Must See')
    })
    
    it('should not auto-resolve when both are must-see', () => {
      const conflict = {
        films: [
          { id: 'film-1', title: 'Film A' },
          { id: 'film-2', title: 'Film B' }
        ],
        interests: ['must-see', 'must-see']
      }
      
      const resolution = getAutoResolution(conflict)
      
      expect(resolution).toBeNull()
    })
    
    it('should not auto-resolve when priority difference is small', () => {
      const conflict = {
        films: [
          { id: 'film-1', title: 'Film A' },
          { id: 'film-2', title: 'Film B' }
        ],
        interests: ['want-to-see', 'maybe']
      }
      
      const resolution = getAutoResolution(conflict)
      
      // Small priority difference should not auto-resolve
      expect(resolution).toBeNull()
    })
  })
})
