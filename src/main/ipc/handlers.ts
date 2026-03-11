import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from './channels'
import { discoverSessions } from '../services/session-discovery'
import { readCredentials, readSettings } from '../services/settings-reader'
import { fetchUsageData } from '../services/usage-fetcher'
import { SessionMonitor } from '../services/session-monitor'
import type { SessionUpdate } from '../services/session-monitor'

let monitor: SessionMonitor | null = null

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SESSIONS_LIST, () => {
    return discoverSessions()
  })

  ipcMain.handle(IPC_CHANNELS.CREDENTIALS_GET, () => {
    return readCredentials()
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return readSettings()
  })

  ipcMain.handle(IPC_CHANNELS.USAGE_GET, async () => {
    return await fetchUsageData()
  })
}

export function startSessionMonitor(): void {
  if (monitor) return

  monitor = new SessionMonitor()

  monitor.on('session:updated', (update: SessionUpdate) => {
    // Broadcast to all renderer windows
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send(IPC_CHANNELS.SESSIONS_UPDATED, discoverSessions())
    }
  })

  monitor.start()
}

export function stopSessionMonitor(): void {
  if (monitor) {
    monitor.stop()
    monitor = null
  }
}
