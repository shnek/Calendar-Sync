import { join } from 'node:path'
import { Notification, app, powerMonitor } from 'electron'
import type { AppConfig } from '../core/types'
import { ConfigStore } from './config-store'
import { registerIpc } from './ipc'
import { Logger } from './logger'
import { SyncService } from './sync-service'
import { AppTray } from './tray'
import { Updater } from './updater'
import { markQuitting, showWindow } from './window'

// Optional OAuth client baked in at build time (CI secrets). Desktop OAuth
// secrets are not confidential by design - see docs/SETUP.md.
const builtInClient = {
  clientId: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID || undefined,
  clientSecret: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET || undefined,
}

// The app was renamed from "Calendar Sync" to "Silhouette". Electron derives
// the settings folder and the macOS keychain entry that encrypts secrets
// ("<name> Safe Storage") from the app name, so pin both to the old name -
// otherwise existing installs lose their feeds and Google sign-in. Must run
// before anything touches userData, including the single-instance lock.
const LEGACY_APP_NAME = 'Calendar Sync'
app.setName(LEGACY_APP_NAME)
app.setPath('userData', join(app.getPath('appData'), LEGACY_APP_NAME))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId('io.github.calendarsync')
  app.on('second-instance', () => showWindow())
  app.on('activate', () => showWindow())
  // Tray-only app: never quit because the window closed.
  app.on('window-all-closed', () => {})
  void app.whenReady().then(start)
}

function start(): void {
  if (process.platform === 'darwin') app.dock?.hide()

  const logger = new Logger(join(app.getPath('userData'), 'logs'))
  const store = new ConfigStore(join(app.getPath('userData'), 'config.json'))
  const service = new SyncService(store, logger, builtInClient, app.getVersion())
  const updater = new Updater(logger)
  logger.info(`Silhouette ${app.getVersion()} starting`)

  const applyAppSettings = (config: AppConfig) => {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: config.app.launchAtLogin, args: ['--hidden'] })
    }
    updater.setEnabled(config.app.autoUpdate)
    tray?.update(service.getStatus())
  }

  let tray: AppTray | undefined
  tray = new AppTray({
    syncNow: () => void service.syncNow('manual'),
    toggleAutoSync: () => {
      store.update((c) => {
        c.sync.autoSync = !c.sync.autoSync
      })
      service.configChanged()
    },
    openSettings: (page) => showWindow(page),
    toggleLaunchAtLogin: () => {
      applyAppSettings(
        store.update((c) => {
          c.app.launchAtLogin = !c.app.launchAtLogin
        }),
      )
    },
    checkForUpdates: () => void updater.check().then((msg) => new Notification({ title: 'Silhouette', body: msg }).show()),
    quit: () => app.quit(),
    isAutoSync: () => store.get().sync.autoSync,
    isLaunchAtLogin: () => store.get().app.launchAtLogin,
    canUpdate: () => updater.available,
  })

  registerIpc({ store, service, logger, updater, builtInClientAvailable: Boolean(builtInClient.clientId), applyAppSettings })

  service.on('status', (status) => tray?.update(status))
  service.on('failure', (message: string) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: 'Silhouette needs attention', body: message })
    n.on('click', () => showWindow('activity'))
    n.show()
  })

  // Catch up after sleep and when the network returns.
  powerMonitor.on('resume', () => setTimeout(() => void service.syncNow('resume'), 15_000))
  powerMonitor.on('unlock-screen', () => setTimeout(() => void service.syncNow('unlock'), 5_000))

  app.on('before-quit', () => {
    markQuitting()
    service.stop()
    tray?.destroy()
    tray = undefined
  })

  applyAppSettings(store.get())
  service.start()

  const launchedHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin
  if (service.setupIssues().length || !launchedHidden) showWindow()
}
