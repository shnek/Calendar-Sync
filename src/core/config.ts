import type { AppConfig, Rule, SourceConfig, SyncWindow } from './types'

export const DEFAULT_TITLE_TEMPLATE = 'Work - {project}'

export function defaultRules(): Rule[] {
  return [
    {
      id: 'default-cancelled',
      name: 'Skip cancelled events',
      enabled: true,
      sourceIds: [],
      match: { status: ['cancelled'] },
      action: { type: 'exclude' },
    },
    {
      id: 'default-declined',
      name: 'Skip invites I declined',
      enabled: true,
      sourceIds: [],
      match: { response: ['declined'] },
      action: { type: 'exclude' },
    },
    {
      id: 'default-free',
      name: 'Skip events marked as free',
      enabled: true,
      sourceIds: [],
      match: { showAs: ['free'] },
      action: { type: 'exclude' },
    },
    {
      id: 'default-focus',
      name: 'Skip focus blocks',
      enabled: false,
      sourceIds: [],
      match: { titleRegex: '\\bfocus\\b' },
      action: { type: 'exclude' },
    },
  ]
}

export function defaultConfig(): AppConfig {
  return {
    version: 1,
    sources: [],
    rules: defaultRules(),
    target: { titleTemplate: DEFAULT_TITLE_TEMPLATE },
    google: { scopeMode: 'app-created' },
    sync: { autoSync: true, intervalMinutes: 15, pastDays: 7, futureDays: 60 },
    app: { launchAtLogin: true, autoUpdate: true },
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? Math.round(value) : Number.NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** Fills in defaults and clamps values so a partially written or older config is always usable. */
export function normalizeConfig(input: Partial<AppConfig> | undefined | null): AppConfig {
  const base = defaultConfig()
  const raw = input ?? {}
  const sources: SourceConfig[] = Array.isArray(raw.sources)
    ? raw.sources
        .filter((s) => s && typeof s.id === 'string')
        .map((s) => ({
          id: s.id,
          name: s.name ?? 'Calendar',
          url: s.url ?? '',
          project: s.project ?? s.name ?? '',
          enabled: s.enabled !== false,
          ownerEmail: s.ownerEmail || undefined,
        }))
    : base.sources
  const rules: Rule[] = Array.isArray(raw.rules)
    ? raw.rules
        .filter((r) => r && typeof r.id === 'string')
        .map((r) => ({
          id: r.id,
          name: r.name ?? 'Rule',
          enabled: r.enabled !== false,
          sourceIds: Array.isArray(r.sourceIds) ? r.sourceIds : [],
          match: r.match ?? {},
          action: r.action ?? { type: 'exclude' },
        }))
    : base.rules
  return {
    version: 1,
    sources,
    rules,
    target: {
      ...base.target,
      ...raw.target,
      titleTemplate: raw.target?.titleTemplate?.trim() || DEFAULT_TITLE_TEMPLATE,
    },
    google: {
      ...base.google,
      ...raw.google,
      scopeMode: raw.google?.scopeMode === 'full' ? 'full' : 'app-created',
    },
    sync: {
      autoSync: raw.sync?.autoSync ?? base.sync.autoSync,
      intervalMinutes: clampInt(raw.sync?.intervalMinutes, 5, 24 * 60, base.sync.intervalMinutes),
      pastDays: clampInt(raw.sync?.pastDays, 0, 90, base.sync.pastDays),
      futureDays: clampInt(raw.sync?.futureDays, 1, 365, base.sync.futureDays),
      timeZone: raw.sync?.timeZone || undefined,
    },
    app: { ...base.app, ...raw.app },
  }
}

export function syncWindow(config: AppConfig, now: Date = new Date()): SyncWindow {
  const day = 24 * 60 * 60 * 1000
  const start = new Date(now.getTime() - config.sync.pastDays * day)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now.getTime() + config.sync.futureDays * day)
  end.setHours(0, 0, 0, 0)
  return { start, end }
}

export function newId(): string {
  return globalThis.crypto.randomUUID()
}
