#!/usr/bin/env node

import filmsData from './src/data/films.json' assert { type: 'json' }
import { detectUnavoidableConflicts } from './src/planner/decisions.js'

const { films, screenings } = filmsData

// Find the specific films
const mouse = films.find(f => f.title === 'Mouse')
const humboldtUSA = films.find(f => f.title === 'Humboldt USA')
const nuisanceBear = films.find(f => f.title === 'Nuisance Bear')
const youFoundMe = films.find(f => f.title === 'You Found Me')

console.log('Found films:')
console.log('  Mouse:', mouse ? mouse.id : 'NOT FOUND')
console.log('  Humboldt USA:', humboldtUSA ? humboldtUSA.id : 'NOT FOUND')
console.log('  Nuisance Bear:', nuisanceBear ? nuisanceBear.id : 'NOT FOUND')
console.log('  You Found Me:', youFoundMe ? youFoundMe.id : 'NOT FOUND')
console.log()

// Unrestricted Oct 14-18 attendance
const attendanceConstraints = {
  attendanceDays: {
    '2026-10-14': true,
    '2026-10-15': true,
    '2026-10-16': true,
    '2026-10-17': true,
    '2026-10-18': true
  },
  availabilityByDate: {}
}

// Test with no ratings (should still detect schedule conflicts)
const noRatings = {}

// Test with ratings
const withRatings = {}
if (mouse) withRatings[mouse.id] = 'must-see'
if (humboldtUSA) withRatings[humboldtUSA.id] = 'must-see'
if (nuisanceBear) withRatings[nuisanceBear.id] = 'must-see'
if (youFoundMe) withRatings[youFoundMe.id] = 'must-see'

console.log('Testing with NO ratings (current implementation):')
const conflicts1 = detectUnavoidableConflicts(
  films,
  screenings,
  noRatings,
  attendanceConstraints,
  [],
  {}
)
console.log(`Found ${conflicts1.length} conflicts`)
console.log()

console.log('Testing WITH ratings:')
const conflicts2 = detectUnavoidableConflicts(
  films,
  screenings,
  withRatings,
  attendanceConstraints,
  [],
  {}
)
console.log(`Found ${conflicts2.length} conflicts`)
conflicts2.forEach(c => {
  console.log(`  - ${c.films[0].title} vs ${c.films[1].title}`)
})
