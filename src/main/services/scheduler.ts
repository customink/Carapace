import { BrowserWindow, app } from 'electron'
import { loadSchedules } from './schedule-store'
import { loadPresets } from './preset-store'
import { spawnClaudeSession } from './session-spawner'
import { ensureTrustAccepted } from './claude-config'
import * as ptyManager from './pty-manager'
import type { ScheduledPrompt } from '@shared/types/scheduled-prompt'

const MAX_WAIT_MS = 30_000 // max time to wait for Claude prompt to appear

let tickTimer: ReturnType<typeof setTimeout> | null = null
const firedToday = new Map<string, string>()

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Compute ms until the start of the next minute, capped at 60s. */
function msToNextMinute(): number {
  const now = Date.now()
  const nextMinute = Math.ceil(now / 60_000) * 60_000
  return Math.min(60_000, Math.max(1000, nextMinute - now))
}

function scheduleTick(): void {
  tickTimer = setTimeout(() => {
    tickTimer = null
    checkSchedules()
    scheduleTick()
  }, msToNextMinute())
}

export function startScheduler(): void {
  if (tickTimer) return
  checkSchedules() // check immediately on start in case something is due right now
  scheduleTick()
}

export function stopScheduler(): void {
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null }
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
  // Pre-accept the trust dialog so it won't block the scheduled session
  ensureTrustAccepted()

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

  // Show dock since we have a terminal now, with orb icon
  app.dock?.show()
  const { resetDockIcon: resetIcon } = require('./icon-generator')
  resetIcon()

  let promptInjected = false

  const maxTimer = setTimeout(() => {
    if (!promptInjected) injectPrompt()
  }, MAX_WAIT_MS)

  function injectPrompt() {
    if (promptInjected) return
    promptInjected = true
    clearTimeout(maxTimer)
    ptyManager.setDataInterceptor(ptyId, null)
    if (win.isDestroyed()) return

    setTimeout(() => {
      if (win.isDestroyed()) return
      ptyManager.writeToPty(ptyId, schedule.prompt + '\r')
      const session = ptyManager.getByPtyId(ptyId)
      if (session) session.scheduledBringToFront = true
    }, 500)
  }

  // Wait for PTY to be created (async after renderer loads), then watch for Claude ready signal
  function waitForPtyAndSetup() {
    const session = ptyManager.getByPtyId(ptyId)
    if (!session) {
      setTimeout(waitForPtyAndSetup, 500)
      return
    }
    setupInterceptor()
  }
  waitForPtyAndSetup()

  function setupInterceptor() {
    let rawBuffer = ''
    ptyManager.setDataInterceptor(ptyId, (data) => {
      if (win.isDestroyed()) return
      rawBuffer += data

      // Strip ANSI sequences for matching
      const stripped = rawBuffer
        .replace(/\x1b\[[^\x40-\x7e]*[\x40-\x7e]/g, '')
        .replace(/\x1b\][^\x07]*\x07/g, '')
        .replace(/\x1b[^[]/g, '')
        .replace(/[\x00-\x1f]/g, ' ')

      // Detect Claude ready: "Cost:" status line appears after full init
      if (!promptInjected && stripped.toLowerCase().includes('cost:')) {
        injectPrompt()
      }
    })
  }
}
