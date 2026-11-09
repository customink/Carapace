import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Local files and folders mentioned in a message (`~/Desktop/templates/`, `/Users/…/x.pdf`,
 * or a bare `report.pdf` next to a folder named in the same message). Only paths that exist
 * are kept — that's what separates real artifacts from examples and hypotheticals.
 */

export interface LocalPath {
  /** Absolute path — the dedupe key */
  path: string
  isDir: boolean
}

const HOME = os.homedir()
// Absolute or home-relative paths in running text (no spaces — those need backticks)
const BARE_PATH_RE = /(?:^|[\s(["'])((?:~|\/(?:Users|Volumes|Applications|opt|usr|etc|private|var))\/[^\s`'"<>()[\]{}|,;*]*)/g
const CODE_SPAN_RE = /`([^`\n]{1,400})`/g
const MD_LINK_RE = /\]\(((?:file:\/\/)?(?:~|\/)[^)\s]+)\)/g
// A bare file name worth resolving: has an extension, no slashes
const FILE_NAME_RE = /^[\w@+-][\w .@+-]*\.[A-Za-z0-9]{1,8}$/
const TRAILING_PUNCT_RE = /[.,;:!?)\]'"]+$/
// Your files live under home or on another volume; system dirs hold binaries and caches
const ALLOWED_ROOTS = [HOME + path.sep, '/Volumes/']
let tmpRoot: string | null = null

function expand(p: string): string {
  if (p.startsWith('file://')) { try { p = decodeURIComponent(p.slice('file://'.length)) } catch { /* keep as is */ } }
  if (p === '~' || p.startsWith('~/')) p = path.join(HOME, p.slice(1))
  return path.resolve(p) // also drops a trailing slash, so `dir/` and `dir` are one entry
}

/** Worth listing: under home or a volume, not Claude's own state (`.claude/`), not a temp dir */
function isUserPath(p: string): boolean {
  if (!ALLOWED_ROOTS.some(root => p.startsWith(root))) return false
  if (p.includes(`${path.sep}.claude${path.sep}`) || p.endsWith(`${path.sep}.claude`)) return false
  // Tool config and caches (~/.aws, ~/.android, ~/Library/…) rather than your own files
  if (p.startsWith(HOME + path.sep)) {
    const top = p.slice(HOME.length + 1).split(path.sep)[0]!
    if (top.startsWith('.') || top === 'Library') return false
  }
  tmpRoot ??= fs.realpathSync(os.tmpdir())
  return !p.startsWith(tmpRoot + path.sep)
}

function stat(p: string): fs.Stats | null {
  try { return fs.statSync(p) } catch { return null }
}

/** Existing local paths mentioned in `text`. `cwd` (the session's) resolves bare file names. */
export function extractLocalPaths(text: string, cwd?: string): LocalPath[] {
  const found = new Map<string, LocalPath>()
  const explicit: string[] = []
  const bareNames: string[] = []

  for (const m of text.matchAll(MD_LINK_RE)) explicit.push(m[1]!)
  for (const m of text.matchAll(BARE_PATH_RE)) explicit.push(m[1]!)
  for (const m of text.matchAll(CODE_SPAN_RE)) {
    const span = m[1]!.trim()
    if (/^(?:~|\/|file:\/\/)/.test(span)) explicit.push(span)
    else if (FILE_NAME_RE.test(span)) bareNames.push(span)
  }

  const dirs: string[] = []
  const add = (abs: string) => {
    if (found.has(abs) || !isUserPath(abs)) return
    const st = stat(abs)
    if (!st) return
    found.set(abs, { path: abs, isDir: st.isDirectory() })
    if (st.isDirectory()) dirs.push(abs)
  }

  for (const raw of explicit) {
    const candidate = raw.replace(TRAILING_PUNCT_RE, '')
    if (candidate.length < 3) continue
    add(expand(candidate))
  }
  // `06_report.pdf` right after "the PDFs are in ~/Desktop/templates/" lives in that folder
  for (const name of new Set(bareNames)) {
    for (const dir of [...dirs, ...(cwd ? [cwd] : [])]) {
      const abs = path.join(dir, name)
      if (stat(abs)) { add(abs); break }
    }
  }
  return [...found.values()]
}

/** `~/…` form for display */
export function displayPath(abs: string): string {
  return abs === HOME ? '~' : abs.startsWith(HOME + path.sep) ? '~' + abs.slice(HOME.length) : abs
}

// Opening these runs code — reveal them in Finder instead
const RUNNABLE_EXT = new Set(['.app', '.command', '.sh', '.bash', '.zsh', '.tool', '.terminal', '.workflow',
  '.scpt', '.applescript', '.pkg', '.mpkg', '.dmg', '.jar', '.py', '.rb', '.pl', '.js', '.bin', '.exe'])

export function isRunnable(abs: string): boolean {
  if (RUNNABLE_EXT.has(path.extname(abs).toLowerCase())) return true
  const st = stat(abs)
  return !!st && st.isFile() && (st.mode & 0o111) !== 0
}
