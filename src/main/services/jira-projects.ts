import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Which Jira site each project key lives on (`AC` → `customink.atlassian.net`), learned from
 * evidence in transcripts: full `…atlassian.net/browse/KEY-1` links, and Jira MCP tool calls
 * (`cloudId` + `issueIdOrKey` / `projectKey`). This is what turns a bare `AC-877` mention into
 * a link — only for learned projects, so look-alikes such as `UTF-8` or `SHA-256` never match.
 * Learning reads whole lines (tool calls and output included); links themselves still only
 * come from message text.
 */

const STORE_FILE = path.join(os.homedir(), '.claude', 'usage-data', 'carapace-jira-projects.json')
const PROJECT_RE = /^[A-Z][A-Z0-9]{1,9}$/
const SITE_RE = /^[a-z0-9-]+\.atlassian\.net$/

const BROWSE_RE = /https:\/\/([a-z0-9-]+\.atlassian\.net)\/browse\/([A-Z][A-Z0-9]{1,9})-\d+/gi
const CLOUD_ID_RE = /"cloudId"\s*:\s*"([a-z0-9-]+\.atlassian\.net)"/i
const TOOL_KEY_RE = /"(?:issueIdOrKey|projectKey)"\s*:\s*"([A-Z][A-Z0-9]{1,9})(?:-\d+)?"/g

let projects: Record<string, string> | null = null

function load(): Record<string, string> {
  if (projects) return projects
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'))
    projects = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    projects = {}
  }
  return projects!
}

function save(): void {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true })
    const tmp = `${STORE_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(projects, null, 2), 'utf-8')
    fs.renameSync(tmp, STORE_FILE)
  } catch (err) {
    console.error('[jira] Failed to save projects:', (err as Error).message)
  }
}

/** Record project → site. Returns true if this taught us something new. */
export function learnJiraProject(project: string, site: string): boolean {
  const key = project.toUpperCase()
  const host = site.toLowerCase()
  if (!PROJECT_RE.test(key) || !SITE_RE.test(host)) return false
  const map = load()
  if (map[key] === host) return false
  map[key] = host
  save()
  return true
}

/** Learn from one raw transcript line. Returns the project keys that were newly learned. */
export function learnJiraProjectsFromLine(line: string): string[] {
  if (!line.includes('atlassian.net')) return []
  const learned: string[] = []
  for (const m of line.matchAll(BROWSE_RE)) {
    if (learnJiraProject(m[2]!, m[1]!)) learned.push(m[2]!.toUpperCase())
  }
  const site = line.match(CLOUD_ID_RE)?.[1]
  if (site) {
    for (const m of line.matchAll(TOOL_KEY_RE)) {
      if (learnJiraProject(m[1]!, site)) learned.push(m[1]!)
    }
  }
  return learned
}

/** Canonical browse URL for a bare key like `AC-877`, if its project's site is known. */
export function resolveJiraKey(key: string): string | null {
  const project = key.slice(0, key.lastIndexOf('-'))
  const site = load()[project]
  return site ? `https://${site}/browse/${key}` : null
}

export function hasKnownJiraProjects(): boolean {
  return Object.keys(load()).length > 0
}

// ─── Ticket titles ───
// Carapace has no Jira credentials of its own, but whenever Claude looks a ticket up through
// the Jira MCP, the result (`{"key":"AC-1294","fields":{"summary":"…"}}`) lands in the
// transcript. Titles are harvested from there and shared across conversations.

const TITLES_FILE = path.join(os.homedir(), '.claude', 'usage-data', 'carapace-jira-titles.json')
const MAX_TITLES = 3000
const MAX_TITLE_LENGTH = 300
const MAX_RESULT_BYTES = 4 * 1024 * 1024
const KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/

let titles: Record<string, string> | null = null

function loadTitles(): Record<string, string> {
  if (titles) return titles
  try {
    const parsed = JSON.parse(fs.readFileSync(TITLES_FILE, 'utf-8'))
    titles = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    titles = {}
  }
  return titles!
}

function saveTitles(): void {
  const entries = Object.entries(titles!)
  if (entries.length > MAX_TITLES) titles = Object.fromEntries(entries.slice(-MAX_TITLES))
  try {
    fs.mkdirSync(path.dirname(TITLES_FILE), { recursive: true })
    const tmp = `${TITLES_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(titles, null, 2), 'utf-8')
    fs.renameSync(tmp, TITLES_FILE)
  } catch (err) {
    console.error('[jira] Failed to save titles:', (err as Error).message)
  }
}

export function getJiraTitle(key: string): string | undefined {
  return loadTitles()[key]
}

/** Text of every tool_result in a parsed transcript entry */
function toolResultTexts(entry: unknown): string[] {
  const content = (entry as { type?: string; message?: { content?: unknown } })?.message?.content
  if ((entry as { type?: string })?.type !== 'user' || !Array.isArray(content)) return []
  const texts: string[] = []
  for (const part of content) {
    if (part?.type !== 'tool_result') continue
    if (typeof part.content === 'string') texts.push(part.content)
    else if (Array.isArray(part.content)) {
      for (const p of part.content) if (p?.type === 'text' && typeof p.text === 'string') texts.push(p.text)
    }
  }
  return texts
}

/** Learn ticket titles from Jira tool results in one parsed transcript entry. Returns keys whose title changed. */
export function learnJiraTitlesFromEntry(entry: unknown): string[] {
  const learned: string[] = []
  for (const text of toolResultTexts(entry)) {
    if (text.length > MAX_RESULT_BYTES || !text.includes('"summary"') || !text.trimStart().startsWith('{')) continue
    let data: unknown
    try { data = JSON.parse(text) } catch { continue }
    // Walk for issue objects: { key: 'AC-1', fields: { summary: '…' } } — single issues and search results alike
    const stack: unknown[] = [data]
    let visited = 0
    while (stack.length > 0 && visited++ < 50_000) {
      const node = stack.pop()
      if (!node || typeof node !== 'object') continue
      if (Array.isArray(node)) { stack.push(...node); continue }
      const obj = node as { key?: unknown; fields?: { summary?: unknown } }
      const summary = obj.fields?.summary
      if (typeof obj.key === 'string' && KEY_RE.test(obj.key) && typeof summary === 'string' && summary.trim()) {
        const title = summary.trim().slice(0, MAX_TITLE_LENGTH)
        const map = loadTitles()
        if (map[obj.key] !== title) {
          delete map[obj.key] // re-insert so the newest titles survive the size cap
          map[obj.key] = title
          learned.push(obj.key)
        }
      }
      for (const value of Object.values(obj)) if (value && typeof value === 'object') stack.push(value)
    }
  }
  if (learned.length > 0) saveTitles()
  return learned
}
