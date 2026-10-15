import type { SyncWindow } from '../types'

/** Tag written into every event we create, so we only ever touch our own events. */
export const APP_TAG = 'calendar-sync'

/** An event as it should exist in the target calendar. */
export interface DesiredEvent {
  /** Opaque, stable identity (hash of source id + occurrence key). */
  key: string
  sourceId: string
  title: string
  allDay: boolean
  start: string
  end: string
  /** Hash of the visible fields; a change triggers an update. */
  hash: string
}

/** A managed event that already exists in the target calendar. */
export interface ExistingEvent {
  id: string
  key: string
  sourceId: string
  hash: string
}

/**
 * A calendar we write to. Implementations must only list and modify events
 * tagged with {@link APP_TAG}. Future targets (e.g. "busy" blocks on other work
 * calendars) implement this same interface.
 */
export interface CalendarTarget {
  listManaged(window: SyncWindow): Promise<ExistingEvent[]>
  create(event: DesiredEvent): Promise<void>
  update(id: string, event: DesiredEvent): Promise<void>
  delete(id: string): Promise<void>
}
