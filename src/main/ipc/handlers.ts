import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { IPC_CHANNELS } from './channels'
import { discoverSessionsAsync, getCachedSessions } from '../services/session-discovery'
import { readCredentials, readSettings } from '../services/settings-reader'
import { fetchUsageData } from '../services/usage-fetcher'
import { SessionMonitor } from '../services/session-monitor'
import { parseSessionJsonl } from '../services/jsonl-parser'
import { PROJECTS_DIR } from '@shared/constants/paths'
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

// Track completion counts per JSONL file to detect new completions (direct path from monitor)
const directCompletionCounts = new Map<string, number>()

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

  monitor.on('session:updated', (update: SessionUpdate) => {
    scheduleBroadcast()

    // Direct completion detection — bypasses broadcast throttle and discovery cache.
    // The monitor already parsed the JSONL and has the completionCount + stopReason.
    const fileKey = `${update.projectPath}:${update.sessionId}`
    const count = update.parsed.completionCount || 0
    const stopReason = update.parsed.stopReason
    const hasPrevious = directCompletionCounts.has(fileKey)
    const prevCount = directCompletionCounts.get(fileKey) || 0

    const ptySessions = ptyManager.getByEncodedCwd(update.projectEncoded)

    if (count > prevCount && hasPrevious) {
      // end_turn completion detected — Claude is done, fire bell + clear spinner
      for (const ps of ptySessions) {
        ptyManager.fireBell(ps.pid)
        ptyManager.clearThinking(ps.pid)
      }
    } else if (stopReason === 'tool_use') {
      // Claude is executing a tool — re-arm spinner if idle timeout cleared it
      for (const ps of ptySessions) {
        ptyManager.rearmThinking(ps.pid)
      }
    }
    directCompletionCounts.set(fileKey, count)
  })

  monitor.start()
  startBellPolling()
}

// ─── Fallback bell polling ───
// Checks every 30s for completions that the file watcher may have missed.
const POLL_INTERVAL_MS = 30_000
let pollTimer: ReturnType<typeof setInterval> | null = null
const pollCompletionCounts = new Map<string, number>()

function startBellPolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    const ptySessions = ptyManager.getAllSessions()
    if (ptySessions.length === 0) return

    for (const session of ptySessions) {
      // Find the JSONL files for this PTY by scanning the encoded CWD dir
      const encoded = session.cwd.replace(/\//g, '-')
      const projectDir = path.join(PROJECTS_DIR, encoded)
      if (!fs.existsSync(projectDir)) continue

      try {
        const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'))
        for (const file of files) {
          const filePath = path.join(projectDir, file)
          const fileKey = `poll:${encoded}:${file}`
          const parsed = parseSessionJsonl(filePath)
          const count = parsed.completionCount || 0
          const prevCount = pollCompletionCounts.get(fileKey) || 0

          if (count > prevCount && pollCompletionCounts.has(fileKey)) {
            // end_turn completion detected by poll — fire bell if the watcher didn't already
            ptyManager.fireBell(session.pid)
            ptyManager.clearThinking(session.pid)
          } else if (parsed.stopReason === 'tool_use') {
            // Claude is executing a tool — re-arm spinner
            ptyManager.rearmThinking(session.pid)
          }
          pollCompletionCounts.set(fileKey, count)
        }
      } catch { /* ignore read errors */ }
    }
  }, POLL_INTERVAL_MS)
}

function stopBellPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  pollCompletionCounts.clear()
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
  stopBellPolling()
}
