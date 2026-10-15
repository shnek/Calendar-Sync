/**
 * Shared domain types. This module must stay free of Node/Electron imports so
 * the renderer can import it for typing.
 */

export type ShowAs = 'busy' | 'free' | 'tentative' | 'oof' | 'workingElsewhere'
export type EventStatus = 'confirmed' | 'tentative' | 'cancelled'
export type ResponseStatus = 'accepted' | 'declined' | 'tentative' | 'needsAction' | 'unknown'

/** An event occurrence read from a source, after recurrence expansion. */
export interface NormalizedEvent {
  sourceId: string
  /** Stable identifier of this occurrence within its source (UID + recurrence id). */
  key: string
  uid: string
  title: string
  allDay: boolean
  /** ISO instant (`2026-01-01T09:00:00.000Z`) for timed events, `YYYY-MM-DD` for all-day. */
  start: string
  /** Exclusive end, same format as `start`. */
  end: string
  showAs: ShowAs
  status: EventStatus
  /** The calendar owner's response, when it can be determined from ATTENDEE lines. */
  response: ResponseStatus
  /** Used only for rule matching; never written to the target. */
  description: string
  location: string
  categories: string[]
  recurring: boolean
}

export interface SourceConfig {
  id: string
  /** Display name, e.g. "Acme Google". */
  name: string
  /** Secret ICS/iCal feed URL (https:// or webcal://). */
  url: string
  /** Project/client label used in synced titles, e.g. "Acme". */
  project: string
  enabled: boolean
  /** Your address in this calendar; used to detect declined invites. Auto-detected when possible. */
  ownerEmail?: string
}

export interface RuleMatch {
  /** Case-insensitive regular expression tested against the event title. */
  titleRegex?: string
  /** Case-insensitive regular expression tested against description and location. */
  descriptionRegex?: string
  allDay?: boolean
  showAs?: ShowAs[]
  status?: EventStatus[]
  response?: ResponseStatus[]
  recurring?: boolean
  minDurationMinutes?: number
  maxDurationMinutes?: number
  /** 0 = Sunday … 6 = Saturday, evaluated in the configured time zone. */
  weekdays?: number[]
  /** `HH:MM`; matches events starting at or after this local time. */
  startsAtOrAfter?: string
  /** `HH:MM`; matches events starting before this local time. */
  startsBefore?: string
}

export type RuleAction = { type: 'exclude' } | { type: 'setTitle'; title: string }

export interface Rule {
  id: string
  name: string
  enabled: boolean
  /** Source ids this rule applies to; empty means all sources. */
  sourceIds: string[]
  /** All specified conditions must match (AND). An empty match matches every event. */
  match: RuleMatch
  action: RuleAction
}

export type GoogleScopeMode = 'app-created' | 'full'

export interface GoogleSettings {
  /** Leave empty to use the client built into release builds (if any). */
  clientId?: string
  clientSecret?: string
  refreshToken?: string
  accountEmail?: string
  scopeMode: GoogleScopeMode
}

export interface TargetSettings {
  calendarId?: string
  calendarName?: string
  /** Supports {project}, {source} and {title}. */
  titleTemplate: string
}

export interface SyncSettings {
  autoSync: boolean
  intervalMinutes: number
  pastDays: number
  futureDays: number
  /** IANA zone used for weekday/time-of-day rules. Empty = system zone. */
  timeZone?: string
}

export interface AppSettings {
  launchAtLogin: boolean
  autoUpdate: boolean
}

export interface AppConfig {
  version: 1
  sources: SourceConfig[]
  rules: Rule[]
  target: TargetSettings
  google: GoogleSettings
  sync: SyncSettings
  app: AppSettings
}

export interface SyncWindow {
  start: Date
  end: Date
}

/** Outcome of running the rules against one event. */
export interface EventDecision {
  event: NormalizedEvent
  included: boolean
  /** Final title that will be written (only meaningful when included). */
  title: string
  excludedBy?: { ruleId: string; ruleName: string }
  /** Names of non-exclude rules that changed the event. */
  appliedRules: string[]
}

export interface SourceResult {
  sourceId: string
  name: string
  ok: boolean
  error?: string
  calendarName?: string
  eventCount: number
  includedCount: number
}

export interface PreviewResult {
  generatedAt: string
  window: { start: string; end: string }
  sources: SourceResult[]
  decisions: EventDecision[]
}

export interface SyncReport extends PreviewResult {
  dryRun: boolean
  finishedAt: string
  created: number
  updated: number
  deleted: number
  unchanged: number
  /** Errors that prevented (part of) the sync, including failed sources. */
  errors: string[]
}
