import { useState } from 'react'
import { formatDate, formatTime, getFilmById } from '../utils/festivalData'
import {
  formatPairCheckCountCopy,
  formatPairCheckProofLines
} from '../planner/pairCheck'
import FilmPoster from './FilmPoster'
import './SlotOptions.css'

function formatInterest(interest) {
  const labels = {
    'must-see': 'Must',
    'want-to-see': 'Want',
    maybe: 'Maybe'
  }
  return labels[interest] || 'Unrated'
}

function formatAlsoScreenings(otherAttendanceScreenings, primaryDate) {
  if (!otherAttendanceScreenings?.length) return null
  return otherAttendanceScreenings
    .slice(0, 3)
    .map(s => {
      const sameDay = s.date === primaryDate
      const day = sameDay
        ? ''
        : new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', {
            weekday: 'short'
          }) + ' '
      return `${day}${formatTime(s.startTime)}`
    })
    .join(' · ')
}

/**
 * Compact expandable list of local slot alternatives under a planned row.
 */
function SlotOptionsPanel({
  plannedScreening,
  options = [],
  onRequireFilm,
  onCanSeeBoth,
  pairCheck,
  pairCheckLoading,
  pairCheckTargetFilmId,
  onRequireBoth,
  onDismissPairCheck
}) {
  const [open, setOpen] = useState(false)
  if (!options.length) return null

  return (
    <div className="slot-options">
      <button
        type="button"
        className="slot-options-toggle"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        Other options for this slot ({options.length})
        <span className="slot-options-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="slot-options-list">
          {options.map(opt => {
            const film = getFilmById(opt.filmId)
            const end = opt.endTime
            const also = formatAlsoScreenings(
              opt.otherAttendanceScreenings,
              opt.date
            )
            const isPairTarget = pairCheckTargetFilmId === opt.filmId
            const badge = opt.availabilityBadge

            return (
              <div key={opt.filmId} className="slot-option-card">
                <div className="slot-option-main">
                  {film && (
                    <FilmPoster film={film} size="thumb" className="slot-option-poster" />
                  )}
                  <div className="slot-option-body">
                    <div className="slot-option-title-row">
                      <strong className="slot-option-title">{opt.filmTitle}</strong>
                      <span className={`interest-badge ${opt.interest || 'unrated'}`}>
                        {formatInterest(opt.interest)}
                      </span>
                    </div>
                    <div className="slot-option-when">
                      {opt.date !== plannedScreening.date && (
                        <span>{formatDate(opt.date)} · </span>
                      )}
                      {formatTime(opt.startTime)}
                      {end ? `–${formatTime(end)}` : ''}
                      {' · '}
                      {opt.venue}
                    </div>
                    {badge?.label && badge.code !== 'has-others' && (
                      <div className={`slot-option-badge badge-${badge.code}`}>
                        {badge.label}
                      </div>
                    )}
                    {also && (
                      <div className="slot-option-also">Also: {also}</div>
                    )}
                  </div>
                </div>

                <div className="slot-option-actions">
                  <button
                    type="button"
                    className="action-btn require"
                    onClick={() => onRequireFilm(opt.filmId)}
                  >
                    Require Film
                  </button>
                  <button
                    type="button"
                    className="action-btn pair-check"
                    onClick={() => onCanSeeBoth(plannedScreening.filmId, opt.filmId)}
                    disabled={pairCheckLoading && isPairTarget}
                  >
                    {pairCheckLoading && isPairTarget
                      ? 'Checking…'
                      : 'Can I See Both?'}
                  </button>
                </div>

                {isPairTarget && pairCheck && (
                  <PairCheckResult
                    pairCheck={pairCheck}
                    filmAId={plannedScreening.filmId}
                    filmBId={opt.filmId}
                    onRequireBoth={onRequireBoth}
                    onDismiss={onDismissPairCheck}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function PairCheckResult({ pairCheck, filmAId, filmBId, onRequireBoth, onDismiss }) {
  const filmA = getFilmById(filmAId)
  const filmB = getFilmById(filmBId)

  if (pairCheck.status === 'error' || pairCheck.reasonCode === 'pair-check-error') {
    return (
      <div className="pair-check-result error">
        <strong>Couldn&apos;t check these films</strong>
        <p>Try again.</p>
        <button type="button" className="linkish" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    )
  }

  if (!pairCheck.feasible) {
    return (
      <div className="pair-check-result infeasible">
        <strong>No feasible schedule contains both.</strong>
        <p>{pairCheck.reason}</p>
        {pairCheck.conflict?.filmIds?.length > 0 && (
          <p className="pair-check-meta">
            Conflict set:{' '}
            {pairCheck.conflict.filmIds
              .map(id => getFilmById(id)?.title || id)
              .join(', ')}
          </p>
        )}
        <button type="button" className="linkish" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    )
  }

  const countLine = formatPairCheckCountCopy(pairCheck)
  const proofLines = formatPairCheckProofLines(pairCheck)

  const fmtScreening = s => {
    if (!s) return '—'
    return `${formatDate(s.date)} · ${formatTime(s.startTime)} · ${s.venue}`
  }

  return (
    <div className="pair-check-result feasible">
      <strong>Both can fit</strong>
      <p className="pair-check-count">{countLine}</p>
      {proofLines.length > 0 && (
        <p className="pair-check-proof">
          {proofLines.join(' · ')}
        </p>
      )}
      <ul className="pair-check-screenings">
        <li>
          <em>{filmA?.title}</em>: {fmtScreening(pairCheck.screeningA)}
        </li>
        <li>
          <em>{filmB?.title}</em>: {fmtScreening(pairCheck.screeningB)}
        </li>
      </ul>
      {pairCheck.adds?.length > 0 && (
        <p className="pair-check-diff">
          Adds: {pairCheck.adds.map(f => f.title).join(', ')}
        </p>
      )}
      {pairCheck.drops?.length > 0 && (
        <p className="pair-check-diff">
          Drops: {pairCheck.drops.map(f => f.title).join(', ')}
        </p>
      )}
      <div className="pair-check-actions">
        <button
          type="button"
          className="action-btn require"
          onClick={() => onRequireBoth(filmAId, filmBId)}
        >
          Require Both
        </button>
        <button type="button" className="linkish" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  )
}

export default SlotOptionsPanel
