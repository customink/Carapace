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
  return findTranscript(sessionId) !== null
}

function findTranscript(sessionId: string): string | null {
  try {
    for (const dir of fs.readdirSync(PROJECTS_DIR)) {
      const file = path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`)
      if (fs.existsSync(file)) return file
    }
  } catch { /* projects dir missing */ }
  return null
}

const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024

/**
 * The most recent working directory recorded in a conversation's transcript that still
 * exists — recovers a revive whose saved folder was renamed or moved (often by the
 * session itself). Only the tail is read: long-running transcripts reach 100MB+.
 * Temp dirs (e.g. a session's scratchpad) are skipped.
 */
export function lastExistingCwd(sessionId: string): string | null {
  const file = findTranscript(sessionId)
  if (!file) return null
  let tail: string
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const size = fs.fstatSync(fd).size
      const len = Math.min(size, TRANSCRIPT_TAIL_BYTES)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, size - len)
      tail = buf.toString('utf-8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
  const cwds = [...tail.matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)].map(m => {
    try { return JSON.parse(`"${m[1]}"`) as string } catch { return null }
  })
  const tmp = fs.realpathSync(os.tmpdir())
  for (let i = cwds.length - 1; i >= 0; i--) {
    const cwd = cwds[i]
    if (!cwd || cwd.startsWith('/private/tmp') || cwd.startsWith('/tmp') || cwd.startsWith(tmp)) continue
    if (fs.existsSync(cwd)) return cwd
  }
  return null
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
