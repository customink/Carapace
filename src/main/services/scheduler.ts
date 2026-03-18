import { BrowserWindow, app } from 'electron'
import { loadSchedules } from './schedule-store'
import { loadPresets } from './preset-store'
import { spawnClaudeSession } from './session-spawner'
import * as ptyManager from './pty-manager'
import type { ScheduledPrompt } from '@shared/types/scheduled-prompt'

const SCHEDULER_INTERVAL_MS = 60_000
const PROMPT_DELAY_MS = 11_000 // 8s startup grace + 3s buffer

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

  // Detect trust dialog during startup — bring to front immediately
  let trustDetected = false
  ptyManager.setDataInterceptor(ptyId, (data) => {
    const lower = data.toLowerCase()
    if (!trustDetected && (lower.includes('trust') || lower.includes('(y/n)') || lower.includes('yes, proceed'))) {
      trustDetected = true
      if (!win.isDestroyed()) {
        win.show()
        win.focus()
      }
    }
  })

  // After startup grace, inject the prompt
  setTimeout(() => {
    ptyManager.setDataInterceptor(ptyId, null)
    if (win.isDestroyed()) return

    // Write the prompt — this also sets bellArmed and isThinking
    ptyManager.writeToPty(ptyId, schedule.prompt + '\r')

    // Mark session so the attention handler brings window to front
    const session = ptyManager.getByPtyId(ptyId)
    if (session) session.scheduledBringToFront = true
  }, PROMPT_DELAY_MS)
}
