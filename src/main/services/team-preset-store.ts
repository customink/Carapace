import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const PRESETS_FILE = path.join(os.homedir(), '.claude', 'usage-data', 'carapace-team-presets.json')

export interface TeamMember {
  role: string
  description: string
}

export interface TeamPreset {
  id: string
  name: string
  members: TeamMember[]
}

function ensureDir(): void {
  fs.mkdirSync(path.dirname(PRESETS_FILE), { recursive: true })
}

export function loadTeamPresets(): TeamPreset[] {
  try {
    return JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export function addTeamPreset(preset: Omit<TeamPreset, 'id'>): TeamPreset[] {
  const presets = loadTeamPresets()
  presets.push({
    ...preset,
    id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  })
  ensureDir()
  fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2))
  return presets
}

export function deleteTeamPreset(id: string): TeamPreset[] {
  const presets = loadTeamPresets().filter(p => p.id !== id)
  ensureDir()
  fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2))
  return presets
}

/** Generate a prompt that tells Claude to create an agent team from a preset */
export function generateTeamPrompt(preset: TeamPreset): string {
  const memberLines = preset.members
    .map((m, i) => `${i + 1}. **${m.role}**: ${m.description}`)
    .join('\n')
  return `Create an agent team called "${preset.name}" with the following ${preset.members.length} teammates:\n${memberLines}\n\nIMPORTANT: Use --teammate-mode in-process (do NOT use tmux or iTerm2 split panes). Spawn all teammates and coordinate their work.`
}
