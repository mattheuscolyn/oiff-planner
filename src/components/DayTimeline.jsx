import {
  formatTime,
  getScreeningEndTime
} from '../utils/festivalData'
import { parseTimeToMinutes, minutesToTime } from '../utils/ferryData'
import './DayTimeline.css'

const PX_PER_MINUTE = 1.35
const WINDOW_PADDING_MIN = 30

/**
 * Gap in minutes from end of earlier screening to start of later.
 * Negative means overlap.
 */
export function gapMinutesBetween(earlier, later) {
  const end = getScreeningEndTime(earlier)
  if (!end || !later?.startTime) return 0
  return parseTimeToMinutes(later.startTime) - parseTimeToMinutes(end)
}

/**
 * Build day window and positioned items for a to-scale timeline.
 */
export function buildDayTimelineLayout(items, {
  pxPerMinute = PX_PER_MINUTE,
  paddingMin = WINDOW_PADDING_MIN
} = {}) {
  if (!items?.length) {
    return { dayStartMin: 0, dayEndMin: 0, height: 0, hourTicks: [], blocks: [], breaks: [] }
  }

  const sorted = [...items].sort((a, b) =>
    a.screening.startTime.localeCompare(b.screening.startTime)
  )

  let minStart = Infinity
  let maxEnd = -Infinity
  for (const item of sorted) {
    const start = parseTimeToMinutes(item.screening.startTime)
    const endStr = getScreeningEndTime(item.screening)
    const end = endStr ? parseTimeToMinutes(endStr) : start + (item.film?.runtime || 90)
    minStart = Math.min(minStart, start)
    maxEnd = Math.max(maxEnd, end)
  }

  const dayStartMin = Math.max(0, Math.floor((minStart - paddingMin) / 60) * 60)
  const dayEndMin = Math.min(24 * 60, Math.ceil((maxEnd + paddingMin) / 60) * 60)
  const span = Math.max(dayEndMin - dayStartMin, 60)
  const height = span * pxPerMinute

  const hourTicks = []
  for (let m = dayStartMin; m <= dayEndMin; m += 60) {
    hourTicks.push({
      minutes: m,
      label: formatTime(minutesToTime(m)),
      top: (m - dayStartMin) * pxPerMinute
    })
  }

  const blocks = sorted.map(item => {
    const start = parseTimeToMinutes(item.screening.startTime)
    const endStr = getScreeningEndTime(item.screening)
    const end = endStr ? parseTimeToMinutes(endStr) : start + (item.film?.runtime || 90)
    const duration = Math.max(end - start, 15)
    return {
      ...item,
      top: (start - dayStartMin) * pxPerMinute,
      height: duration * pxPerMinute,
      startMin: start,
      endMin: end,
      endTime: endStr || minutesToTime(end)
    }
  })

  const breaks = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const earlier = sorted[i].screening
    const later = sorted[i + 1].screening
    const gap = gapMinutesBetween(earlier, later)
    if (gap <= 0) continue
    const gapStart = parseTimeToMinutes(getScreeningEndTime(earlier))
    breaks.push({
      key: `${earlier.id}-break-${later.id}`,
      minutes: gap,
      top: (gapStart - dayStartMin) * pxPerMinute,
      height: gap * pxPerMinute
    })
  }

  return { dayStartMin, dayEndMin, height, hourTicks, blocks, breaks }
}

function DayTimeline({ items, onSelectFilm }) {
  const layout = buildDayTimelineLayout(items)

  if (!items?.length) return null

  return (
    <div className="day-timeline" style={{ '--timeline-height': `${layout.height}px` }}>
      <div className="day-timeline-axis" aria-hidden="true">
        {layout.hourTicks.map(tick => (
          <div
            key={tick.minutes}
            className="day-timeline-tick"
            style={{ top: `${tick.top}px` }}
          >
            <span className="day-timeline-tick-label">{tick.label}</span>
            <span className="day-timeline-tick-line" />
          </div>
        ))}
      </div>

      <div className="day-timeline-track" style={{ height: `${layout.height}px` }}>
        {layout.hourTicks.map(tick => (
          <div
            key={`grid-${tick.minutes}`}
            className="day-timeline-grid-line"
            style={{ top: `${tick.top}px` }}
          />
        ))}

        {layout.breaks.map(br => (
          <div
            key={br.key}
            className="day-timeline-break"
            style={{ top: `${br.top}px`, height: `${Math.max(br.height, 18)}px` }}
          >
            <span className="day-timeline-break-label">
              {br.minutes} min break
            </span>
          </div>
        ))}

        {layout.blocks.map(({ screening, film, conflicts, top, height, endTime }) => (
          <button
            key={screening.id}
            type="button"
            className={`day-timeline-block${conflicts?.length ? ' has-conflict' : ''}`}
            style={{ top: `${top}px`, height: `${height}px` }}
            onClick={() => onSelectFilm?.(film)}
          >
            <div className="day-timeline-block-inner">
              <strong className="day-timeline-title">{film?.title || 'Film'}</strong>
              <div className="day-timeline-when">
                {formatTime(screening.startTime)} – {formatTime(endTime)}
              </div>
              <div className="day-timeline-meta">
                {screening.venue}
                {film?.runtime ? ` · ${film.runtime} min` : ''}
              </div>
              {conflicts?.length > 0 && (
                <div className="day-timeline-conflict">
                  Conflicts with overlapping screening
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export default DayTimeline
