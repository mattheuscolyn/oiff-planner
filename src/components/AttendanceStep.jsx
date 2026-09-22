/**
 * AttendanceStep - PR #10: Arrival/Departure UI
 * 
 * Replaces the festival-day grid with simple arrival/departure selection.
 * Automatically derives festival availability.
 */

import { usePlanner } from '../contexts/PlannerContext'
import { getFerries } from '../utils/ferryData'
import { formatAvailabilitySummary } from '../utils/festivalAvailability'
import './AttendanceStep.css'

// Available arrival dates (includes Tuesday before festival)
const ARRIVAL_DATES = [
  { value: '2026-10-13', label: 'Tuesday Oct 13' },
  { value: '2026-10-14', label: 'Wednesday Oct 14' },
  { value: '2026-10-15', label: 'Thursday Oct 15' },
  { value: '2026-10-16', label: 'Friday Oct 16' },
  { value: '2026-10-17', label: 'Saturday Oct 17' },
  { value: '2026-10-18', label: 'Sunday Oct 18' }
]

// Available departure dates (includes Monday after festival)
const DEPARTURE_DATES = [
  { value: '2026-10-14', label: 'Wednesday Oct 14' },
  { value: '2026-10-15', label: 'Thursday Oct 15' },
  { value: '2026-10-16', label: 'Friday Oct 16' },
  { value: '2026-10-17', label: 'Saturday Oct 17' },
  { value: '2026-10-18', label: 'Sunday Oct 18' },
  { value: '2026-10-19', label: 'Monday Oct 19' }
]

