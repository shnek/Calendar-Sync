import { calendar, type calendar_v3 } from '@googleapis/calendar'
import type { OAuth2Client } from 'google-auth-library'
import type { SyncWindow } from '../types'
import { APP_TAG, type CalendarTarget, type DesiredEvent, type ExistingEvent } from './target'

interface ApiError {
  status?: number
  code?: number | string
  message?: string
  response?: { status?: number; data?: { error?: string | { message?: string; errors?: { reason?: string }[] } } }
}

function statusOf(err: unknown): number | undefined {
  const e = err as ApiError
  const s = e?.response?.status ?? e?.status ?? (typeof e?.code === 'number' ? e.code : undefined)
  return typeof s === 'number' ? s : undefined
}

function reasonOf(err: unknown): string | undefined {
  const data = (err as ApiError)?.response?.data?.error
  return typeof data === 'object' ? data?.errors?.[0]?.reason : undefined
}

/** Turns Google/gaxios errors into short user-facing messages. */
export function describeGoogleError(err: unknown): string {
  const e = err as ApiError
  const data = e?.response?.data?.error
  if (data === 'invalid_grant' || /invalid_grant/.test(e?.message ?? '')) {
    return 'Google sign-in expired or was revoked - reconnect your Google account'
  }
  const status = statusOf(err)
  const message = (typeof data === 'object' && data?.message) || e?.message || String(err)
  if (status === 404) return `Google calendar not found (${message})`
  if (status === 403 && (reasonOf(err) === 'insufficientPermissions' || /insufficient authentication scopes/i.test(message))) {
    return 'Calendar Sync is missing permission to manage your calendars - disconnect your Google account, connect again, and tick every checkbox on the Google permission screen'
  }
  if (status === 403 && reasonOf(err) === 'forbidden') {
    return 'Google denied access to this calendar - with the default permission level, only calendars created by Calendar Sync can be written'
  }
  return status ? `Google API error ${status}: ${message}` : message
}

function isRetryable(err: unknown): boolean {
  const status = statusOf(err)
  if (status === 429 || (status !== undefined && status >= 500)) return true
  if (status === 403) return /rateLimitExceeded|userRateLimitExceeded/.test(reasonOf(err) ?? '')
  const code = (err as ApiError)?.code
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN'
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= attempts - 1 || !isRetryable(err)) throw err
      const delay = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}

export interface CalendarSummary {
  id: string
  summary: string
  primary: boolean
  accessRole: string
}

export class GoogleCalendarApi {
  readonly api: calendar_v3.Calendar

  constructor(auth: OAuth2Client) {
    this.api = calendar({ version: 'v3', auth })
  }

  async listCalendars(): Promise<CalendarSummary[]> {
    const out: CalendarSummary[] = []
    let pageToken: string | undefined
    do {
      const res = await withRetry(() => this.api.calendarList.list({ minAccessRole: 'reader', pageToken, maxResults: 250 }))
      for (const c of res.data.items ?? []) {
        if (!c.id) continue
        out.push({ id: c.id, summary: c.summaryOverride || c.summary || c.id, primary: Boolean(c.primary), accessRole: c.accessRole ?? '' })
      }
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
    return out
  }

  async createCalendar(summary: string, timeZone: string): Promise<CalendarSummary> {
    const res = await withRetry(() =>
      this.api.calendars.insert({
        requestBody: {
          summary,
          timeZone,
          description: 'Busy blocks mirrored from work calendars by Calendar Sync. Events here are managed automatically.',
        },
      }),
    )
    return { id: res.data.id!, summary: res.data.summary ?? summary, primary: false, accessRole: 'owner' }
  }

  async getCalendar(id: string): Promise<CalendarSummary> {
    const res = await withRetry(() => this.api.calendars.get({ calendarId: id }))
    return { id, summary: res.data.summary ?? id, primary: false, accessRole: 'owner' }
  }
}

function toBody(event: DesiredEvent): calendar_v3.Schema$Event {
  return {
    id: event.key,
    summary: event.title,
    description: '',
    location: '',
    start: event.allDay ? { date: event.start } : { dateTime: event.start },
    end: event.allDay ? { date: event.end } : { dateTime: event.end },
    status: 'confirmed',
    transparency: 'opaque',
    visibility: 'default',
    reminders: { useDefault: false, overrides: [] },
    guestsCanSeeOtherGuests: false,
    extendedProperties: {
      private: { csApp: APP_TAG, csKey: event.key, csSource: event.sourceId, csHash: event.hash },
    },
  }
}

/**
 * Google Calendar target. Event ids are derived from the stable key, so two
 * machines syncing concurrently cannot create duplicates.
 */
export class GoogleCalendarTarget implements CalendarTarget {
  private readonly api: calendar_v3.Calendar

  constructor(
    auth: OAuth2Client,
    private readonly calendarId: string,
  ) {
    this.api = calendar({ version: 'v3', auth })
  }

  async listManaged(window: SyncWindow): Promise<ExistingEvent[]> {
    try {
      return await this.listManagedRaw(window)
    } catch (err) {
      throw new Error(describeGoogleError(err), { cause: err })
    }
  }

  private async listManagedRaw(window: SyncWindow): Promise<ExistingEvent[]> {
    const out: ExistingEvent[] = []
    let pageToken: string | undefined
    do {
      const res = await withRetry(() =>
        this.api.events.list({
          calendarId: this.calendarId,
          timeMin: window.start.toISOString(),
          timeMax: window.end.toISOString(),
          privateExtendedProperty: [`csApp=${APP_TAG}`],
          singleEvents: true,
          showDeleted: false,
          maxResults: 2500,
          pageToken,
        }),
      )
      for (const item of res.data.items ?? []) {
        const props = item.extendedProperties?.private
        if (!item.id || !props?.csKey || item.status === 'cancelled') continue
        out.push({ id: item.id, key: props.csKey, sourceId: props.csSource ?? '', hash: props.csHash ?? '' })
      }
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
    return out
  }

  async create(event: DesiredEvent): Promise<void> {
    const requestBody = toBody(event)
    try {
      await withRetry(() => this.api.events.insert({ calendarId: this.calendarId, requestBody }))
    } catch (err) {
      // 409: the id exists - typically an event we deleted earlier (ids stay
      // reserved), or another machine created it first. Overwrite/restore it.
      if (statusOf(err) !== 409) throw new Error(describeGoogleError(err), { cause: err })
      await this.update(event.key, event)
    }
  }

  async update(id: string, event: DesiredEvent): Promise<void> {
    const requestBody = { ...toBody(event), id }
    try {
      await withRetry(() => this.api.events.update({ calendarId: this.calendarId, eventId: id, requestBody }))
    } catch (err) {
      throw new Error(describeGoogleError(err), { cause: err })
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await withRetry(() => this.api.events.delete({ calendarId: this.calendarId, eventId: id }))
    } catch (err) {
      const status = statusOf(err)
      if (status === 404 || status === 410) return
      throw new Error(describeGoogleError(err), { cause: err })
    }
  }
}
