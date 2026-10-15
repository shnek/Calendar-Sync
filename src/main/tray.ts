import { readFileSync } from 'node:fs'
import { Menu, Tray, nativeImage, type NativeImage } from 'electron'
import trayIcon from '../../resources/tray.png?asset'
import trayIcon2x from '../../resources/tray@2x.png?asset'
import trayErrorIcon from '../../resources/tray-error.png?asset'
import trayErrorIcon2x from '../../resources/tray-error@2x.png?asset'
import trayTemplate from '../../resources/trayTemplate.png?asset'
import trayTemplate2x from '../../resources/trayTemplate@2x.png?asset'
import type { StatusInfo } from '../shared/ipc'

function image(path1x: string, path2x: string, template = false): NativeImage {
  const img = nativeImage.createEmpty()
  img.addRepresentation({ scaleFactor: 1, buffer: readFileSync(path1x) })
  img.addRepresentation({ scaleFactor: 2, buffer: readFileSync(path2x) })
  if (template) img.setTemplateImage(true)
  return img
}

export interface TrayActions {
  syncNow(): void
  toggleAutoSync(): void
  openSettings(page?: string): void
  toggleLaunchAtLogin(): void
  checkForUpdates(): void
  quit(): void
  isAutoSync(): boolean
  isLaunchAtLogin(): boolean
  canUpdate(): boolean
}

const isMac = process.platform === 'darwin'

function relative(iso: string | undefined): string {
  if (!iso) return 'never'
  const diff = Date.now() - Date.parse(iso)
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`
  return new Date(iso).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
}

export class AppTray {
  private readonly tray: Tray
  private readonly icons = isMac
    ? { normal: image(trayTemplate, trayTemplate2x, true), error: image(trayTemplate, trayTemplate2x, true) }
    : { normal: image(trayIcon, trayIcon2x), error: image(trayErrorIcon, trayErrorIcon2x) }
  private status: StatusInfo | undefined

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(this.icons.normal)
    this.tray.setToolTip('Calendar Sync')
    // On Windows a left click opens the window; the menu is on right click.
    if (!isMac) this.tray.on('click', () => actions.openSettings())
    this.render()
  }

  update(status: StatusInfo): void {
    this.status = status
    this.render()
  }

  destroy(): void {
    this.tray.destroy()
  }

  private render(): void {
    const s = this.status
    const failing = s?.state === 'error' || s?.state === 'unconfigured'
    this.tray.setImage(failing ? this.icons.error : this.icons.normal)
    if (isMac) this.tray.setTitle(failing ? '!' : '')
    const statusLine = s ? (s.state === 'syncing' ? 'Syncing…' : s.message) : 'Starting…'
    this.tray.setToolTip(`Calendar Sync - ${statusLine}`)

    const a = this.actions
    const menu = Menu.buildFromTemplate([
      { label: statusLine.length > 60 ? `${statusLine.slice(0, 57)}…` : statusLine, enabled: false },
      { label: `Last sync: ${relative(s?.lastSuccessAt)}`, enabled: false },
      { type: 'separator' },
      { label: 'Sync now', enabled: s?.state !== 'syncing' && !s?.setupIssues.length, click: () => a.syncNow() },
      { label: 'Automatic sync', type: 'checkbox', checked: a.isAutoSync(), click: () => a.toggleAutoSync() },
      { type: 'separator' },
      { label: s?.setupIssues.length ? 'Finish setup…' : 'Settings…', click: () => a.openSettings() },
      { label: 'Preview events…', click: () => a.openSettings('preview') },
      { label: 'Activity…', click: () => a.openSettings('activity') },
      { type: 'separator' },
      { label: 'Launch at login', type: 'checkbox', checked: a.isLaunchAtLogin(), click: () => a.toggleLaunchAtLogin() },
      ...(a.canUpdate() ? [{ label: 'Check for updates', click: () => a.checkForUpdates() }] : []),
      { label: `Version ${s?.version ?? ''}`, enabled: false },
      { type: 'separator' },
      { label: 'Quit Calendar Sync', click: () => a.quit() },
    ])
    this.tray.setContextMenu(menu)
  }
}
