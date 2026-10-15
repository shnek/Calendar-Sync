import { createHash } from 'node:crypto'
import type { EventDecision } from '../types'
import type { DesiredEvent, ExistingEvent } from '../targets/target'

export interface SyncPlan {
  create: DesiredEvent[]
  update: { id: string; event: DesiredEvent }[]
  delete: ExistingEvent[]
  unchanged: number
}

function sha(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

export function eventKey(sourceId: string, occurrenceKey: string): string {
  return sha(`${sourceId}\n${occurrenceKey}`, 32)
}

export function toDesired(decision: EventDecision): DesiredEvent {
  const { event } = decision
  const visible = { title: decision.title, allDay: event.allDay, start: event.start, end: event.end }
  return {
    key: eventKey(event.sourceId, event.key),
    sourceId: event.sourceId,
    ...visible,
    hash: sha(JSON.stringify([visible.title, visible.allDay, visible.start, visible.end]), 16),
  }
}

export interface PlanInput {
  desired: DesiredEvent[]
  existing: ExistingEvent[]
  /** Sources fetched successfully this run; only their events may be deleted. */
  syncedSourceIds: Set<string>
  /** Sources that are configured and enabled (events from anything else are orphans). */
  activeSourceIds: Set<string>
}

/**
 * Diffs the desired state against what exists in the target. Events belonging
 * to a source that failed to fetch are left untouched - a failed download is
 * not the same as an empty calendar.
 */
export function planSync(input: PlanInput): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], delete: [], unchanged: 0 }
  const existingByKey = new Map<string, ExistingEvent>()

  for (const ev of input.existing) {
    if (existingByKey.has(ev.key)) {
      // Duplicate (e.g. two machines raced); keep the first copy.
      plan.delete.push(ev)
      continue
    }
    existingByKey.set(ev.key, ev)
  }

  const desiredKeys = new Set<string>()
  for (const want of input.desired) {
    if (desiredKeys.has(want.key)) continue
    desiredKeys.add(want.key)
    const have = existingByKey.get(want.key)
    if (!have) plan.create.push(want)
    else if (have.hash !== want.hash || have.sourceId !== want.sourceId) plan.update.push({ id: have.id, event: want })
    else plan.unchanged++
  }

  for (const [key, have] of existingByKey) {
    if (desiredKeys.has(key)) continue
    const sourceGone = !input.activeSourceIds.has(have.sourceId)
    if (sourceGone || input.syncedSourceIds.has(have.sourceId)) plan.delete.push(have)
  }
  return plan
}
