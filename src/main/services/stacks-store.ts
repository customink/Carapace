import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import * as yaml from 'js-yaml'
import type { Stack } from '@shared/types/stack'
import { STACKS_DIR } from '@shared/constants/paths'

// Old single-file location — migrate on first load if present
const OLD_STACKS_JSON = join(homedir(), '.claude', 'usage-data', 'carapace-stacks.json')
const OLD_STACKS_JSON2 = join(homedir(), '.claude', 'stacks.json')

function ensureDir(): void {
  if (!existsSync(STACKS_DIR)) mkdirSync(STACKS_DIR, { recursive: true })
}

// Derive a stable filename from the stack name: lowercase, spaces→hyphens
function stackFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + '.yaml'
}

// The YAML shape on disk matches the plugin's format exactly:
//   name, description, system (not systemPath), projects: [{name, path}]
function toYaml(stack: Stack): string {
  const doc: Record<string, any> = {
    name: stack.name,
    description: stack.description,
    system: stack.systemPath,
  }
  if (stack.projects.length > 0) {
    doc.projects = stack.projects.map(p => ({ name: p.name, path: p.path }))
  }
  return yaml.dump(doc, { lineWidth: -1 })
}

function fromYaml(content: string, filename: string): Stack {
  const raw = yaml.load(content) as Record<string, any>
  const name = String(raw?.name || basename(filename, '.yaml'))
  return {
    id: `stack-${stackFilename(name).replace('.yaml', '')}`,
    name,
    description: String(raw?.description || ''),
    systemPath: String(raw?.system || raw?.systemPath || ''),
    projects: Array.isArray(raw?.projects)
      ? raw.projects.map((p: any) => ({ name: String(p.name || ''), path: String(p.path || '') }))
      : [],
  }
}

function migrateOldJson(filePath: string): void {
  if (!existsSync(filePath)) return
  try {
    const existing = JSON.parse(readFileSync(filePath, 'utf-8')) as Stack[]
    ensureDir()
    for (const stack of existing) {
      const dest = join(STACKS_DIR, stackFilename(stack.name))
      if (!existsSync(dest)) writeFileSync(dest, toYaml(stack))
    }
  } catch { /* ignore malformed old files */ }
  // Remove old file after migration
  try { rmSync(filePath) } catch { /* ignore */ }
}

export function loadStacks(): Stack[] {
  // One-time migrations from previous storage locations
  migrateOldJson(OLD_STACKS_JSON)
  migrateOldJson(OLD_STACKS_JSON2)

  ensureDir()
  const stacks: Stack[] = []
  try {
    for (const file of readdirSync(STACKS_DIR)) {
      if (!file.endsWith('.yaml')) continue
      try {
        const content = readFileSync(join(STACKS_DIR, file), 'utf-8')
        stacks.push(fromYaml(content, file))
      } catch { /* skip malformed files */ }
    }
  } catch { /* dir read failed */ }
  return stacks
}

export function addStack(stack: Omit<Stack, 'id'>): Stack[] {
  ensureDir()
  const full: Stack = {
    ...stack,
    id: `stack-${stackFilename(stack.name).replace('.yaml', '')}`,
  }
  writeFileSync(join(STACKS_DIR, stackFilename(stack.name)), toYaml(full))
  return loadStacks()
}

export function updateStack(id: string, updates: Omit<Stack, 'id'>): Stack[] {
  ensureDir()
  // Find old file by id in case name changed
  const old = loadStacks().find(s => s.id === id)
  if (old && old.name !== updates.name) {
    // Name changed → remove old file
    const oldFile = join(STACKS_DIR, stackFilename(old.name))
    try { unlinkSync(oldFile) } catch { /* ignore */ }
  }
  const full: Stack = { ...updates, id }
  writeFileSync(join(STACKS_DIR, stackFilename(updates.name)), toYaml(full))
  return loadStacks()
}

export function deleteStack(id: string): Stack[] {
  const stack = loadStacks().find(s => s.id === id)
  if (stack) {
    try { unlinkSync(join(STACKS_DIR, stackFilename(stack.name))) } catch { /* ignore */ }
  }
  return loadStacks()
}

// Merge-import: update by name if exists, add new file if not.
// Accepts raw objects in plugin format (field `system`) or Carapace format (field `systemPath`).
export function importStacks(newStacks: Record<string, any>[]): Stack[] {
  ensureDir()
  const existing = new Map(loadStacks().map(s => [s.name, s]))

  for (const raw of newStacks) {
    const name = String(raw.name || '')
    if (!name) continue
    const merged: Stack = {
      id: `stack-${stackFilename(name).replace('.yaml', '')}`,
      name,
      description: String(raw.description || ''),
      systemPath: String(raw.systemPath || raw.system || ''),
      projects: Array.isArray(raw.projects)
        ? raw.projects.map((p: any) => ({ name: String(p.name || ''), path: String(p.path || '') }))
        : (existing.get(name)?.projects ?? []),
    }
    writeFileSync(join(STACKS_DIR, stackFilename(name)), toYaml(merged))
  }

  return loadStacks()
}
