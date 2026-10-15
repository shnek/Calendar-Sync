/**
 * Time zone helpers built on Intl, used when a feed references a TZID it does
 * not define (non-compliant feeds) and for weekday/time-of-day rule matching.
 */

/** Fallback mapping for common Windows zone names used by Outlook/Exchange feeds. */
const WINDOWS_ZONES: Record<string, string> = {
  UTC: 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Singapore Standard Time': 'Asia/Singapore',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Arabian Standard Time': 'Asia/Dubai',
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    formatterCache.set(timeZone, f)
  }
  return f
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz)
    return true
  } catch {
    return false
  }
}

/** Maps a TZID (IANA or Windows name) to an IANA zone, or undefined if unknown. */
export function resolveTimeZone(tzid: string | undefined | null): string | undefined {
  if (!tzid) return undefined
  const cleaned = tzid.replace(/^\/+/, '').replace(/^"|"$/g, '')
  if (WINDOWS_ZONES[cleaned]) return WINDOWS_ZONES[cleaned]
  return isValidTimeZone(cleaned) ? cleaned : undefined
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: number
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {}
  for (const p of formatter(timeZone).formatToParts(date)) parts[p.type] = p.value
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  }
}

function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** Converts a wall-clock time in `timeZone` to an absolute instant. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const first = offsetMs(new Date(guess), timeZone)
  let result = guess - first
  const second2 = offsetMs(new Date(result), timeZone)
  if (second2 !== first) result = guess - second2
  return new Date(result)
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** Parses `HH:MM` into minutes since midnight, or undefined if malformed. */
export function parseClock(value: string | undefined): number | undefined {
  if (!value) return undefined
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return undefined
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return undefined
  return h * 60 + min
}

/** Adds days to a `YYYY-MM-DD` date string. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Interprets an event boundary (ISO instant or all-day date in local zone) as epoch ms. */
export function boundaryMs(value: string, timeZone: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return zonedTimeToUtc(y, m, d, 0, 0, 0, timeZone).getTime()
  }
  return Date.parse(value)
}
