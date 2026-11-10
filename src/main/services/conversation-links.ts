import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { ConversationLink, ConversationLinkKind } from '@shared/types/conversation-link'
import { extractLinks, extractJiraKeys, messageText } from './link-extractor'
import { extractLocalPaths, displayPath } from './local-paths'
import { learnJiraProjectsFromLine, learnJiraProject, resolveJiraKey, hasKnownJiraProjects, learnJiraTitlesFromEntry, getJiraTitle } from './jira-projects'

/**
 * GitHub PR + Jira ticket links mentioned in each conversation, keyed by Claude session ID
 * so they survive revive (`--resume` keeps the ID).
 *
 * Transcripts are scanned incrementally: `offset` is the byte position up to which the file
 * has been read, persisted so a 100MB transcript is only ever read once.
 */

const STORE_FILE = path.join(os.homedir(), '.claude', 'usage-data', 'carapace-conversation-links.json')
const MAX_CONVERSATIONS = 300
const SAVE_DEBOUNCE_MS = 1000

interface ConversationRecord {
  offset: number
  links: ConversationLink[]
  /** URLs the user deleted — never re-added, even if mentioned again or rescanned */
  dismissed: string[]
  /** Bare Jira keys seen before their project's site was learned → first-mention timestamp */
  pendingKeys?: Record<string, string>
  /** Scan format version — bumping SCAN_VERSION rescans old records from the start */
  v?: number
  updatedAt: string
}

/** 2: also harvest Jira ticket titles from tool results. 3: local files and folders */
const SCAN_VERSION = 3

const MAX_PENDING_KEYS = 200

let store: Record<string, ConversationRecord> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let onChangeCallback: ((sessionId: string) => void) | null = null
/** Per-session scan chain — a JSONL change can arrive while the previous scan is still reading */
const scanChains = new Map<string, Promise<void>>()

function load(): Record<string, ConversationRecord> {
  if (store) return store
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'))
    store = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    store = {}
  }
  // First run of bare-key resolution: seed project → site from Jira links already collected
  if (!hasKnownJiraProjects()) {
    for (const rec of Object.values(store!)) {
      for (const link of rec.links) {
        if (link.kind !== 'jira') continue
        const host = new URL(link.url).hostname
        learnJiraProject(link.label.slice(0, link.label.lastIndexOf('-')), host)
      }
    }
  }
  return store!
}

/** Add a link unless it's known or dismissed. Returns true if added. */
function addLink(rec: ConversationRecord, link: Omit<ConversationLink, 'firstSeen'>, firstSeen: string): boolean {
  if (rec.dismissed.includes(link.url) || rec.links.some(l => l.url === link.url)) return false
  rec.links.push({ ...link, firstSeen })
  return true
}

/** A project's site was just learned — turn any held bare keys for it into links, everywhere. */
function resolvePendingKeys(): void {
  for (const [sessionId, rec] of Object.entries(load())) {
    if (!rec.pendingKeys) continue
    let added = false
    for (const [key, firstSeen] of Object.entries(rec.pendingKeys)) {
      const url = resolveJiraKey(key)
      if (!url) continue
      delete rec.pendingKeys[key]
      if (addLink(rec, { kind: 'jira', url, label: key }, firstSeen)) added = true
    }
    if (added) changed(sessionId)
  }
}

function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushConversationLinks()
  }, SAVE_DEBOUNCE_MS)
}

