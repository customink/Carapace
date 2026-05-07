import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { CARAPACE_CACHE_DIR } from '@shared/constants/paths'

const SETTINGS_FILE = join(CARAPACE_CACHE_DIR, 'app-settings.json')

export type OrbClickAction = 'new-session' | 'new-session-bypass' | 'focus-recent' | 'focus-all' | 'preset'

export interface AppSettings {
  chimeSound: string
  chimeVolume: number
  orbClickAction: OrbClickAction
  orbCmdClickAction: OrbClickAction
  orbCtrlClickAction: OrbClickAction
  orbClickPreset: string   // preset ID for 'preset' action on click
  orbCmdClickPreset: string
  orbCtrlClickPreset: string
  dailyTokenGoal: number   // 0 = no goal / gauge hidden
}

const DEFAULTS: AppSettings = {
  chimeSound: '/System/Library/Sounds/Glass.aiff',
  chimeVolume: 50,
  orbClickAction: 'new-session',
  orbCmdClickAction: 'new-session-bypass',
  orbCtrlClickAction: 'focus-all',
  orbClickPreset: '',
  orbCmdClickPreset: '',
  orbCtrlClickPreset: '',
  dailyTokenGoal: 0,
}

export function loadAppSettings(): AppSettings {
  try {
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'))
    return { ...DEFAULTS, ...data }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveAppSettings(settings: Partial<AppSettings>): AppSettings {
  const current = loadAppSettings()
  const updated = { ...current, ...settings }
  if (!existsSync(CARAPACE_CACHE_DIR)) {
    mkdirSync(CARAPACE_CACHE_DIR, { recursive: true })
  }
  writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2))
  return updated
}