export default function AttendanceStep({ onContinue }) {
  const { arrival, departure, updateArrival, updateDeparture } = usePlanner()
  
  const ferries = getFerries()
  
  // Get applicable ferries for selected dates
  const arrivalFerries = ferries.filter(f => 
    f.date === arrival.date && f.route === 'anacortes-orcas'
  )
  
  const departureFerries = ferries.filter(f => 
    f.date === departure.date && f.route === 'orcas-anacortes'
  )
  
  // Validation
  const canContinue = arrival.date <= departure.date
  const availabilitySummary = canContinue ? formatAvailabilitySummary(arrival, departure, ferries) : null
  
  return (
    <div className="attendance-step">
      <h2>When will you be there?</h2>
      
      {/* Arrival Section */}
      <section className="travel-section">
        <h3>Arrival</h3>
        
        <label>
          Arriving
          <select 
            value={arrival.date}
            onChange={(e) => {
              const newDate = e.target.value
              // Clear ferry if date changes
              const updates = { date: newDate }
              if (arrival.ferryId && !arrivalFerries.some(f => f.id === arrival.ferryId)) {
                updates.ferryId = null
              }
              updateArrival(updates)
            }}
          >
            {ARRIVAL_DATES.map(d => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>
        
        <div className="travel-type">
          <button
            className={`type-button ${arrival.type === 'already-on-island' ? 'selected' : ''}`}
            onClick={() => updateArrival({ type: 'already-on-island', ferryId: null })}
          >
            Already on Orcas / arriving another way
          </button>
          
          <button
            className={`type-button ${arrival.type === 'ferry' ? 'selected' : ''}`}
            onClick={() => updateArrival({ type: 'ferry' })}
          >
            Ferry from Anacortes
          </button>
          
          <button
            className={`type-button ${arrival.type === 'custom' ? 'selected' : ''}`}
            onClick={() => updateArrival({ type: 'custom' })}
          >
            Custom available time
          </button>
        </div>
        
        {/* Ferry Selection */}
        {arrival.type === 'ferry' && (
          <div className="ferry-selection">
            {arrivalFerries.length > 0 ? (
              <>
                <div className="vehicle-toggle">
                  <label>
                    <input
                      type="checkbox"
                      checked={arrival.isVehicle}
                      onChange={(e) => updateArrival({ isVehicle: e.target.checked })}
                    />
                    Vehicle (requires reservation)
                  </label>
                </div>
                
                <div className="ferry-list">
                  {arrivalFerries.map(ferry => (
                    <button
                      key={ferry.id}
                      className={`ferry-option ${arrival.ferryId === ferry.id ? 'selected' : ''}`}
                      onClick={() => updateArrival({ ferryId: ferry.id })}
                    >
                      <div className="ferry-times">
                        <strong>{ferry.departureTime}</strong> Anacortes → <strong>{ferry.arrivalTime}</strong> Orcas
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="no-ferries">No ferry data available for this date.</p>
            )}
          </div>
        )}
        
        {/* Custom Time */}
        {arrival.type === 'custom' && (
          <div className="custom-time">
            <label>
              Available from
              <input
                type="time"
                value={arrival.customTime || ''}
                onChange={(e) => updateArrival({ customTime: e.target.value })}
              />
            </label>
          </div>
        )}
      </section>
      
      {/* Departure Section */}
      <section className="travel-section">
        <h3>Departure</h3>
        
        <label>
          Leaving
          <select 
            value={departure.date}
            onChange={(e) => {
              const newDate = e.target.value
              // Clear ferry if date changes
              const updates = { date: newDate }
              if (departure.ferryId && !departureFerries.some(f => f.id === departure.ferryId)) {
                updates.ferryId = null
              }
              updateDeparture(updates)
            }}
          >
            {DEPARTURE_DATES.map(d => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>
        
        <div className="travel-type">
          <button
            className={`type-button ${departure.type === 'staying-longer' ? 'selected' : ''}`}
            onClick={() => updateDeparture({ type: 'staying-longer', ferryId: null })}
          >
            Staying on Orcas / leaving another way
          </button>
          
          <button
            className={`type-button ${departure.type === 'ferry' ? 'selected' : ''}`}
            onClick={() => updateDeparture({ type: 'ferry' })}
          >
            Ferry to Anacortes
          </button>
          
          <button
            className={`type-button ${departure.type === 'custom' ? 'selected' : ''}`}
            onClick={() => updateDeparture({ type: 'custom' })}
          >
            Custom departure time
          </button>
        </div>
        
        {/* Ferry Selection */}
        {departure.type === 'ferry' && (
          <div className="ferry-selection">
            {departureFerries.length > 0 ? (
              <>
                <div className="vehicle-toggle">
                  <label>
                    <input
                      type="checkbox"
                      checked={departure.isVehicle}
                      onChange={(e) => updateDeparture({ isVehicle: e.target.checked })}
                    />
                    Vehicle (allow extra time for check-in)
                  </label>
                </div>
                
                <div className="ferry-list">
                  {departureFerries.map(ferry => (
                    <button
                      key={ferry.id}
                      className={`ferry-option ${departure.ferryId === ferry.id ? 'selected' : ''}`}
                      onClick={() => updateDeparture({ ferryId: ferry.id })}
                    >
                      <div className="ferry-times">
                        <strong>{ferry.departureTime}</strong> Orcas → <strong>{ferry.arrivalTime}</strong> Anacortes
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="no-ferries">No ferry data available for this date.</p>
            )}
          </div>
        )}
        
        {/* Custom Time */}
        {departure.type === 'custom' && (
          <div className="custom-time">
            <label>
              Leaving at
              <input
                type="time"
                value={departure.customTime || ''}
                onChange={(e) => updateDeparture({ customTime: e.target.value })}
              />
            </label>
          </div>
        )}
      </section>
      
      {/* Availability Summary */}
      {canContinue && availabilitySummary && (
        <div className="availability-summary">
          <strong>Your availability:</strong> {availabilitySummary}
        </div>
      )}
      
      {!canContinue && (
        <div className="validation-error">
          Departure date must be on or after arrival date
        </div>
      )}
      
      {/* Continue Button */}
      <button
        onClick={onContinue}
        className="continue-button"
        disabled={!canContinue}
      >
        Build My Festival Plan
      </button>
    </div>
  )
}