/** Write pending changes now (called on quit). Temp file + rename so a crash can't truncate it. */
export function flushConversationLinks(): void {
  if (!store) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  const entries = Object.entries(store)
  if (entries.length > MAX_CONVERSATIONS) {
    entries.sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
    store = Object.fromEntries(entries.slice(0, MAX_CONVERSATIONS))
  }
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true })
    const tmp = `${STORE_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
    fs.renameSync(tmp, STORE_FILE)
  } catch (err) {
    console.error('[links] Failed to save:', (err as Error).message)
  }
}

function record(sessionId: string): ConversationRecord {
  const s = load()
  if (!s[sessionId]) s[sessionId] = { offset: 0, links: [], dismissed: [], updatedAt: new Date().toISOString() }
  return s[sessionId]!
}

function changed(sessionId: string): void {
  record(sessionId).updatedAt = new Date().toISOString()
  scheduleSave()
  onChangeCallback?.(sessionId)
}

export function onConversationLinksChanged(cb: (sessionId: string) => void): void {
  onChangeCallback = cb
}

/** Re-push a conversation's links to whoever is listening (e.g. after a terminal switches conversation). */
export function notifyConversationLinks(sessionId: string): void {
  onChangeCallback?.(sessionId)
}

export function getConversationLinks(sessionId: string): ConversationLink[] {
  return (load()[sessionId]?.links ?? []).map(link => {
    const title = link.kind === 'jira' ? getJiraTitle(link.label)
      : link.kind === 'file' ? displayPath(path.dirname(link.url))
      : undefined
    return title ? { ...link, title } : link
  })
}

/** Titles are shared across conversations — refresh every conversation that lists these tickets */
function notifyTitles(keys: Set<string>): void {
  for (const [sessionId, rec] of Object.entries(load())) {
    if (rec.links.some(l => l.kind === 'jira' && keys.has(l.label))) onChangeCallback?.(sessionId)
  }
}

export function removeConversationLink(sessionId: string, url: string): void {
  const rec = load()[sessionId]
  if (!rec) return
  const before = rec.links.length
  rec.links = rec.links.filter(l => l.url !== url)
  if (!rec.dismissed.includes(url)) rec.dismissed.push(url)
  if (rec.links.length !== before) changed(sessionId)
  else scheduleSave()
}

/** Remove every link of one kind (a pill's "Clear all"). Like single removals, they stay dismissed. */
export function clearConversationLinks(sessionId: string, kind: ConversationLinkKind): void {
  const rec = load()[sessionId]
  if (!rec) return
  const cleared = rec.links.filter(l => l.kind === kind)
  if (cleared.length === 0) return
  rec.links = rec.links.filter(l => l.kind !== kind)
  rec.dismissed = [...new Set([...rec.dismissed, ...cleared.map(l => l.url)])]
  changed(sessionId)
}

/** Read any new bytes of a conversation's transcript and pick up links from them. */
export function scanConversationTranscript(sessionId: string, transcriptPath: string): Promise<void> {
  const prev = scanChains.get(sessionId) ?? Promise.resolve()
  const next = prev.then(() => scan(sessionId, transcriptPath)).catch(err => {
    console.error('[links] Scan failed:', (err as Error).message)
  })
  scanChains.set(sessionId, next)
  next.finally(() => { if (scanChains.get(sessionId) === next) scanChains.delete(sessionId) })
  return next
}

async function scan(sessionId: string, transcriptPath: string): Promise<void> {
  const rec = record(sessionId)
  let size: number
  try {
    size = fs.statSync(transcriptPath).size
  } catch {
    return
  }
  if (size < rec.offset) rec.offset = 0 // rewritten/truncated — rescan (dismissed still applies)
  if (rec.v !== SCAN_VERSION) { rec.offset = 0; rec.v = SCAN_VERSION }
  if (size === rec.offset) return

  // Stream rather than readFile: backfilling a long conversation is 100MB+ on the main process
  let pending = ''
  let consumed = rec.offset
  let added = false
  let learnedProject = false
  const learnedTitles = new Set<string>()

  const handleLine = (line: string) => {
    // Project → site evidence can be anywhere, tool calls and output included
    if (learnJiraProjectsFromLine(line).length > 0) learnedProject = true
    const maybeTitles = line.includes('summary') && line.includes('fields')
    const maybePaths = line.includes('~/') || line.includes('/Users/') || line.includes('/Volumes/') || line.includes('`')
    // Cheap prefilter before JSON.parse: a link host, a ticket-key shape, a Jira result, or a path
    if (!maybeTitles && !maybePaths && !line.includes('github.com') && !line.includes('atlassian.net') && !/[A-Z]-\d/.test(line)) return
    let entry: unknown
    try { entry = JSON.parse(line) } catch { return }
    if (maybeTitles) for (const key of learnJiraTitlesFromEntry(entry)) learnedTitles.add(key)
    const text = messageText(entry)
    if (!text) return
    const firstSeen = (entry as { timestamp?: string }).timestamp || new Date().toISOString()
    for (const link of extractLinks(text)) {
      if (addLink(rec, link, firstSeen)) added = true
    }
    if (maybePaths) {
      const cwd = (entry as { cwd?: string }).cwd
      for (const local of extractLocalPaths(text, cwd)) {
        const name = path.basename(local.path) + (local.isDir ? '/' : '')
        if (addLink(rec, { kind: 'file', url: local.path, label: name }, firstSeen)) added = true
      }
    }
    for (const key of extractJiraKeys(text)) {
      const url = resolveJiraKey(key)
      if (url) {
        if (addLink(rec, { kind: 'jira', url, label: key }, firstSeen)) added = true
      } else {
        rec.pendingKeys ??= {}
        if (!(key in rec.pendingKeys) && Object.keys(rec.pendingKeys).length < MAX_PENDING_KEYS) {
          rec.pendingKeys[key] = firstSeen
        }
      }
    }
  }

  const stream = fs.createReadStream(transcriptPath, { start: rec.offset, end: size - 1, encoding: 'utf-8' })
  for await (const chunk of stream) {
    pending += chunk as string
    // Lines can be several MB (large tool output) — only split once a chunk completes one
    if (!(chunk as string).includes('\n')) continue
    const lines = pending.split('\n')
    pending = lines.pop()!
    for (const line of lines) {
      consumed += Buffer.byteLength(line, 'utf-8') + 1
      handleLine(line)
    }
  }
  // Anything after the last newline is a line still being written — leave it for next time
  rec.offset = consumed
  if (added) changed(sessionId)
  else scheduleSave()
  if (learnedProject) resolvePendingKeys()
  if (learnedTitles.size > 0) notifyTitles(learnedTitles)
}
