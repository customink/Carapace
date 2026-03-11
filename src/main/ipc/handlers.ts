import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from './channels'
import { discoverSessionsAsync, getCachedSessions } from '../services/session-discovery'
import { readCredentials, readSettings } from '../services/settings-reader'
import { fetchUsageData } from '../services/usage-fetcher'
import { SessionMonitor } from '../services/session-monitor'
import { formatModelName } from '@shared/utils/format'
import * as ptyManager from '../services/pty-manager'
import type { SessionUpdate } from '../services/session-monitor'
import type { SessionState } from '@shared/types/session'

let monitor: SessionMonitor | null = null

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SESSIONS_LIST, async () => {
    return await discoverSessionsAsync()
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

// ─── Throttled broadcast ───
let broadcastTimer: ReturnType<typeof setTimeout> | null = null
let broadcastPending = false
const BROADCAST_THROTTLE_MS = 1500

// Track completion counts per session to detect new completions
const previousCompletionCounts = new Map<string, number>()

function scheduleBroadcast(): void {
  broadcastPending = true
  if (broadcastTimer) return // already scheduled
  broadcastTimer = setTimeout(async () => {
    broadcastTimer = null
    if (!broadcastPending) return
    broadcastPending = false

    const allSessions = await discoverSessionsAsync()
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SESSIONS_UPDATED, allSessions)
      }
    }

    // Detect new completions and fire bell / clear thinking
    for (const session of allSessions) {
      if (session.status !== 'active' || !session.managed || !session.pid) continue

      const count = session.completionCount || 0
      const hasPrevious = previousCompletionCounts.has(session.id)
      const prevCount = previousCompletionCounts.get(session.id) || 0

      if (count > prevCount && hasPrevious) {
        // New completion detected — fire bell and clear thinking
        ptyManager.fireBell(session.pid)
        ptyManager.clearThinking(session.pid)
      }
      previousCompletionCounts.set(session.id, count)
    }

    // Update terminal window titles with model info when detected
    for (const session of allSessions) {
      if (session.status !== 'active' || !session.managed) continue
      if (!session.model) continue

      const modelDisplay = formatModelName(session.model)
      const ptySess = session.pid ? ptyManager.getByPid(session.pid) : undefined
      if (!ptySess) continue

      const termWin = BrowserWindow.fromId(ptySess.windowId)
      if (!termWin || termWin.isDestroyed()) continue

      const currentTitle = termWin.getTitle()
      if (currentTitle.includes(modelDisplay)) continue

      // Append model: "Title" → "Title - Opus 4.6"
      const baseTitle = ptySess.title || 'Claude Code'
      const newTitle = `${baseTitle} - ${modelDisplay}`
      termWin.setTitle(newTitle)
      termWin.webContents.send(IPC_CHANNELS.TERMINAL_TITLE_UPDATED, newTitle)
    }
  }, BROADCAST_THROTTLE_MS)
}

export function startSessionMonitor(): void {
  if (monitor) return

  monitor = new SessionMonitor()

  monitor.on('session:updated', (_update: SessionUpdate) => {
    scheduleBroadcast()
  })

  monitor.start()
}

export function stopSessionMonitor(): void {
  if (monitor) {
    monitor.stop()
    monitor = null
  }
  if (broadcastTimer) {
    clearTimeout(broadcastTimer)
    broadcastTimer = null
  }
}
