import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import { IPC_CHANNELS } from './channels'
import { discoverSessionsAsync, getCachedSessions } from '../services/session-discovery'
import { readCredentials, readSettings } from '../services/settings-reader'
import { fetchUsageData } from '../services/usage-fetcher'
import { SessionMonitor } from '../services/session-monitor'
import { parseSessionJsonl } from '../services/jsonl-parser'
import { computeDetailedCost } from '../services/cost-calculator'
import { PROJECTS_DIR } from '@shared/constants/paths'
import { formatModelName } from '@shared/utils/format'
import * as ptyManager from '../services/pty-manager'
import { updateHistoryEntry } from '../services/session-history'
import { loadDailyTokens, recordSessionData, getDailyTokens, getDailySessionBreakdown } from '../services/daily-tokens-store'
import type { SessionUpdate } from '../services/session-monitor'
import type { SessionState } from '@shared/types/session'

const HISTORY_FILE = path.join(homedir(), '.claude', 'usage-data', 'carapace-session-history.json')

// Build a lookup map from claudeSessionId → { title, color, folder } from session history.
// Used to enrich the daily breakdown for sessions that have already ended.
function buildHistoryMap(): Map<string, { title: string; color: string; folder: string }> {
  const map = new Map<string, { title: string; color: string; folder: string }>()
  try {
    const entries = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')) as Array<{
      claudeSessionId?: string; title?: string; color?: string; folder?: string
    }>
    for (const e of entries) {
      if (e.claudeSessionId && !map.has(e.claudeSessionId)) {
        map.set(e.claudeSessionId, {
          title: e.title || '',
          color: e.color || '',
          folder: e.folder || '',
        })
      }
    }
  } catch { /* ignore */ }
  return map
}

/** Locate a session's JSONL file by sessionId, using projectPath hint if available. */
function findSessionJsonl(sessionId: string, projectPath?: string): string | undefined {
  if (projectPath) {
    const encoded = projectPath.replace(/\//g, '-')
    const candidate = path.join(PROJECTS_DIR, encoded, `${sessionId}.jsonl`)
    if (fs.existsSync(candidate)) return candidate
  }
  // Fallback: scan all project dirs
  try {
    for (const dir of fs.readdirSync(PROJECTS_DIR)) {
      const candidate = path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`)
      if (fs.existsSync(candidate)) return candidate
    }
  } catch { /* ignore */ }
  return undefined
}

function enrichedBreakdown() {
  const raw = getDailySessionBreakdown()
  const hist = buildHistoryMap()

  return raw.map(e => {
    const h = hist.get(e.sessionId)

    // Name priority: PTY title (live) → history title → history folder → project folder
    const name = e.name
      || h?.title
      || (h?.folder ? h.folder.split('/').filter(Boolean).pop() : undefined)
      || (e.projectPath ? e.projectPath.split('/').filter(Boolean).pop() : undefined)
      || undefined

    // Color priority: PTY color (live) → history color
    const color = e.color || h?.color || undefined

    // If model or cost is missing, look them up from the JSONL transcript
    let { model, cost } = e
    if (!model || cost === 0) {
      try {
        const jsonlPath = findSessionJsonl(e.sessionId, e.projectPath || h?.folder)
        if (jsonlPath) {
          const parsed = parseSessionJsonl(jsonlPath)
          if (!model && parsed.model) model = parsed.model
          if (cost === 0 && parsed.metrics.totalTokens > 0) {
            cost = computeDetailedCost(
              parsed.metrics.inputTokens,
              parsed.metrics.outputTokens,
              0,
              parsed.metrics.cachedTokens,
              parsed.model,
            )
          }
        }
      } catch { /* ignore */ }
    }

    return { ...e, name, color, model, cost }
  })
}

let monitor: SessionMonitor | null = null

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SESSIONS_LIST, async () => {
    return await discoverSessionsAsync()
  })

  ipcMain.handle('daily-tokens:get', () => getDailyTokens())
  ipcMain.handle('daily-tokens:get-breakdown', () => enrichedBreakdown())

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

  loadDailyTokens()
  monitor = new SessionMonitor()

  monitor.on('session:updated', (update: SessionUpdate) => {
    // Accumulate daily tokens in the persistent store.
    // Uses the MAX ever seen for this session so /clear (which resets the JSONL)
    // doesn't erase tokens that were already consumed.
    const total = update.parsed.metrics.totalTokens
    if (update.sessionId && total > 0) {
      // Resolve color + name from any PTY session in the same project dir
      const ptySess = ptyManager.getByEncodedCwd(update.projectEncoded)
      const matchedPty = ptySess.find(p => p.claudeSessionId === update.sessionId) || ptySess[0]
      const color = matchedPty?.color
      const name = matchedPty?.title || undefined

      const changed = recordSessionData(update.sessionId, total, update.cost, update.parsed.model, color, name, update.projectPath)
      if (changed) {
        // Push updated daily total + enriched per-session breakdown to all windows immediately
        const daily = getDailyTokens()
        const breakdown = enrichedBreakdown()
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('daily-tokens:updated', daily)
            win.webContents.send('daily-tokens:breakdown-updated', breakdown)
          }
        }
      }
    }

    scheduleBroadcast()

    // Direct completion detection — bypasses broadcast throttle and discovery cache.
    // The monitor already parsed the JSONL and has the completionCount + stopReason.
    const fileKey = `${update.projectPath}:${update.sessionId}`
    const count = update.parsed.completionCount || 0
    const stopReason = update.parsed.stopReason
    const hasPrevious = directCompletionCounts.has(fileKey)
    const prevCount = directCompletionCounts.get(fileKey) || 0

    const ptySessions = ptyManager.getByEncodedCwd(update.projectEncoded)

    // Track the Claude Code session ID for conversation resume.
    // Save to history immediately so it persists even if the app crashes or
    // the session is closed via context menu (bypassing the window close handler).
    for (const ps of ptySessions) {
      if (!ps.claudeSessionId && update.sessionId) {
        ps.claudeSessionId = update.sessionId
        updateHistoryEntry(ps.ptyId, { claudeSessionId: update.sessionId })
      }
    }

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
// 30s safety net for completions that hooks and the file watcher may have both missed.
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
