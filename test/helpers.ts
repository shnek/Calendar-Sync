import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeConfig } from '../src/core/config'
import type { AppConfig, NormalizedEvent, SourceConfig } from '../src/core/types'

export const NOW = new Date('2026-10-12T16:00:00Z')

export function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8')
}

export const GOOGLE_SOURCE: SourceConfig = {
  id: 'src-google',
  name: 'Acme Google',
  url: 'https://calendar.google.com/calendar/ical/me%40acme.com/private-abc/basic.ics',
  project: 'Acme',
  enabled: true,
}

export const OUTLOOK_SOURCE: SourceConfig = {
  id: 'src-outlook',
  name: 'Globex Outlook',
  url: 'webcal://outlook.office365.com/owa/calendar/xyz/reachcalendar.ics',
  project: 'Globex',
  enabled: true,
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return normalizeConfig({
    sources: [GOOGLE_SOURCE, OUTLOOK_SOURCE],
    sync: { autoSync: true, intervalMinutes: 15, pastDays: 7, futureDays: 60, timeZone: 'America/New_York' },
    ...overrides,
  })
}

/** A fetch stub serving fixtures by URL substring; responses can be swapped per test. */
export function fakeFetch(routes: Record<string, string | number>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    for (const [needle, body] of Object.entries(routes)) {
      if (!url.includes(needle)) continue
      if (typeof body === 'number') return new Response('nope', { status: body, statusText: 'Error' })
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/calendar' } })
    }
    throw new TypeError('fetch failed')
  }) as typeof fetch
}

export function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    sourceId: 'src-google',
    key: 'uid-1',
    uid: 'uid-1',
    title: 'Planning',
    allDay: false,
    start: '2026-10-14T14:00:00.000Z',
    end: '2026-10-14T15:00:00.000Z',
    showAs: 'busy',
    status: 'confirmed',
    response: 'accepted',
    description: '',
    location: '',
    categories: [],
    recurring: false,
    ...overrides,
  }
}
