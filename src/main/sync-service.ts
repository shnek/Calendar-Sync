import { EventEmitter } from 'node:events'
import type { OAuth2Client } from 'google-auth-library'
import { authorizeInteractive, createAuthorizedClient, revokeRefreshToken, scopesFor } from '../core/google/auth'
import { fetchIcs, parseIcs } from '../core/sources/ics'
import { buildPreview, effectiveTimeZone, runSync } from '../core/sync/runner'
import { syncWindow } from '../core/config'
import { describeGoogleError, GoogleCalendarApi, GoogleCalendarTarget } from '../core/targets/google'
import type { AppConfig, PreviewResult, SyncReport } from '../core/types'
import type { CalendarInfo, ReportSummary, SourceTestResult, StatusInfo } from '../shared/ipc'
import type { ConfigStore } from './config-store'
import type { Logger } from './logger'

export interface BuiltInClient {
  clientId?: string
  clientSecret?: string
}

const MAX_REPORTS = 25
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000

function summarize(report: SyncReport): ReportSummary {
  const { dryRun, generatedAt, finishedAt, created, updated, deleted, unchanged, errors, sources } = report
  return { dryRun, generatedAt, finishedAt, created, updated, deleted, unchanged, errors, sources }
}

/**
 * Owns the sync loop: scheduling, backoff, status reporting and the Google
 * connection. Emits `status` whenever {@link StatusInfo} changes and
 * `failure` when the user should be notified.
 */
export class SyncService extends EventEmitter {
  private timer: NodeJS.Timeout | undefined
  private running: Promise<ReportSummary | undefined> | undefined
  private authClient: { key: string; client: OAuth2Client } | undefined
  private connectAbort: AbortController | undefined
  private readonly reports: ReportSummary[] = []
  private status: StatusInfo

  constructor(
    private readonly store: ConfigStore,
    private readonly logger: Logger,
    private readonly builtIn: BuiltInClient,
    version: string,
  ) {
    super()
    this.status = { state: 'idle', message: 'Starting…', consecutiveFailures: 0, setupIssues: [], version }
    this.refreshStatus()
  }

  getStatus(): StatusInfo {
    return { ...this.status }
  }

  getReports(): ReportSummary[] {
    return [...this.reports]
  }

  /** Begins automatic syncing shortly after launch. */
  start(): void {
    this.schedule(5_000)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.connectAbort?.abort()
  }

  /** Call after any config change that may affect scheduling or setup state. */
  configChanged(): void {
    this.refreshStatus()
    const { autoSync, intervalMinutes } = this.store.get().sync
    if (!autoSync) {
      if (this.timer) clearTimeout(this.timer)
      this.timer = undefined
      this.setStatus({ nextSyncAt: undefined })
      this.refreshStatus()
    } else if (!this.timer && !this.running) {
      this.schedule(Math.min(intervalMinutes * 60_000, 10_000))
    }
  }

  setupIssues(config: AppConfig = this.store.get()): string[] {
    const issues: string[] = []
    if (!config.sources.some((s) => s.enabled && s.url)) issues.push('Add at least one work calendar feed')
    if (!this.credentials(config).clientId) issues.push('Configure a Google OAuth client')
    else if (!config.google.refreshToken) issues.push('Connect your Google account')
    else if (!config.target.calendarId) issues.push('Choose the calendar to sync into')
    return issues
  }

  credentials(config: AppConfig = this.store.get()): { clientId?: string; clientSecret?: string } {
    if (config.google.clientId) return { clientId: config.google.clientId, clientSecret: config.google.clientSecret }
    return { clientId: this.builtIn.clientId, clientSecret: this.builtIn.clientSecret }
  }

  // ---- Sync -----------------------------------------------------------------

  syncNow(reason = 'manual'): Promise<ReportSummary | undefined> {
    if (this.running) return this.running
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.running = this.execute(reason).finally(() => {
      this.running = undefined
    })
    return this.running
  }

  async preview(): Promise<PreviewResult> {
    const config = this.store.get()
    return buildPreview(config, { log: (m) => this.logger.warn(m) })
  }

