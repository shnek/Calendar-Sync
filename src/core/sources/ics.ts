import ICAL from 'ical.js'
import type { EventStatus, NormalizedEvent, ResponseStatus, ShowAs, SyncWindow } from '../types'
import { boundaryMs, resolveTimeZone, systemTimeZone, zonedTimeToUtc } from '../time'

type IcalTime = InstanceType<typeof ICAL.Time>
type IcalComponent = InstanceType<typeof ICAL.Component>
type IcalEvent = InstanceType<typeof ICAL.Event>

export interface FetchOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Downloads an ICS feed. Errors never include the (secret) URL. */
export async function fetchIcs(url: string, options: FetchOptions = {}): Promise<string> {
  const { fetchImpl = fetch, timeoutMs = 30_000 } = options
  const normalized = url.trim().replace(/^webcals?:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(normalized)) throw new Error('Feed URL must start with https:// or webcal://')
  let res: Response
  try {
    res = await fetchImpl(normalized, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'calendar-sync', Accept: 'text/calendar, */*' },
      redirect: 'follow',
    })
  } catch (err) {
    const name = (err as Error)?.name
    if (name === 'TimeoutError' || name === 'AbortError') throw new Error('Timed out downloading feed', { cause: err })
    throw new Error(`Could not download feed: ${(err as Error)?.message ?? String(err)}`, { cause: err })
  }
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`)
  const text = await res.text()
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4096))) {
    throw new Error('Response is not an iCalendar feed - check that you copied the ICS/iCal address')
  }
  return text
}

export interface ParseOptions {
  sourceId: string
  window: SyncWindow
  /** Calendar owner's email, for detecting declined invites. */
  ownerEmail?: string
  /** Zone used to interpret all-day dates when testing window overlap. */
  timeZone?: string
  /** Safety cap on occurrences expanded per recurring series. */
  maxOccurrences?: number
}

export interface ParsedFeed {
  calendarName?: string
  ownerEmail?: string
  events: NormalizedEvent[]
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

function isFloating(time: IcalTime): boolean {
  return !time.zone || time.zone === ICAL.Timezone.localTimezone || time.zone.tzid === 'floating'
}

/** Converts an ICAL.Time into our boundary format (ISO instant or YYYY-MM-DD). */
function toBoundary(time: IcalTime, tzidHint: string | undefined): string {
  if (time.isDate) return `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}`
  if (isFloating(time)) {
    // TZID not defined in the feed (non-compliant) - resolve it ourselves; true
    // floating times fall back to the machine's local zone.
    const tz = resolveTimeZone(tzidHint)
    if (tz) {
      return zonedTimeToUtc(time.year, time.month, time.day, time.hour, time.minute, time.second, tz).toISOString()
    }
  }
  return time.toJSDate().toISOString()
}

function tzidOf(component: IcalComponent, prop: string): string | undefined {
  const p = component.getFirstProperty(prop)
  const tzid = p?.getParameter('tzid')
  return typeof tzid === 'string' ? tzid : undefined
}

function text(component: IcalComponent, prop: string): string {
  const v = component.getFirstPropertyValue(prop)
  return v == null ? '' : String(v).trim()
}

function mapShowAs(component: IcalComponent): ShowAs {
  const ms = text(component, 'x-microsoft-cdo-busystatus').toUpperCase()
  switch (ms) {
    case 'FREE':
      return 'free'
    case 'TENTATIVE':
      return 'tentative'
    case 'OOF':
      return 'oof'
    case 'WORKINGELSEWHERE':
      return 'workingElsewhere'
    case 'BUSY':
      return 'busy'
  }
  if (text(component, 'transp').toUpperCase() === 'TRANSPARENT') return 'free'
  if (text(component, 'status').toUpperCase() === 'TENTATIVE') return 'tentative'
  return 'busy'
}

function mapStatus(component: IcalComponent): EventStatus {
  switch (text(component, 'status').toUpperCase()) {
    case 'CANCELLED':
      return 'cancelled'
    case 'TENTATIVE':
      return 'tentative'
    default:
      return 'confirmed'
  }
}

const stripMailto = (v: unknown) =>
  String(v ?? '')
    .replace(/^mailto:/i, '')
    .trim()
    .toLowerCase()

function mapResponse(component: IcalComponent, ownerEmail: string | undefined): ResponseStatus {
  if (!ownerEmail) return 'unknown'
  const owner = ownerEmail.toLowerCase()
  for (const attendee of component.getAllProperties('attendee')) {
    if (stripMailto(attendee.getFirstValue()) !== owner) continue
    switch (String(attendee.getParameter('partstat') ?? '').toUpperCase()) {
      case 'ACCEPTED':
        return 'accepted'
      case 'DECLINED':
        return 'declined'
      case 'TENTATIVE':
        return 'tentative'
      case 'NEEDS-ACTION':
        return 'needsAction'
      default:
        return 'unknown'
    }
  }
  if (stripMailto(component.getFirstPropertyValue('organizer')) === owner) return 'accepted'
  return 'unknown'
}

function categories(component: IcalComponent): string[] {
  return component
    .getAllProperties('categories')
    .flatMap((p) => p.getValues().map((v) => String(v).trim()))
    .filter(Boolean)
}

function rootComponents(textData: string): IcalComponent[] {
  const parsed = ICAL.parse(textData) as unknown
  const list = Array.isArray(parsed) && typeof parsed[0] === 'string' ? [parsed] : (parsed as unknown[])
  return list.map((jcal) => new ICAL.Component(jcal as never))
}

/** Parses an ICS document and expands recurrences into occurrences overlapping the window. */
export function parseIcs(textData: string, options: ParseOptions): ParsedFeed {
  const { sourceId, window } = options
  const tz = options.timeZone || systemTimeZone()
  const maxOccurrences = options.maxOccurrences ?? 20_000
  const windowStart = window.start.getTime()
  const windowEnd = window.end.getTime()
  // Expansion stops this far past the window so moved exceptions are still found.
  const iterationLimit = windowEnd + 35 * 24 * 60 * 60 * 1000

  const roots = rootComponents(textData)
  const calendarName = roots.map((r) => text(r, 'x-wr-calname')).find(Boolean)
  const ownerEmail =
    options.ownerEmail?.trim() || (calendarName && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(calendarName) ? calendarName : undefined)

  const events: NormalizedEvent[] = []
  const seen = new Set<string>()

  const emit = (item: IcalEvent, startTime: IcalTime, endTime: IcalTime, recurrenceId: IcalTime | undefined, recurring: boolean) => {
    const component = item.component
    const startTz = tzidOf(component, 'dtstart')
    const endTz = tzidOf(component, 'dtend') ?? startTz
    const allDay = startTime.isDate
    const start = toBoundary(startTime, startTz)
    let end = toBoundary(endTime, endTz)
    if (allDay && !endTime.isDate) end = toBoundary(startTime, startTz)
    const startMs = boundaryMs(start, tz)
    let endMs = boundaryMs(end, tz)
    if (endMs < startMs) {
      end = start
      endMs = startMs
    }
    if (allDay && endMs <= startMs) {
      const next = startTime.clone()
      next.day += 1
      end = toBoundary(next, startTz)
      endMs = boundaryMs(end, tz)
    }
    // Overlap test; zero-length events count if they start inside the window.
    if (!(startMs < windowEnd && (endMs > windowStart || (endMs === startMs && startMs >= windowStart)))) return

    const uid = item.uid || text(component, 'uid') || `${start}|${item.summary}`
    const key = recurrenceId ? `${uid}#${toBoundary(recurrenceId, startTz)}` : uid
    if (seen.has(key)) return
    seen.add(key)

    events.push({
      sourceId,
      key,
      uid,
      title: (item.summary ?? '').trim(),
      allDay,
      start,
      end,
      showAs: mapShowAs(component),
      status: mapStatus(component),
      response: mapResponse(component, ownerEmail),
      description: (item.description ?? '').trim(),
      location: (item.location ?? '').trim(),
      categories: categories(component),
      recurring,
    })
  }

  for (const root of roots) {
    const vevents = root.getAllSubcomponents('vevent')
    const masters = new Map<string, IcalComponent>()
    const exceptions = new Map<string, IcalComponent[]>()
    const orphans: IcalComponent[] = []

    for (const vevent of vevents) {
      const uid = text(vevent, 'uid')
      const isException = vevent.hasProperty('recurrence-id')
      if (!isException) {
        // Duplicate UIDs without RECURRENCE-ID: keep each as its own event.
        if (uid && !masters.has(uid)) masters.set(uid, vevent)
        else orphans.push(vevent)
      } else {
        const list = exceptions.get(uid) ?? []
        list.push(vevent)
        exceptions.set(uid, list)
      }
    }

    for (const [uid, master] of masters) {
      const related = exceptions.get(uid) ?? []
      exceptions.delete(uid)
      let event: IcalEvent
      try {
        event = new ICAL.Event(master, { exceptions: related, strictExceptions: true })
      } catch {
        continue
      }
      if (!master.hasProperty('dtstart')) continue

      if (!event.isRecurring()) {
        emit(event, event.startDate, event.endDate, undefined, false)
        continue
      }

      const iterator = event.iterator()
      let count = 0
      for (let next = iterator.next(); next; next = iterator.next()) {
        if (++count > maxOccurrences) break
        if (next.toJSDate().getTime() > iterationLimit) break
        const details = event.getOccurrenceDetails(next)
        emit(details.item, details.startDate, details.endDate, details.recurrenceId, true)
      }
    }

    // Exceptions whose master is not in the feed, and duplicate-UID events.
    for (const vevent of [...orphans, ...[...exceptions.values()].flat()]) {
      if (!vevent.hasProperty('dtstart')) continue
      const event = new ICAL.Event(vevent)
      const rid = vevent.hasProperty('recurrence-id') ? event.recurrenceId : undefined
      emit(event, event.startDate, event.endDate, rid ?? event.startDate, Boolean(rid))
    }
  }

  events.sort((a, b) => boundaryMs(a.start, tz) - boundaryMs(b.start, tz))
  return { calendarName, ownerEmail, events }
}
