import type {
  AppConfig,
  AppSettings,
  GoogleScopeMode,
  PreviewResult,
  Rule,
  SourceConfig,
  SyncReport,
  SyncSettings,
  TargetSettings,
} from '../core/types'

export type SyncState = 'unconfigured' | 'idle' | 'syncing' | 'error' | 'paused'

export interface StatusInfo {
  state: SyncState
  message: string
  lastSyncAt?: string
  lastSuccessAt?: string
  nextSyncAt?: string
  consecutiveFailures: number
  /** Things the user must do before syncing can work. */
  setupIssues: string[]
  version: string
}

/** Config as seen by the renderer: Google secrets are never sent over IPC. */
export interface PublicConfig extends Omit<AppConfig, 'google'> {
  google: {
    clientId?: string
    hasClientSecret: boolean
    builtInClientAvailable: boolean
    connected: boolean
    accountEmail?: string
    scopeMode: GoogleScopeMode
  }
}

export interface ConfigPatch {
  sources?: SourceConfig[]
  rules?: Rule[]
  target?: Partial<TargetSettings>
  sync?: Partial<SyncSettings>
  app?: Partial<AppSettings>
  /** Changing the client or permission level disconnects the Google account. */
  google?: { clientId?: string; clientSecret?: string; scopeMode?: GoogleScopeMode }
}

export interface SourceTestResult {
  ok: boolean
  calendarName?: string
  ownerEmail?: string
  eventCount?: number
  error?: string
}

export interface CalendarInfo {
  id: string
  summary: string
  primary: boolean
  accessRole: string
}

export interface LogEntry {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export type ReportSummary = Pick<
  SyncReport,
  'dryRun' | 'generatedAt' | 'finishedAt' | 'created' | 'updated' | 'deleted' | 'unchanged' | 'errors' | 'sources'
>

/** API exposed to the renderer as `window.api`. */
export interface RendererApi {
  getConfig(): Promise<PublicConfig>
  updateConfig(patch: ConfigPatch): Promise<PublicConfig>
  getStatus(): Promise<StatusInfo>
  onStatus(listener: (status: StatusInfo) => void): () => void
  syncNow(): Promise<ReportSummary | undefined>
  preview(): Promise<PreviewResult>
  testSource(url: string, ownerEmail?: string): Promise<SourceTestResult>
  getReports(): Promise<ReportSummary[]>
  getLog(): Promise<LogEntry[]>
  connectGoogle(): Promise<PublicConfig>
  cancelConnectGoogle(): Promise<void>
  disconnectGoogle(): Promise<PublicConfig>
  listCalendars(): Promise<CalendarInfo[]>
  createCalendar(name: string): Promise<PublicConfig>
  selectCalendar(id: string): Promise<PublicConfig>
  openExternal(url: string): Promise<void>
  openLogFolder(): Promise<void>
  checkForUpdates(): Promise<string>
}

export const IPC = {
  getConfig: 'config:get',
  updateConfig: 'config:update',
  getStatus: 'status:get',
  status: 'status:changed',
  syncNow: 'sync:now',
  preview: 'sync:preview',
  testSource: 'source:test',
  getReports: 'reports:get',
  getLog: 'log:get',
  connectGoogle: 'google:connect',
  cancelConnectGoogle: 'google:cancel',
  disconnectGoogle: 'google:disconnect',
  listCalendars: 'google:calendars',
  createCalendar: 'google:create-calendar',
  selectCalendar: 'google:select-calendar',
  openExternal: 'shell:open-external',
  openLogFolder: 'shell:open-logs',
  checkForUpdates: 'app:check-updates',
} as const
