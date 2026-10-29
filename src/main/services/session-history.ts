import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { PROJECTS_DIR } from '@shared/constants/paths'

const HISTORY_DIR = path.join(os.homedir(), '.claude', 'usage-data')
const HISTORY_FILE = path.join(HISTORY_DIR, 'carapace-session-history.json')
const NOTES_DIR = path.join(HISTORY_DIR, 'session-notes')
const MAX_ENTRIES = 50

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
  claudeSessionId?: string // Claude Code conversation ID for --resume
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
export function updateHistoryEntry(ptyId: string, updates: { label?: string; color?: string; title?: string; shellTabNames?: string[]; claudeSessionId?: string }): void {
  const entries = loadHistory()
  const entry = entries.find(e => e.ptyId === ptyId)
  if (!entry) return
  if (updates.label !== undefined) entry.label = updates.label
  if (updates.color !== undefined) entry.color = updates.color
  if (updates.title !== undefined) entry.title = updates.title
  if (updates.shellTabNames !== undefined) entry.shellTabNames = updates.shellTabNames
  if (updates.claudeSessionId !== undefined) entry.claudeSessionId = updates.claudeSessionId
  saveHistory(entries)
}

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Claude Code session IDs are UUIDs. Shape-checked because they're written into a shell command line. */
export function isValidSessionId(id: string | undefined): id is string {
  return !!id && SESSION_ID_RE.test(id)
}

/**
 * True if a top-level transcript `<project>/<sessionId>.jsonl` exists for this ID.
 * Scans every project dir rather than re-deriving the folder encoding, which
 * Claude Code applies to more characters than just `/`.
 */
export function transcriptExists(sessionId: string): boolean {
  try {
    for (const dir of fs.readdirSync(PROJECTS_DIR)) {
      if (fs.existsSync(path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`))) return true
    }
  } catch { /* projects dir missing */ }
  return false
}

/**
 * True if `transcriptPath` is the main transcript for `sessionId` — directly inside a
 * project dir. Subagent / teammate transcripts live deeper (`<sid>/subagents/*.jsonl`)
 * and must never be mistaken for the session's own conversation.
 */
export function isMainTranscript(transcriptPath: string | undefined, sessionId: string): boolean {
  if (!transcriptPath) return false
  const resolved = path.resolve(transcriptPath)
  return path.basename(resolved) === `${sessionId}.jsonl` &&
    path.dirname(path.dirname(resolved)) === path.resolve(PROJECTS_DIR)
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
