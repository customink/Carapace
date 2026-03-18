import { BrowserWindow, app } from 'electron'
import { loadSchedules } from './schedule-store'
import { loadPresets } from './preset-store'
import { spawnClaudeSession } from './session-spawner'
import * as ptyManager from './pty-manager'
import type { ScheduledPrompt } from '@shared/types/scheduled-prompt'

const SCHEDULER_INTERVAL_MS = 60_000
const MAX_WAIT_MS = 30_000 // max time to wait for Claude prompt to appear

let intervalId: ReturnType<typeof setInterval> | null = null
const firedToday = new Map<string, string>()

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export function startScheduler(): void {
  if (intervalId) return
  intervalId = setInterval(checkSchedules, SCHEDULER_INTERVAL_MS)
}

export function stopScheduler(): void {
  if (intervalId) { clearInterval(intervalId); intervalId = null }
}

function checkSchedules(): void {
  const now = new Date()
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const today = todayKey()

  // Clear yesterday's entries
  for (const [id, dateStr] of firedToday) {
    if (dateStr !== today) firedToday.delete(id)
  }

  const schedules = loadSchedules()
  for (const schedule of schedules) {
    if (!schedule.enabled) continue
    if (firedToday.get(schedule.id) === today) continue
    if (schedule.hour !== currentHour) continue
    if ((schedule.minute || 0) !== currentMinute) continue

    firedToday.set(schedule.id, today)
    fireSchedule(schedule)
  }
}

export function fireSchedule(schedule: ScheduledPrompt): void {
  let bypass = false
  let color: string | undefined
  let title = schedule.name
  let shellTabNames: string[] | undefined

  if (schedule.presetId) {
    const presets = loadPresets()
    const preset = presets.find(p => p.id === schedule.presetId)
    if (preset) {
      bypass = preset.bypass
      color = preset.color || undefined
      title = preset.title || schedule.name
      if (preset.shellTab) {
        const count = Math.max(1, preset.shellTabCount)
        shellTabNames = []
        for (let i = 0; i < count; i++) shellTabNames.push(preset.shellTabNames[i] || '')
      }
    }
  }

  // Spawn in background
  const { ptyId, win } = spawnClaudeSession(
    bypass, title, schedule.cwd || undefined, color,
    !!(shellTabNames && shellTabNames.length > 0),
    undefined, undefined, shellTabNames,
    true // background
  )

  // Show dock since we have a terminal now
  app.dock?.show()

  // Watch PTY output to detect trust dialog and Claude ready prompt
  let trustDetected = false
  let promptInjected = false

  const maxTimer = setTimeout(() => {
    // Safety net: inject prompt after max wait even if we didn't detect the prompt
    if (!promptInjected) injectPrompt()
  }, MAX_WAIT_MS)

  function injectPrompt() {
    if (promptInjected) return
    promptInjected = true
    clearTimeout(maxTimer)
    ptyManager.setDataInterceptor(ptyId, null)
    if (win.isDestroyed()) return

    // Small delay after detecting prompt to let Claude fully render
    setTimeout(() => {
      if (win.isDestroyed()) return
      ptyManager.writeToPty(ptyId, schedule.prompt + '\r')
      const session = ptyManager.getByPtyId(ptyId)
      if (session) session.scheduledBringToFront = true
    }, 500)
  }

  ptyManager.setDataInterceptor(ptyId, (data) => {
    if (win.isDestroyed()) return

    const lower = data.toLowerCase()

    // Trust dialog detection — auto-accept so scheduled prompts aren't blocked
    if (!trustDetected && (lower.includes('trust') || lower.includes('(y/n)') || lower.includes('yes, proceed'))) {
      trustDetected = true
      // Auto-press Enter to accept trust dialog
      setTimeout(() => {
        ptyManager.writeToPty(ptyId, '\r')
      }, 300)
    }

    // Detect Claude ready prompt (❯ or > at start of line)
    // The prompt character appears after Claude Code finishes initializing
    const stripped = data.replace(/\x1b\[[0-9;]*[a-zA-Z?h-l]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
    if (!promptInjected && (stripped.includes('❯') || stripped.includes('›') || /^\s*> /m.test(stripped))) {
      injectPrompt()
    }
  })
}
