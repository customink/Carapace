import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs'
import { dirname } from 'path'
import { homedir } from 'os'
import { join } from 'path'
import type { Stack } from '@shared/types/stack'
import { STACKS_FILE } from '@shared/constants/paths'

const OLD_STACKS_FILE = join(homedir(), '.claude', 'usage-data', 'carapace-stacks.json')

function ensureDir(): void {
  const dir = dirname(STACKS_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function migrate(): void {
  if (!existsSync(STACKS_FILE) && existsSync(OLD_STACKS_FILE)) {
    ensureDir()
    renameSync(OLD_STACKS_FILE, STACKS_FILE)
  }
}

export function loadStacks(): Stack[] {
  migrate()
  try {
    return JSON.parse(readFileSync(STACKS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export function addStack(stack: Omit<Stack, 'id'>): Stack[] {
  const stacks = loadStacks()
  stacks.push({
    ...stack,
    id: `stack-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  })
  ensureDir()
  writeFileSync(STACKS_FILE, JSON.stringify(stacks, null, 2))
  return stacks
}

export function updateStack(id: string, updates: Omit<Stack, 'id'>): Stack[] {
  const stacks = loadStacks()
  const idx = stacks.findIndex(s => s.id === id)
  if (idx !== -1) stacks[idx] = { ...updates, id }
  ensureDir()
  writeFileSync(STACKS_FILE, JSON.stringify(stacks, null, 2))
  return stacks
}

export function deleteStack(id: string): Stack[] {
  const stacks = loadStacks().filter(s => s.id !== id)
  ensureDir()
  writeFileSync(STACKS_FILE, JSON.stringify(stacks, null, 2))
  return stacks
}

// Normalize any incoming stack object — handles both the coworker's import format
// (field `system`, projects as array) and the internal stored format (field `systemPath`).
function normalizeStack(raw: Record<string, any>): Omit<Stack, 'id'> {
  return {
    name: String(raw.name || ''),
    description: String(raw.description || ''),
    systemPath: String(raw.systemPath || raw.system || ''),
    projects: Array.isArray(raw.projects)
      ? raw.projects.map((p: any) => ({ name: String(p.name || ''), path: String(p.path || '') }))
      : [],
  }
}

export function importStacks(newStacks: Record<string, any>[]): Stack[] {
  const existing = loadStacks()
  const nameMap = new Map(existing.map(s => [s.name, s]))

  for (const raw of newStacks) {
    const stack = normalizeStack(raw)
    if (nameMap.has(stack.name)) {
      nameMap.set(stack.name, { ...nameMap.get(stack.name)!, ...stack })
    } else {
      nameMap.set(stack.name, {
        ...stack,
        id: `stack-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      })
    }
  }

  const result = Array.from(nameMap.values())
  ensureDir()
  writeFileSync(STACKS_FILE, JSON.stringify(result, null, 2))
  return result
}
