import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Titles of claude.ai Artifacts, keyed by artifact ID and shared across conversations.
 * Carapace can't fetch an artifact (it's private to the user's claude.ai account), so titles
 * come from what the transcript shows: the `<title>` of the local HTML file a publish result
 * names ("Published /…/report.html at https://claude.ai/artifact/…"), or the text of a
 * markdown link to the artifact. Without either, the pill falls back to the ID.
 */

const TITLES_FILE = path.join(os.homedir(), '.claude', 'usage-data', 'carapace-artifact-titles.json')
const MAX_TITLES = 1000
const MAX_TITLE_LENGTH = 120
const HEAD_BYTES = 64 * 1024

const PUBLISHED_RE = /Published (\/[^\s"\\]+?\.html?) at https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9-]{6,64})/g
const MD_LINK_RE = /\[([^\]\n]{1,200})\]\(https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9-]{6,64})[^)\s]*\)/g
const HTML_TITLE_RE = /<title[^>]*>([^<]{1,500})<\/title>/i

let titles: Record<string, string> | null = null

function load(): Record<string, string> {
  if (titles) return titles
  try {
    const parsed = JSON.parse(fs.readFileSync(TITLES_FILE, 'utf-8'))
    titles = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    titles = {}
  }
  return titles!
}

function save(): void {
  const entries = Object.entries(titles!)
  if (entries.length > MAX_TITLES) titles = Object.fromEntries(entries.slice(-MAX_TITLES))
  try {
    fs.mkdirSync(path.dirname(TITLES_FILE), { recursive: true })
    const tmp = `${TITLES_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(titles, null, 2), 'utf-8')
    fs.renameSync(tmp, TITLES_FILE)
  } catch (err) {
    console.error('[artifacts] Failed to save titles:', (err as Error).message)
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
}

function clean(title: string): string {
  return decodeEntities(title).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH)
}

function htmlTitle(file: string): string | null {
  let fd: number
  try { fd = fs.openSync(file, 'r') } catch { return null }
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const read = fs.readSync(fd, buf, 0, HEAD_BYTES, 0)
    return buf.toString('utf-8', 0, read).match(HTML_TITLE_RE)?.[1] ?? null
  } catch {
    return null
  } finally {
    fs.closeSync(fd)
  }
}

function set(id: string, title: string): boolean {
  const t = clean(title)
  if (!t || /^https?:\/\//.test(t)) return false
  const map = load()
  if (map[id] === t) return false
  delete map[id] // re-insert so the newest titles survive the size cap
  map[id] = t
  return true
}

/** Learn titles from one raw transcript line. Returns the artifact IDs whose title changed. */
export function learnArtifactTitlesFromLine(line: string): string[] {
  if (!line.includes('claude.ai/')) return []
  const learned: string[] = []
  // The page's own <title> wins over link text, so link text never replaces it
  for (const m of line.matchAll(PUBLISHED_RE)) {
    const title = htmlTitle(m[1]!)
    if (title && set(m[2]!, title)) learned.push(m[2]!)
  }
  for (const m of line.matchAll(MD_LINK_RE)) {
    if (!(m[2]! in load()) && set(m[2]!, m[1]!.replace(/\\"/g, '"').replace(/[*`]/g, ''))) learned.push(m[2]!)
  }
  if (learned.length > 0) save()
  return learned
}

export function getArtifactTitle(id: string): string | undefined {
  return load()[id]
}
