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

  // Accumulate PTY output to detect patterns across chunked data
  let outputBuffer = ''
  let trustAccepted = false

  ptyManager.setDataInterceptor(ptyId, (data) => {
    if (win.isDestroyed()) return

    // Strip ANSI escapes for pattern matching
    const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z?h-l]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/[\x1b]/g, '')
    outputBuffer += clean
    const lower = outputBuffer.toLowerCase()

    // Trust dialog detection — this is a numbered menu:
    //   ❯ 1. Yes, I trust this folder
    //     2. No, exit
    //   Enter to confirm
    // Auto-press Enter to accept option 1 (already selected).
    if (!trustDetected && !trustAccepted && lower.includes('trust this folder')) {
      trustDetected = true
      // Wait a moment for the menu to fully render, then press Enter
      setTimeout(() => {
        trustAccepted = true
        ptyManager.writeToPty(ptyId, '\r')
      }, 800)
      return // Don't check for prompt yet — trust dialog is still showing
    }

    // Don't detect the ready prompt until trust dialog is handled
    if (trustDetected && !trustAccepted) return

    // Detect Claude ready prompt — the Cost: status line is the most reliable
    // signal that Claude Code is fully initialized and ready for input.
    // Don't trigger on ❯ alone since that's also used in the trust menu.
    if (!promptInjected && outputBuffer.includes('Cost:')) {
      injectPrompt()
    }
  })
}
