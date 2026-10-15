import type { SyncWindow } from '../types'
import type { CalendarTarget, DesiredEvent, ExistingEvent } from './target'

/** In-memory target used by tests and the CLI's offline mode. */
export class MemoryTarget implements CalendarTarget {
  readonly events = new Map<string, DesiredEvent>()
  readonly calls = { create: 0, update: 0, delete: 0 }

  async listManaged(window: SyncWindow): Promise<ExistingEvent[]> {
    const startMs = window.start.getTime()
    const endMs = window.end.getTime()
    return [...this.events.entries()]
      .filter(([, e]) => Date.parse(e.start) < endMs && Date.parse(e.end) >= startMs)
      .map(([id, e]) => ({ id, key: e.key, sourceId: e.sourceId, hash: e.hash }))
  }

  async create(event: DesiredEvent): Promise<void> {
    this.calls.create++
    this.events.set(event.key, event)
  }

  async update(id: string, event: DesiredEvent): Promise<void> {
    this.calls.update++
    this.events.set(id, event)
  }

  async delete(id: string): Promise<void> {
    this.calls.delete++
    this.events.delete(id)
  }
}
