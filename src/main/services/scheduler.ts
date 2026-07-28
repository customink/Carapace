import { loadSchedules } from './schedule-store'
import { loadPresets } from './preset-store'
import { spawnWithPrompt } from './spawn-with-prompt'
import type { ScheduledPrompt } from '@shared/types/scheduled-prompt'

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
  let bypass = false
  let color: string | undefined
  let title = schedule.name
  let shellTabNames: string[] | undefined
  let model: string | undefined

  if (schedule.presetId) {
    const presets = loadPresets()
    const preset = presets.find(p => p.id === schedule.presetId)
    if (preset) {
      bypass = preset.bypass
      color = preset.color || undefined
      title = preset.title || schedule.name
      model = preset.model || undefined
      if (preset.shellTab) {
        const count = Math.max(1, preset.shellTabCount)
        shellTabNames = []
        for (let i = 0; i < count; i++) shellTabNames.push(preset.shellTabNames[i] || '')
      }
    }
  }

  spawnWithPrompt({
    prompt: schedule.prompt,
    cwd: schedule.cwd || undefined,
    title,
    color,
    bypass,
    shellTabNames,
    model,
    background: true,
  })
}
