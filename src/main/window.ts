import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import icon from '../../resources/icon.png?asset'

let win: BrowserWindow | undefined
let quitting = false

export function markQuitting(): void {
  quitting = true
}

export function getWindow(): BrowserWindow | undefined {
  return win && !win.isDestroyed() ? win : undefined
}

/** Shows the settings window (creating it on demand), optionally on a given page. */
export function showWindow(page?: string): BrowserWindow {
  const existing = getWindow()
  if (existing) {
    if (page) existing.webContents.send('navigate', page)
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }

  win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'Calendar Sync',
    icon,
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win?.show())
  // Keep running in the tray when the window is closed.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = undefined
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })

  const hash = page ? `#${page}` : ''
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: page })
  }
  return win
}
