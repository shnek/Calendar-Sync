import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { Logger } from './logger'

// Resolved lazily: touching electronUpdater.autoUpdater instantiates the updater.
const autoUpdater = () => electronUpdater.autoUpdater
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Auto-update from GitHub Releases. Works for the Windows installer; macOS
 * requires a signed build, so failures there are logged and otherwise ignored.
 */
export class Updater {
  private timer: NodeJS.Timeout | undefined
  private wired = false

  constructor(private readonly logger: Logger) {}

  get available(): boolean {
    // app-update.yml is only generated for builds published to GitHub Releases.
    return app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))
  }

  setEnabled(enabled: boolean): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (!enabled || !this.available) return
    this.wire()
    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
  }

  async check(): Promise<string> {
    if (!this.available) return 'Automatic updates are only available in release builds from GitHub.'
    this.wire()
    try {
      const result = await autoUpdater().checkForUpdatesAndNotify()
      const version = result?.updateInfo?.version
      if (version && version !== app.getVersion()) return `Version ${version} is downloading and will install on quit.`
      return 'You are on the latest version.'
    } catch (err) {
      const message = (err as Error)?.message ?? String(err)
      this.logger.warn(`Update check failed: ${message.split('\n')[0]}`)
      return 'Could not check for updates (see Activity log).'
    }
  }

  private wire(): void {
    if (this.wired) return
    this.wired = true
    const updater = autoUpdater()
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.on('update-downloaded', (info) => this.logger.info(`Update ${info.version} downloaded; installs on quit`))
    updater.on('error', (err) => this.logger.warn(`Updater: ${err?.message?.split('\n')[0]}`))
  }
}
