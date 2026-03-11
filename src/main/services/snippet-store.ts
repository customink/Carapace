import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { CARAPACE_CACHE_DIR } from '@shared/constants/paths'
import type { Snippet } from '@shared/types/snippet'

const SNIPPETS_FILE = join(CARAPACE_CACHE_DIR, 'snippets.json')

function ensureDir(): void {
  if (!existsSync(CARAPACE_CACHE_DIR)) {
    mkdirSync(CARAPACE_CACHE_DIR, { recursive: true })
  }
}

export function loadSnippets(): Snippet[] {
  try {
    return JSON.parse(readFileSync(SNIPPETS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export function addSnippet(icon: string, label: string, prompt: string): Snippet[] {
  const snippets = loadSnippets()
  snippets.push({
    id: `snip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    icon,
    label,
    prompt,
  })
  ensureDir()
  writeFileSync(SNIPPETS_FILE, JSON.stringify(snippets, null, 2))
  return snippets
}

export function updateSnippet(id: string, icon: string, label: string, prompt: string): Snippet[] {
  const snippets = loadSnippets()
  const idx = snippets.findIndex(s => s.id === id)
  if (idx !== -1) {
    snippets[idx] = { ...snippets[idx]!, id, icon, label, prompt }
  }
  ensureDir()
  writeFileSync(SNIPPETS_FILE, JSON.stringify(snippets, null, 2))
  return snippets
}

export function deleteSnippet(id: string): Snippet[] {
  const snippets = loadSnippets().filter(s => s.id !== id)
  ensureDir()
  writeFileSync(SNIPPETS_FILE, JSON.stringify(snippets, null, 2))
  return snippets
}