  async testSource(url: string, ownerEmail?: string): Promise<SourceTestResult> {
    try {
      const config = this.store.get()
      const text = await fetchIcs(url)
      const feed = parseIcs(text, {
        sourceId: 'test',
        window: syncWindow(config),
        ownerEmail,
        timeZone: effectiveTimeZone(config),
      })
      return { ok: true, calendarName: feed.calendarName, ownerEmail: feed.ownerEmail, eventCount: feed.events.length }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer)
    const config = this.store.get()
    if (!config.sync.autoSync) {
      this.timer = undefined
      this.refreshStatus()
      return
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.syncNow('scheduled')
    }, delayMs)
    this.setStatus({ nextSyncAt: new Date(Date.now() + delayMs).toISOString() })
  }

  private nextDelay(): number {
    const base = this.store.get().sync.intervalMinutes * 60_000
    const failures = this.status.consecutiveFailures
    return failures > 0 ? Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(failures - 1, 6)) : base
  }

  private async execute(reason: string): Promise<ReportSummary | undefined> {
    const config = this.store.get()
    const issues = this.setupIssues(config)
    if (issues.length) {
      this.refreshStatus()
      this.schedule(this.nextDelay())
      return undefined
    }

    this.setStatus({ state: 'syncing', message: 'Syncing…' })
    this.logger.info(`Sync started (${reason})`)
    try {
      const target = new GoogleCalendarTarget(this.google(config), config.target.calendarId!)
      const report = summarize(await runSync(config, target, { log: (m) => this.logger.info(m) }))
      this.pushReport(report)
      for (const e of report.errors) this.logger.warn(e)
      const now = new Date().toISOString()
      const sourcesFailed = report.sources.filter((s) => !s.ok).length
      // Partial source failures are warnings: other sources still synced, so no backoff.
      this.setStatus({
        state: report.errors.length ? 'error' : 'idle',
        message: report.errors.length
          ? sourcesFailed
            ? `${sourcesFailed} calendar feed(s) failed`
            : 'Some changes could not be written'
          : `Synced: +${report.created} ~${report.updated} -${report.deleted}`,
        lastSyncAt: now,
        lastSuccessAt: now,
        consecutiveFailures: 0,
      })
      return report
    } catch (err) {
      const message = describeGoogleError(err)
      const failures = this.status.consecutiveFailures + 1
      this.logger.error(`Sync failed: ${message}`)
      this.setStatus({ state: 'error', message, lastSyncAt: new Date().toISOString(), consecutiveFailures: failures })
      if (failures === 3 || /reconnect/i.test(message)) this.emit('failure', message)
      return undefined
    } finally {
      this.schedule(this.nextDelay())
    }
  }

  private pushReport(report: ReportSummary): void {
    this.reports.unshift(report)
    if (this.reports.length > MAX_REPORTS) this.reports.length = MAX_REPORTS
  }

  // ---- Google ---------------------------------------------------------------

  private google(config: AppConfig): OAuth2Client {
    const { clientId, clientSecret } = this.credentials(config)
    const refreshToken = config.google.refreshToken
    if (!clientId || !refreshToken) throw new Error('Google account is not connected')
    const key = `${clientId}|${refreshToken}`
    if (this.authClient?.key !== key) {
      const client = createAuthorizedClient({
        clientId,
        clientSecret,
        refreshToken,
        onRefreshToken: (token) => {
          this.store.update((c) => {
            c.google.refreshToken = token
          })
          this.authClient = { key: `${clientId}|${token}`, client }
        },
      })
      this.authClient = { key, client }
    }
    return this.authClient.client
  }

  async connectGoogle(openUrl: (url: string) => Promise<void>): Promise<void> {
    const config = this.store.get()
    const { clientId, clientSecret } = this.credentials(config)
    if (!clientId) throw new Error('Configure a Google OAuth client first (see the setup guide)')
    this.connectAbort?.abort()
    this.connectAbort = new AbortController()
    try {
      const result = await authorizeInteractive({
        clientId,
        clientSecret,
        scopes: scopesFor(config.google.scopeMode),
        openUrl,
        signal: this.connectAbort.signal,
      })
      this.store.update((c) => {
        const switchedAccount = c.google.accountEmail && result.email && c.google.accountEmail !== result.email
        c.google.refreshToken = result.refreshToken
        c.google.accountEmail = result.email
        if (switchedAccount) {
          c.target.calendarId = undefined
          c.target.calendarName = undefined
        }
      })
      this.logger.info(`Connected Google account ${result.email ?? ''}`.trim())
    } finally {
      this.connectAbort = undefined
      this.configChanged()
    }
  }

  cancelConnect(): void {
    this.connectAbort?.abort()
  }

  async disconnectGoogle(): Promise<void> {
    const config = this.store.get()
    const token = config.google.refreshToken
    this.store.update((c) => {
      c.google.refreshToken = undefined
      c.google.accountEmail = undefined
    })
    this.authClient = undefined
    if (token) {
      const { clientId, clientSecret } = this.credentials(config)
      if (clientId) await revokeRefreshToken({ clientId, clientSecret }, token)
    }
    this.logger.info('Disconnected Google account')
    this.configChanged()
  }

  /** Drops the cached auth client, e.g. after the OAuth client changed. */
  resetAuth(): void {
    this.authClient = undefined
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    try {
      return await new GoogleCalendarApi(this.google(this.store.get())).listCalendars()
    } catch (err) {
      throw new Error(describeGoogleError(err), { cause: err })
    }
  }

  async createCalendar(name: string): Promise<void> {
    const config = this.store.get()
    try {
      const cal = await new GoogleCalendarApi(this.google(config)).createCalendar(name, effectiveTimeZone(config))
      this.store.update((c) => {
        c.target.calendarId = cal.id
        c.target.calendarName = cal.summary
      })
      this.logger.info(`Created target calendar "${cal.summary}"`)
    } catch (err) {
      throw new Error(describeGoogleError(err), { cause: err })
    }
    this.configChanged()
  }

  async selectCalendar(id: string): Promise<void> {
    const config = this.store.get()
    let name = id
    try {
      name = (await new GoogleCalendarApi(this.google(config)).getCalendar(id)).summary
    } catch (err) {
      throw new Error(describeGoogleError(err), { cause: err })
    }
    this.store.update((c) => {
      c.target.calendarId = id
      c.target.calendarName = name
    })
    this.logger.info(`Target calendar set to "${name}"`)
    this.configChanged()
  }

  // ---- Status ---------------------------------------------------------------

  private setStatus(patch: Partial<StatusInfo>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.getStatus())
  }

  private refreshStatus(): void {
    const config = this.store.get()
    const setupIssues = this.setupIssues(config)
    if (this.status.state === 'syncing') {
      this.setStatus({ setupIssues })
    } else if (setupIssues.length) {
      this.setStatus({ setupIssues, state: 'unconfigured', message: setupIssues[0] })
    } else if (!config.sync.autoSync) {
      this.setStatus({ setupIssues, state: 'paused', message: 'Automatic sync is paused' })
    } else if (this.status.state === 'unconfigured' || this.status.state === 'paused') {
      this.setStatus({ setupIssues, state: 'idle', message: this.status.lastSyncAt ? 'Ready' : 'Waiting for first sync' })
    } else {
      this.setStatus({ setupIssues })
    }
  }
}
