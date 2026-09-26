import { describe, it, expect } from 'vitest'
import { buildDayTimelineLayout, gapMinutesBetween } from '../DayTimeline'

describe('DayTimeline layout', () => {
  const items = [
    {
      screening: {
        id: 's1',
        filmId: 'f1',
        date: '2026-10-14',
        startTime: '10:00',
        endTime: '11:30',
        venue: 'Orcas Center Main'
      },
      film: { id: 'f1', title: 'A', runtime: 90 },
      conflicts: []
    },
    {
      screening: {
        id: 's2',
        filmId: 'f2',
        date: '2026-10-14',
        startTime: '12:00',
        endTime: '13:30',
        venue: 'Sea View Theatre'
      },
      film: { id: 'f2', title: 'B', runtime: 90 },
      conflicts: []
    }
  ]

  it('gapMinutesBetween measures free time between screenings', () => {
    expect(gapMinutesBetween(items[0].screening, items[1].screening)).toBe(30)
  })

  it('scales block height by duration', () => {
    const layout = buildDayTimelineLayout(items, { pxPerMinute: 1, paddingMin: 0 })
    expect(layout.blocks).toHaveLength(2)
    expect(layout.blocks[0].height).toBe(90)
    expect(layout.blocks[1].height).toBe(90)
    expect(layout.blocks[1].top - (layout.blocks[0].top + layout.blocks[0].height)).toBe(30)
  })

  it('inserts a break band for positive gaps', () => {
    const layout = buildDayTimelineLayout(items, { pxPerMinute: 1, paddingMin: 0 })
    expect(layout.breaks).toHaveLength(1)
    expect(layout.breaks[0].minutes).toBe(30)
    expect(layout.breaks[0].height).toBe(30)
  })

  it('does not insert a break for overlapping screenings', () => {
    const overlap = [
      items[0],
      {
        screening: {
          id: 's3',
          filmId: 'f3',
          date: '2026-10-14',
          startTime: '11:00',
          endTime: '12:30',
          venue: 'BlackBox'
        },
        film: { id: 'f3', title: 'C', runtime: 90 },
        conflicts: [{}]
      }
    ]
    const layout = buildDayTimelineLayout(overlap, { pxPerMinute: 1, paddingMin: 0 })
    expect(layout.breaks).toHaveLength(0)
    expect(gapMinutesBetween(overlap[0].screening, overlap[1].screening)).toBeLessThan(0)
  })
})
