import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Preset } from '@shared/types/preset'

const PRESETS_FILE = join(homedir(), '.claude', 'usage-data', 'carapace-presets.json')
const PRESETS_DIR = join(homedir(), '.claude', 'usage-data')

function ensureDir(): void {
  if (!existsSync(PRESETS_DIR)) {
    mkdirSync(PRESETS_DIR, { recursive: true })
  }
}

export function loadPresets(): Preset[] {
  try {
    return JSON.parse(readFileSync(PRESETS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export function addPreset(preset: Omit<Preset, 'id'>): Preset[] {
  const presets = loadPresets()
  presets.push({
    ...preset,
    id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  })
  ensureDir()
  writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2))
  return presets
}

export function updatePreset(id: string, updates: Omit<Preset, 'id'>): Preset[] {
  const presets = loadPresets()
  const idx = presets.findIndex(p => p.id === id)
  if (idx !== -1) {
    presets[idx] = { ...updates, id }
  }
  ensureDir()
  writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2))
  return presets
}

export function deletePreset(id: string): Preset[] {
  const presets = loadPresets().filter(p => p.id !== id)
  ensureDir()
  writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2))
  return presets
}
