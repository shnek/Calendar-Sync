import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type RendererApi, type StatusInfo } from '../shared/ipc'

const api: RendererApi = {
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  updateConfig: (patch) => ipcRenderer.invoke(IPC.updateConfig, patch),
  getStatus: () => ipcRenderer.invoke(IPC.getStatus),
  onStatus: (listener) => {
    const handler = (_e: unknown, status: StatusInfo) => listener(status)
    ipcRenderer.on(IPC.status, handler)
    return () => ipcRenderer.removeListener(IPC.status, handler)
  },
  syncNow: () => ipcRenderer.invoke(IPC.syncNow),
  preview: () => ipcRenderer.invoke(IPC.preview),
  testSource: (url, ownerEmail) => ipcRenderer.invoke(IPC.testSource, url, ownerEmail),
  getReports: () => ipcRenderer.invoke(IPC.getReports),
  getLog: () => ipcRenderer.invoke(IPC.getLog),
  connectGoogle: () => ipcRenderer.invoke(IPC.connectGoogle),
  cancelConnectGoogle: () => ipcRenderer.invoke(IPC.cancelConnectGoogle),
  disconnectGoogle: () => ipcRenderer.invoke(IPC.disconnectGoogle),
  listCalendars: () => ipcRenderer.invoke(IPC.listCalendars),
  createCalendar: (name) => ipcRenderer.invoke(IPC.createCalendar, name),
  selectCalendar: (id) => ipcRenderer.invoke(IPC.selectCalendar, id),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  openLogFolder: () => ipcRenderer.invoke(IPC.openLogFolder),
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('platform', process.platform)
contextBridge.exposeInMainWorld('onNavigate', (listener: (page: string) => void) => {
  ipcRenderer.on('navigate', (_e, page: string) => listener(page))
})
