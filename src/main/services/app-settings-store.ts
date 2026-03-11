import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { CARAPACE_CACHE_DIR } from '@shared/constants/paths'

const SETTINGS_FILE = join(CARAPACE_CACHE_DIR, 'app-settings.json')

export interface AppSettings {
  chimeSound: string   // filename in /System/Library/Sounds/
  chimeVolume: number  // 0-100
}

const DEFAULTS: AppSettings = {
  chimeSound: '/System/Library/Sounds/Glass.aiff',
  chimeVolume: 50,
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
