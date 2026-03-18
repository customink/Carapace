import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ScheduledPrompt } from '@shared/types/scheduled-prompt'

const SCHEDULES_FILE = join(homedir(), '.claude', 'usage-data', 'carapace-schedules.json')
const DIR = join(homedir(), '.claude', 'usage-data')

function ensureDir(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
}

export function loadSchedules(): ScheduledPrompt[] {
  try {
    return JSON.parse(readFileSync(SCHEDULES_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export function addSchedule(schedule: Omit<ScheduledPrompt, 'id'>): ScheduledPrompt[] {
  const schedules = loadSchedules()
  schedules.push({
    ...schedule,
    id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  })
  ensureDir()
  writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2))
  return schedules
}

export function updateSchedule(id: string, updates: Omit<ScheduledPrompt, 'id'>): ScheduledPrompt[] {
  const schedules = loadSchedules()
  const idx = schedules.findIndex(s => s.id === id)
  if (idx !== -1) schedules[idx] = { ...updates, id }
  ensureDir()
  writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2))
  return schedules
}

export function deleteSchedule(id: string): ScheduledPrompt[] {
  const schedules = loadSchedules().filter(s => s.id !== id)
  ensureDir()
  writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2))
  return schedules
}
