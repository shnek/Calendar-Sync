import { describe, expect, it } from 'vitest'
import { syncWindow } from '../src/core/config'
import { fetchIcs, parseIcs } from '../src/core/sources/ics'
import { NOW, fakeFetch, fixture, testConfig } from './helpers'

const window = syncWindow(testConfig(), NOW)
const opts = { window, timeZone: 'America/New_York' }

describe('parseIcs - Google feed', () => {
  const feed = parseIcs(fixture('google.ics'), { ...opts, sourceId: 'g' })
  const byTitle = (t: string) => feed.events.filter((e) => e.title === t)

  it('detects calendar name and owner email from X-WR-CALNAME', () => {
    expect(feed.calendarName).toBe('me@acme.com')
    expect(feed.ownerEmail).toBe('me@acme.com')
  })

  it('expands weekly recurrence within the window, honoring EXDATE', () => {
    const standups = byTitle('Weekly standup')
    // Mondays Oct 5 .. Dec 7 = 10, minus EXDATE Oct 19, minus Oct 26 (moved).
    expect(standups).toHaveLength(8)
    expect(standups.some((e) => e.start.startsWith('2026-10-19'))).toBe(false)
    expect(standups.every((e) => e.recurring)).toBe(true)
  })

  it('applies RECURRENCE-ID overrides', () => {
    const [moved] = byTitle('Weekly standup (moved)')
    expect(moved.start).toBe('2026-10-27T15:00:00.000Z')
    expect(moved.end).toBe('2026-10-27T15:30:00.000Z')
    expect(moved.uid).toBe('standup-1@google.com')
  })

  it('keeps wall-clock time across the DST change', () => {
    const standups = byTitle('Weekly standup')
    expect(standups.find((e) => e.start.startsWith('2026-10-12'))?.start).toBe('2026-10-12T13:30:00.000Z')
    expect(standups.find((e) => e.start.startsWith('2026-11-09'))?.start).toBe('2026-11-09T14:30:00.000Z')
  })

  it('produces unique, stable keys per occurrence', () => {
    const keys = feed.events.map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
    const again = parseIcs(fixture('google.ics'), { ...opts, sourceId: 'g' })
    expect(again.events.map((e) => e.key)).toEqual(keys)
  })

  it('handles all-day events, including a missing DTEND', () => {
    const [offsite] = byTitle('Team offsite')
    expect(offsite).toMatchObject({ allDay: true, start: '2026-10-20', end: '2026-10-22' })
    const [holiday] = byTitle('Holiday')
    expect(holiday).toMatchObject({ allDay: true, start: '2026-11-11', end: '2026-11-12' })
  })

  it('maps transparency, attendance and keeps details for matching only', () => {
    expect(byTitle('Lunch')[0].showAs).toBe('free')
    expect(byTitle('Optional sync')[0].response).toBe('declined')
    expect(byTitle('Weekly standup')[0].response).toBe('accepted')
    expect(byTitle('Weekly standup')[0].description).toContain('meet.example.com')
    expect(byTitle('Client call - roadmap')[0].location).toBe('Zoom')
  })

  it('drops events outside the window', () => {
    expect(byTitle('Old meeting')).toHaveLength(0)
  })
})

describe('parseIcs - Outlook feed', () => {
  const feed = parseIcs(fixture('outlook.ics'), { ...opts, sourceId: 'o' })
  const byTitle = (t: string) => feed.events.filter((e) => e.title === t)

  it('does not treat a non-email calendar name as owner', () => {
    expect(feed.calendarName).toBe('Calendar')
    expect(feed.ownerEmail).toBeUndefined()
  })

  it('resolves Windows time zone names via the embedded VTIMEZONE across DST', () => {
    const daily = byTitle('Morning sync')
    expect(daily).toHaveLength(20)
    expect(daily.find((e) => e.start.startsWith('2026-10-24'))?.start).toBe('2026-10-24T07:00:00.000Z')
    expect(daily.find((e) => e.start.startsWith('2026-10-26'))?.start).toBe('2026-10-26T08:00:00.000Z')
  })

  it('falls back to a known zone when the TZID has no VTIMEZONE', () => {
    expect(byTitle('US partner call')[0].start).toBe('2026-10-21T17:00:00.000Z')
  })

  it('maps Outlook busy status and cancellation', () => {
    expect(byTitle('Maybe review')[0].showAs).toBe('tentative')
    expect(byTitle('Lunch break')[0].showAs).toBe('free')
    expect(byTitle('Vacation')[0]).toMatchObject({ showAs: 'oof', allDay: true })
    expect(byTitle('Canceled: Architecture review')[0].status).toBe('cancelled')
  })
})

describe('fetchIcs', () => {
  it('rewrites webcal:// to https://', async () => {
    let requested = ''
    const f = (async (url: string) => {
      requested = url
      return new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')
    }) as unknown as typeof fetch
    await fetchIcs('webcal://example.com/cal.ics', { fetchImpl: f })
    expect(requested).toBe('https://example.com/cal.ics')
  })

  it('reports HTTP errors without leaking the secret URL', async () => {
    const err = await fetchIcs('https://example.com/secret-token/basic.ics', {
      fetchImpl: fakeFetch({ 'secret-token': 404 }),
    }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('404')
    expect((err as Error).message).not.toContain('secret-token')
  })

  it('rejects non-iCalendar responses', async () => {
    await expect(fetchIcs('https://example.com/page', { fetchImpl: fakeFetch({ page: '<html>login</html>' }) })).rejects.toThrow(
      /not an iCalendar feed/,
    )
  })
})
