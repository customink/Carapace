import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const HISTORY_DIR = path.join(os.homedir(), '.claude', 'usage-data')
const HISTORY_FILE = path.join(HISTORY_DIR, 'carapace-session-history.json')
const NOTES_DIR = path.join(HISTORY_DIR, 'session-notes')
const MAX_ENTRIES = 12

export interface SessionHistoryEntry {
  title: string
  folder: string
  bypass: boolean
  shellTab: boolean
  ptyId: string
  startTime: string // ISO string
  color?: string
  label?: string
  shellTabNames?: string[]
}

function ensureDir(): void {
  fs.mkdirSync(HISTORY_DIR, { recursive: true })
}

export function loadHistory(): SessionHistoryEntry[] {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf-8')
    const entries = JSON.parse(raw)
    if (Array.isArray(entries)) return entries
  } catch { /* missing or corrupt */ }
  return []
}

function saveHistory(entries: SessionHistoryEntry[]): void {
  ensureDir()
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries, null, 2), 'utf-8')
}

export function recordSession(entry: SessionHistoryEntry): void {
  const entries = loadHistory()
  entries.unshift(entry)
  // Keep only the most recent MAX_ENTRIES
  saveHistory(entries.slice(0, MAX_ENTRIES))
}

/** Update a history entry's mutable fields (label, color, shellTabNames) by ptyId */
export function updateHistoryEntry(ptyId: string, updates: { label?: string; color?: string; shellTabNames?: string[] }): void {
  const entries = loadHistory()
  const entry = entries.find(e => e.ptyId === ptyId)
  if (!entry) return
  if (updates.label !== undefined) entry.label = updates.label
  if (updates.color !== undefined) entry.color = updates.color
  if (updates.shellTabNames !== undefined) entry.shellTabNames = updates.shellTabNames
  saveHistory(entries)
}

/** Load notes content for a given ptyId */
export function loadNotes(ptyId: string): string {
  try {
    return fs.readFileSync(path.join(NOTES_DIR, `${ptyId}.txt`), 'utf-8')
  } catch {
    return ''
  }
}

/** Copy notes from a previous session to a new session's ptyId */
export function copyNotes(fromPtyId: string, toPtyId: string): void {
  const content = loadNotes(fromPtyId)
  if (!content) return
  fs.mkdirSync(NOTES_DIR, { recursive: true })
  fs.writeFileSync(path.join(NOTES_DIR, `${toPtyId}.txt`), content, 'utf-8')
}
