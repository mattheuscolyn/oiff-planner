import { usePlanner } from '../contexts/PlannerContext'
import { 
  getFestivalDates, 
  getSailingsForDate, 
  formatTimeDisplay,
  calculateArrivalAvailability,
  calculateDepartureAvailability,
  formatAvailabilitySummary,
  VEHICLE_TERMINAL_BUFFER,
  ISLAND_TRANSFER_BUFFER
} from '../utils/ferryData'
import './AttendanceStep.css'

function AttendanceStep({ onContinue }) {
  const { attendance, updateAttendance } = usePlanner()
  const { attendanceDays, availabilityByDate, arrivalTravel, departureTravel } = attendance
  
  const festivalDates = getFestivalDates()
  const selectedDates = festivalDates.filter(d => attendanceDays[d.date])
  const firstSelectedDate = selectedDates[0]
  const lastSelectedDate = selectedDates[selectedDates.length - 1]
  
  const handleDayToggle = (date) => {
    updateAttendance({
      attendanceDays: {
        ...attendanceDays,
        [date]: !attendanceDays[date]
      }
    })
  }
  
  const handleArrivalTypeChange = (type) => {
    updateAttendance({
      arrivalTravel: {
        ...arrivalTravel,
        type,
        ferryId: null,
        customTime: null
      }
    })
  }
  
  const handleDepartureTypeChange = (type) => {
    updateAttendance({
      departureTravel: {
        ...departureTravel,
        type,
        ferryId: null,
        customTime: null
      }
    })
  }
  
  const handleArrivalFerrySelect = (ferryId, sailing) => {
    const availableFrom = calculateArrivalAvailability(sailing, arrivalTravel.isVehicle)
    
    updateAttendance({
      arrivalTravel: {
        ...arrivalTravel,
        ferryId
      },
      availabilityByDate: {
        ...availabilityByDate,
        [firstSelectedDate.date]: {
          ...availabilityByDate[firstSelectedDate.date],
          from: availableFrom
        }
      }
    })
  }
  
  const handleDepartureFerrySelect = (ferryId, sailing) => {
    const availableUntil = calculateDepartureAvailability(sailing, departureTravel.isVehicle)
    
    updateAttendance({
      departureTravel: {
        ...departureTravel,
        ferryId
      },
      availabilityByDate: {
        ...availabilityByDate,
        [lastSelectedDate.date]: {
          ...availabilityByDate[lastSelectedDate.date],
          until: availableUntil
        }
      }
    })
  }
  
  const handleVehicleToggle = (isArrival) => {
    if (isArrival) {
      const newIsVehicle = !arrivalTravel.isVehicle
      updateAttendance({
        arrivalTravel: { ...arrivalTravel, isVehicle: newIsVehicle }
      })
      
      // Recalculate if ferry is selected
      if (arrivalTravel.ferryId && firstSelectedDate) {
        const sailings = getSailingsForDate(firstSelectedDate.date, 'to-orcas')
        const sailing = sailings.find(s => s.id === arrivalTravel.ferryId)
        if (sailing) {
          const availableFrom = calculateArrivalAvailability(sailing, newIsVehicle)
          updateAttendance({
            availabilityByDate: {
              ...availabilityByDate,
              [firstSelectedDate.date]: {
                ...availabilityByDate[firstSelectedDate.date],
                from: availableFrom
              }
            }
          })
        }
      }
    } else {
      const newIsVehicle = !departureTravel.isVehicle
      updateAttendance({
        departureTravel: { ...departureTravel, isVehicle: newIsVehicle }
      })
      
      // Recalculate if ferry is selected
      if (departureTravel.ferryId && lastSelectedDate) {
        const sailings = getSailingsForDate(lastSelectedDate.date, 'from-orcas')
        const sailing = sailings.find(s => s.id === departureTravel.ferryId)
        if (sailing) {
          const availableUntil = calculateDepartureAvailability(sailing, newIsVehicle)
          updateAttendance({
            availabilityByDate: {
              ...availabilityByDate,
              [lastSelectedDate.date]: {
                ...availabilityByDate[lastSelectedDate.date],
                until: availableUntil
              }
            }
          })
        }
      }
    }
  }
  
  const handleCustomTimeChange = (date, field, value) => {
    updateAttendance({
      availabilityByDate: {
        ...availabilityByDate,
        [date]: {
          ...availabilityByDate[date],
          [field]: value
        }
      }
    })
  }
  
  const arrivalSailings = firstSelectedDate 
    ? getSailingsForDate(firstSelectedDate.date, 'to-orcas')
    : []
  
  const departureSailings = lastSelectedDate
    ? getSailingsForDate(lastSelectedDate.date, 'from-orcas')
    : []
  
  const canContinue = selectedDates.length > 0
  
  return (
    <div className="attendance-step">
      <h2>When will you be there?</h2>
      
      <section className="festival-days">
        <h3>Festival Days</h3>
        <div className="day-toggles">
          {festivalDates.map(({ date, label }) => (
            <button
              key={date}
              className={`day-toggle ${attendanceDays[date] ? 'selected' : ''}`}
              onClick={() => handleDayToggle(date)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      
      {selectedDates.length > 0 && (
        <>
          {/* Arrival */}
          {firstSelectedDate && (
            <section className="travel-section">
              <h3>Arriving {firstSelectedDate.label}</h3>
              
              <div className="travel-options">
                <button
                  className={`travel-option ${arrivalTravel.type === 'already-on-island' ? 'selected' : ''}`}
                  onClick={() => handleArrivalTypeChange('already-on-island')}
                >
                  Already on Orcas
                </button>
                <button
                  className={`travel-option ${arrivalTravel.type === 'ferry' ? 'selected' : ''}`}
                  onClick={() => handleArrivalTypeChange('ferry')}
                >
                  Ferry from Anacortes
                </button>
                <button
                  className={`travel-option ${arrivalTravel.type === 'custom' ? 'selected' : ''}`}
                  onClick={() => handleArrivalTypeChange('custom')}
                >
                  Set custom time
                </button>
              </div>
              
              {arrivalTravel.type === 'ferry' && (
                <>
                  <div className="vehicle-toggle">
                    <label>
                      <input
                        type="checkbox"
                        checked={arrivalTravel.isVehicle}
                        onChange={() => handleVehicleToggle(true)}
                      />
                      Traveling with vehicle
                    </label>
                  </div>
                  
                  <div className="ferry-sailings">
                    <p className="ferry-note">
                      {arrivalTravel.isVehicle && (
                        <>Vehicle travelers: plan to arrive {VEHICLE_TERMINAL_BUFFER} min before departure. </>
                      )}
                      <a 
                        href="https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/mobile/Default.aspx" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="reserve-link"
                      >
                        Reserve with WSF →
                      </a>
                    </p>
                    
                    {arrivalSailings.map(sailing => {
                      const isSelected = arrivalTravel.ferryId === sailing.id
                      const availability = availabilityByDate[firstSelectedDate.date]
                      
                      return (
                        <button
                          key={sailing.id}
                          className={`ferry-option ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleArrivalFerrySelect(sailing.id, sailing)}
                        >
                          <div className="ferry-time">
                            <strong>{formatTimeDisplay(sailing.departureTime)}</strong> Anacortes
                            {' → '}
                            <strong>{formatTimeDisplay(sailing.arrivalTime)}</strong> Orcas
                          </div>
                          {isSelected && availability && (
                            <div className="derived-availability">
                              Available for films: {formatAvailabilitySummary(availability.from, availability.until)}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
              
              {arrivalTravel.type === 'custom' && (
                <div className="custom-time">
                  <label>
                    Available from:
                    <input
                      type="time"
                      value={availabilityByDate[firstSelectedDate.date]?.from || '09:00'}
                      onChange={(e) => handleCustomTimeChange(firstSelectedDate.date, 'from', e.target.value)}
                    />
                  </label>
                </div>
              )}
            </section>
          )}
          
          {/* Departure */}
          {lastSelectedDate && selectedDates.length > 0 && (
            <section className="travel-section">
              <h3>Leaving {lastSelectedDate.label}</h3>
              
              <div className="travel-options">
                <button
                  className={`travel-option ${departureTravel.type === 'staying-on-island' ? 'selected' : ''}`}
                  onClick={() => handleDepartureTypeChange('staying-on-island')}
                >
                  Staying on Orcas
                </button>
                <button
                  className={`travel-option ${departureTravel.type === 'ferry' ? 'selected' : ''}`}
                  onClick={() => handleDepartureTypeChange('ferry')}
                >
                  Ferry to Anacortes
                </button>
                <button
                  className={`travel-option ${departureTravel.type === 'custom' ? 'selected' : ''}`}
                  onClick={() => handleDepartureTypeChange('custom')}
                >
                  Set custom time
                </button>
              </div>
              
              {departureTravel.type === 'ferry' && (
                <>
                  <div className="vehicle-toggle">
                    <label>
                      <input
                        type="checkbox"
                        checked={departureTravel.isVehicle}
                        onChange={() => handleVehicleToggle(false)}
                      />
                      Traveling with vehicle
                    </label>
                  </div>
                  
                  <div className="ferry-sailings">
                    <p className="ferry-note">
                      {departureTravel.isVehicle && (
                        <>Vehicle travelers: plan to arrive {VEHICLE_TERMINAL_BUFFER} min before departure. </>
                      )}
                      Account for {ISLAND_TRANSFER_BUFFER} min travel to ferry terminal.
                    </p>
                    
                    {departureSailings.map(sailing => {
                      const isSelected = departureTravel.ferryId === sailing.id
                      const availability = availabilityByDate[lastSelectedDate.date]
                      
                      return (
                        <button
                          key={sailing.id}
                          className={`ferry-option ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleDepartureFerrySelect(sailing.id, sailing)}
                        >
                          <div className="ferry-time">
                            <strong>{formatTimeDisplay(sailing.departureTime)}</strong> Orcas
                            {' → '}
                            <strong>{formatTimeDisplay(sailing.arrivalTime)}</strong> Anacortes
                          </div>
                          {isSelected && availability && (
                            <div className="derived-availability">
                              Available for films: {formatAvailabilitySummary(availability.from, availability.until)}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
              
              {departureTravel.type === 'custom' && (
                <div className="custom-time">
                  <label>
                    Available until:
                    <input
                      type="time"
                      value={availabilityByDate[lastSelectedDate.date]?.until || '23:00'}
                      onChange={(e) => handleCustomTimeChange(lastSelectedDate.date, 'until', e.target.value)}
                    />
                  </label>
                </div>
              )}
            </section>
          )}
          
          <button 
            className="continue-button" 
            onClick={onContinue}
            disabled={!canContinue}
          >
            Build My Festival Plan
          </button>
        </>
      )}
    </div>
  )
}

export default AttendanceStep
