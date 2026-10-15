import { BrowserWindow, ipcMain, shell } from 'electron'
import type { AppConfig } from '../core/types'
import { IPC, type ConfigPatch, type PublicConfig } from '../shared/ipc'
import type { ConfigStore } from './config-store'
import type { Logger } from './logger'
import type { SyncService } from './sync-service'
import type { Updater } from './updater'

export interface IpcDeps {
  store: ConfigStore
  service: SyncService
  logger: Logger
  updater: Updater
  builtInClientAvailable: boolean
  applyAppSettings(config: AppConfig): void
}

export function toPublicConfig(config: AppConfig, builtInClientAvailable: boolean): PublicConfig {
  const { clientId, clientSecret, refreshToken, accountEmail, scopeMode } = config.google
  return {
    ...config,
    google: {
      clientId,
      hasClientSecret: Boolean(clientSecret),
      builtInClientAvailable,
      connected: Boolean(refreshToken),
      accountEmail,
      scopeMode,
    },
  }
}

function applyPatch(config: AppConfig, patch: ConfigPatch): { config: AppConfig; authChanged: boolean } {
  let authChanged = false
  if (patch.sources) config.sources = patch.sources
  if (patch.rules) config.rules = patch.rules
  if (patch.target) config.target = { ...config.target, ...patch.target }
  if (patch.sync) config.sync = { ...config.sync, ...patch.sync }
  if (patch.app) config.app = { ...config.app, ...patch.app }
  if (patch.google) {
    const g = patch.google
    const clientId = g.clientId !== undefined ? g.clientId.trim() || undefined : config.google.clientId
    const scopeMode = g.scopeMode ?? config.google.scopeMode
    authChanged = clientId !== config.google.clientId || scopeMode !== config.google.scopeMode
    config.google.clientId = clientId
    config.google.scopeMode = scopeMode
    // An empty secret in the patch means "keep the stored one"; clearing the id clears it.
    if (g.clientSecret) config.google.clientSecret = g.clientSecret.trim()
    if (!clientId) config.google.clientSecret = undefined
    if (authChanged) {
      // Tokens are bound to the OAuth client and the granted scopes.
      config.google.refreshToken = undefined
      config.google.accountEmail = undefined
    }
  }
  return { config, authChanged }
}

/** Accept URLs only for the hosts we link to from the UI. */
function isAllowedExternal(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:'
  } catch {
    return false
  }
}

export function registerIpc(deps: IpcDeps): void {
  const { store, service, logger, updater } = deps
  const pub = () => toPublicConfig(store.get(), deps.builtInClientAvailable)

  ipcMain.handle(IPC.getConfig, () => pub())
  ipcMain.handle(IPC.updateConfig, (_e, patch: ConfigPatch) => {
    let authChanged = false
    const next = store.update((c) => {
      const result = applyPatch(c, patch)
      authChanged = result.authChanged
      return result.config
    })
    if (authChanged) service.resetAuth()
    if (patch.app) deps.applyAppSettings(next)
    service.configChanged()
    return pub()
  })
  ipcMain.handle(IPC.getStatus, () => service.getStatus())
  ipcMain.handle(IPC.syncNow, () => service.syncNow('manual'))
  ipcMain.handle(IPC.preview, () => service.preview())
  ipcMain.handle(IPC.testSource, (_e, url: string, ownerEmail?: string) => service.testSource(url, ownerEmail))
  ipcMain.handle(IPC.getReports, () => service.getReports())
  ipcMain.handle(IPC.getLog, () => logger.recent())
  ipcMain.handle(IPC.connectGoogle, async () => {
    await service.connectGoogle((url) => shell.openExternal(url))
    return pub()
  })
  ipcMain.handle(IPC.cancelConnectGoogle, () => service.cancelConnect())
  ipcMain.handle(IPC.disconnectGoogle, async () => {
    await service.disconnectGoogle()
    return pub()
  })
  ipcMain.handle(IPC.listCalendars, () => service.listCalendars())
  ipcMain.handle(IPC.createCalendar, async (_e, name: string) => {
    await service.createCalendar(name)
    return pub()
  })
  ipcMain.handle(IPC.selectCalendar, async (_e, id: string) => {
    await service.selectCalendar(id)
    return pub()
  })
  ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
    if (isAllowedExternal(url)) await shell.openExternal(url)
  })
  ipcMain.handle(IPC.openLogFolder, async () => {
    await shell.openPath(logger.dir)
  })
  ipcMain.handle(IPC.checkForUpdates, () => updater.check())

  service.on('status', (status) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.status, status)
  })
}
