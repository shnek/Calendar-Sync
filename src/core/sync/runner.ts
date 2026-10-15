import { syncWindow } from '../config'
import { evaluateRules } from '../rules/engine'
import { fetchIcs, parseIcs, type FetchOptions } from '../sources/ics'
import type { CalendarTarget } from '../targets/target'
import { boundaryMs, resolveTimeZone, systemTimeZone } from '../time'
import type { AppConfig, EventDecision, PreviewResult, SourceResult, SyncReport } from '../types'
import { planSync, toDesired } from './planner'

export interface RunOptions extends FetchOptions {
  now?: Date
  /** Max concurrent writes to the target. */
  concurrency?: number
  log?: (message: string) => void
}

export function effectiveTimeZone(config: AppConfig): string {
  return resolveTimeZone(config.sync.timeZone) ?? systemTimeZone()
}

/** Fetches every enabled source and runs the rules. Does not touch the target. */
export async function buildPreview(config: AppConfig, options: RunOptions = {}): Promise<PreviewResult> {
  const now = options.now ?? new Date()
  const window = syncWindow(config, now)
  const timeZone = effectiveTimeZone(config)
  const enabled = config.sources.filter((s) => s.enabled)

  const perSource = await Promise.all(
    enabled.map(async (source): Promise<{ result: SourceResult; decisions: EventDecision[] }> => {
      try {
        if (!source.url.trim()) throw new Error('No feed URL configured')
        const text = await fetchIcs(source.url, options)
        const feed = parseIcs(text, { sourceId: source.id, window, ownerEmail: source.ownerEmail, timeZone })
        const decisions = feed.events.map((event) =>
          evaluateRules(event, config.rules, { source, titleTemplate: config.target.titleTemplate, timeZone }),
        )
        return {
          result: {
            sourceId: source.id,
            name: source.name,
            ok: true,
            calendarName: feed.calendarName,
            eventCount: feed.events.length,
            includedCount: decisions.filter((d) => d.included).length,
          },
          decisions,
        }
      } catch (err) {
        const message = (err as Error)?.message ?? String(err)
        options.log?.(`Source "${source.name}" failed: ${message}`)
        return {
          result: { sourceId: source.id, name: source.name, ok: false, error: message, eventCount: 0, includedCount: 0 },
          decisions: [],
        }
      }
    }),
  )

  const decisions = perSource
    .flatMap((p) => p.decisions)
    .sort((a, b) => boundaryMs(a.event.start, timeZone) - boundaryMs(b.event.start, timeZone))
  return {
    generatedAt: now.toISOString(),
    window: { start: window.start.toISOString(), end: window.end.toISOString() },
    sources: perSource.map((p) => p.result),
    decisions,
  }
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<string[]> {
  const errors: string[] = []
  let index = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]
      try {
        await worker(item)
      } catch (err) {
        errors.push((err as Error)?.message ?? String(err))
      }
    }
  })
  await Promise.all(runners)
  return errors
}

/** Full sync: preview, diff against the target, then apply (unless dryRun). */
export async function runSync(
  config: AppConfig,
  target: CalendarTarget,
  options: RunOptions & { dryRun?: boolean } = {},
): Promise<SyncReport> {
  const now = options.now ?? new Date()
  const preview = await buildPreview(config, { ...options, now })
  const window = syncWindow(config, now)
  const errors = preview.sources.filter((s) => !s.ok).map((s) => `${s.name}: ${s.error}`)

  const desired = preview.decisions.filter((d) => d.included).map(toDesired)
  const existing = await target.listManaged(window)
  const plan = planSync({
    desired,
    existing,
    syncedSourceIds: new Set(preview.sources.filter((s) => s.ok).map((s) => s.sourceId)),
    activeSourceIds: new Set(config.sources.filter((s) => s.enabled).map((s) => s.id)),
  })

  const report: SyncReport = {
    ...preview,
    dryRun: Boolean(options.dryRun),
    finishedAt: now.toISOString(),
    created: plan.create.length,
    updated: plan.update.length,
    deleted: plan.delete.length,
    unchanged: plan.unchanged,
    errors,
  }
  if (options.dryRun) return report

  const concurrency = options.concurrency ?? 4
  const writeErrors = [
    ...(await runPool(plan.delete, concurrency, (e) => target.delete(e.id))),
    ...(await runPool(plan.update, concurrency, (u) => target.update(u.id, u.event))),
    ...(await runPool(plan.create, concurrency, (e) => target.create(e))),
  ]
  if (writeErrors.length) {
    const unique = [...new Set(writeErrors)]
    report.errors.push(`${writeErrors.length} calendar write(s) failed: ${unique.slice(0, 3).join('; ')}`)
  }
  report.finishedAt = new Date().toISOString()
  options.log?.(
    `Sync done: +${report.created} ~${report.updated} -${report.deleted} =${report.unchanged}` +
      (report.errors.length ? ` (${report.errors.length} error(s))` : ''),
  )
  return report
}
