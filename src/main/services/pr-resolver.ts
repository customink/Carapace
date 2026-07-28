import { execFile } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { promisify } from 'util'
import { loadStacks } from './stacks-store'
import { loadHistory } from './session-history'

const execFileAsync = promisify(execFile)

const REPO_MAP_FILE = join(homedir(), '.claude', 'usage-data', 'carapace-repo-map.json')
const WORKTREE_ROOT = join(homedir(), 'carapace-reviews')

/** Hosts we accept PR links from. Anything else is rejected rather than shelled out with. */
const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com'])

const GIT_TIMEOUT_MS = 120_000

export interface ParsedPr {
  owner: string
  repo: string
  number: string
  url: string
}

/**
 * Parses a GitHub PR URL.
 *
 * The input reaches us from a Slack message, so it is untrusted: the host is whitelisted and
 * every captured segment is shape-checked before it can reach a git command.
 */
export function parsePullRequestUrl(input: string): ParsedPr | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null

  const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/)
  if (!match) return null

  const [, owner, repo, number] = match as unknown as [string, string, string, string]
  // Reject path traversal shapes that survive the character class above
  if (owner.startsWith('.') || repo.startsWith('.')) return null

  return {
    owner,
    repo,
    number,
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
  }
}

/**
 * Pulls the first PR link out of a block of text.
 *
 * Handles Slack's `<url|label>` wrapping and trailing punctuation, and tolerates a missing
 * scheme — Slack displays links as `github.com/owner/repo/pull/1`, so selected text usually
 * has no `https://` on it.
 */
export function extractPrUrl(text: string): ParsedPr | null {
  if (!text) return null
  const candidates = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s<>|)\]]+/gi) || []
  for (const raw of candidates) {
    const cleaned = raw.replace(/[.,;:'")\]]+$/, '')
    const withScheme = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`
    const parsed = parsePullRequestUrl(withScheme)
    if (parsed) return parsed
  }
  return null
}

// ---------------------------------------------------------------------------
// repo -> local path
// ---------------------------------------------------------------------------

function loadRepoMap(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(REPO_MAP_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

/** Remembers where a repo lives locally so the next review of it resolves instantly. */
export function rememberRepoPath(owner: string, repo: string, path: string): void {
  const map = loadRepoMap()
  map[`${owner}/${repo}`] = path
  try {
    mkdirSync(join(homedir(), '.claude', 'usage-data'), { recursive: true })
    writeFileSync(REPO_MAP_FILE, JSON.stringify(map, null, 2))
  } catch {
    // non-fatal — resolution just falls back to the stack scan next time
  }
}

/** The repository root containing `path`, or null when it isn't inside a git repo. */
async function gitToplevel(path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', path, 'rev-parse', '--show-toplevel'], {
      timeout: 5000,
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function remoteMatches(path: string, owner: string, repo: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', path, 'remote', 'get-url', 'origin'], {
      timeout: 5000,
    })
    const url = stdout.trim().toLowerCase()
    return url.includes(`${owner.toLowerCase()}/${repo.toLowerCase()}`)
  } catch {
    return false
  }
}

/**
 * Canonicalizes a candidate to its repository root and confirms the remote is the right repo.
 *
 * Canonicalizing matters because most candidates come from directories the engineer happened to
 * be working in, which are often a subdirectory of the clone rather than its root.
 */
async function verify(path: string, owner: string, repo: string): Promise<string | null> {
  const root = await gitToplevel(path)
  if (!root) return null
  return (await remoteMatches(root, owner, repo)) ? root : null
}

/** First candidate that verifies, checking the whole batch concurrently. */
async function firstMatching(paths: string[], owner: string, repo: string): Promise<string | null> {
  if (paths.length === 0) return null
  const checked = await Promise.all(paths.map(path => verify(path, owner, repo)))
  return checked.find(Boolean) || null
}

// --- candidate sources, cheapest first --------------------------------------

/** Paths configured in a Stack. */
function fromStacks(): string[] {
  const paths: string[] = []
  for (const stack of loadStacks()) {
    paths.push(stack.systemPath, ...(stack.projects || []).map(p => p.path))
  }
  return paths
}

/**
 * Directories the engineer has actually run Claude Code in.
 *
 * `~/.claude/projects/` holds one directory per working directory, named by replacing every
 * `/` with `-`. That encoding is lossy — a repo whose own name contains a dash is
 * indistinguishable from a nested path — so rather than decoding the name, we filter by name
 * and then read the real `cwd` out of the transcript. The first few JSONL lines are session
 * metadata; `cwd` appears a little further in.
 */
function fromClaudeProjects(repo: string): string[] {
  const projectsDir = join(homedir(), '.claude', 'projects')
  const needle = `-${repo.toLowerCase()}`
  const paths: string[] = []

  let entries: string[]
  try {
    entries = readdirSync(projectsDir)
  } catch {
    return paths
  }

  for (const entry of entries) {
    if (!entry.toLowerCase().includes(needle)) continue
    try {
      const transcripts = readdirSync(join(projectsDir, entry)).filter(f => f.endsWith('.jsonl'))
      for (const transcript of transcripts.slice(0, 2)) {
        const cwd = readCwdFromTranscript(join(projectsDir, entry, transcript))
        if (cwd) { paths.push(cwd); break }
      }
    } catch {
      // unreadable project dir — skip it
    }
  }
  return paths
}

/** Reads the first `cwd` recorded in a transcript without loading the whole file. */
function readCwdFromTranscript(file: string): string | null {
  try {
    // Transcripts run to megabytes; the cwd shows up within the first handful of lines
    const head = readFileSync(file, 'utf-8').slice(0, 64_000)
    for (const line of head.split('\n').slice(0, 40)) {
      if (!line.includes('"cwd"')) continue
      try {
        const cwd = (JSON.parse(line) as { cwd?: string }).cwd
        if (cwd) return cwd
      } catch {
        // truncated final line — keep looking
      }
    }
  } catch {
    // unreadable
  }
  return null
}

/** Working directories of previous Carapace sessions. */
function fromSessionHistory(): string[] {
  try {
    return loadHistory().map(entry => entry.folder).filter((f): f is string => !!f)
  } catch {
    return []
  }
}

/** `<root>/<repo>` under the usual places people keep code. */
function fromCommonDirs(repo: string): string[] {
  const home = homedir()
  const roots = [
    home,
    join(home, 'dev'), join(home, 'code'), join(home, 'src'),
    join(home, 'repos'), join(home, 'projects'), join(home, 'work'),
    join(home, 'Developer'), join(home, 'Documents', 'GitHub'),
  ]
  return roots.map(root => join(root, repo))
}

/**
 * Anywhere on the disk, via the Spotlight index.
 *
 * Costs roughly 300ms and needs no configuration, which is why it sits after the free sources
 * but before giving up. Skips library and dependency directories, which produce noise for
 * repos whose name matches a package.
 */
async function fromSpotlight(repo: string): Promise<string[]> {
  if (process.platform !== 'darwin') return []
  try {
    const { stdout } = await execFileAsync(
      'mdfind',
      ['-onlyin', homedir(), `kMDItemFSName == '${repo.replace(/'/g, '')}'`],
      { timeout: 8000, maxBuffer: 1024 * 1024 },
    )
    return stdout.split('\n')
      .map(line => line.trim())
      .filter(line => line && !/\/(node_modules|Library|\.Trash|vendor|\.venv)\//.test(line))
      .slice(0, 25)
  } catch {
    return []
  }
}

/**
 * Finds the local clone for a repo without asking the engineer to pick a folder.
 *
 * Repos are nearly always already cloned, so this works through progressively broader sources
 * and stops at the first one whose git remote actually matches — a same-named clone from a
 * different org is rejected rather than silently reviewed:
 *
 *   1. a path remembered from a previous review        (instant)
 *   2. directories Claude Code has been run in        (reads a few transcript lines)
 *   3. previous Carapace session working directories  (one JSON file)
 *   4. paths configured in a Stack                    (already in memory)
 *   5. `<repo>` under ~, ~/dev, ~/code, …             (existsSync)
 *   6. the Spotlight index                            (~300ms)
 *
 * Returns null only when every source comes up empty, and the dialog then asks. Each candidate
 * costs a couple of git calls, so a tier's candidates run concurrently — one stale or
 * network-mounted path would otherwise burn its whole 5s timeout before the next was tried.
 * Callers should not block their UI on this; `startReviewFlow` hands the promise to the dialog.
 */
export async function resolveRepoPath(owner: string, repo: string): Promise<string | null> {
  const mapped = loadRepoMap()[`${owner}/${repo}`]
  if (mapped && existsSync(mapped)) return mapped

  const tiers: (() => string[] | Promise<string[]>)[] = [
    () => fromClaudeProjects(repo),
    () => fromSessionHistory(),
    () => fromStacks(),
    () => fromCommonDirs(repo),
    () => fromSpotlight(repo),
  ]

  const seen = new Set<string>()
  const isNameMatch = (p: string) => basename(p).toLowerCase() === repo.toLowerCase()

  for (const tier of tiers) {
    const candidates = (await tier())
      .filter(path => {
        if (!path || seen.has(path)) return false
        seen.add(path)
        // Never resolve to a review worktree — it's a checkout of the right repo, but reviewing
        // from inside a previous review's worktree is not what anyone means.
        if (path === WORKTREE_ROOT || path.startsWith(`${WORKTREE_ROOT}/`)) return false
        return existsSync(path)
      })

    // Prefer a directory actually named after the repo before falling back to subdirectories
    const found =
      (await firstMatching(candidates.filter(isNameMatch), owner, repo)) ||
      (await firstMatching(candidates.filter(p => !isNameMatch(p)), owner, repo))

    if (found) {
      rememberRepoPath(owner, repo, found)
      return found
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// worktree
// ---------------------------------------------------------------------------

export interface WorktreeResult {
  path: string
  branch: string
}

function worktreePathFor(repo: string, number: string): string {
  return join(WORKTREE_ROOT, `${repo}-pr${number}`)
}

/**
 * Checks the PR out into its own git worktree so reviewing never disturbs whatever the
 * engineer currently has checked out.
 *
 * Uses `refs/pull/N/head` rather than `gh pr checkout` so this works without the gh CLI, and
 * covers PRs from forks. Throws with git's stderr on failure; the caller surfaces it.
 */
export async function prepareWorktree(repoPath: string, pr: ParsedPr): Promise<WorktreeResult> {
  const branch = `carapace-review/pr-${pr.number}`
  const wtPath = worktreePathFor(pr.repo, pr.number)
  const refspec = `pull/${pr.number}/head`

  mkdirSync(WORKTREE_ROOT, { recursive: true })

  const git = (args: string[], cwd: string) =>
    execFileAsync('git', ['-C', cwd, ...args], { timeout: GIT_TIMEOUT_MS })

  if (existsSync(wtPath)) {
    // Reuse an existing worktree, refreshing it to the current PR head
    await git(['fetch', 'origin', refspec, '--force'], wtPath)
    await git(['reset', '--hard', 'FETCH_HEAD'], wtPath)
    return { path: wtPath, branch }
  }

  await git(['fetch', 'origin', `${refspec}:${branch}`, '--force'], repoPath)
  await git(['worktree', 'add', '--force', wtPath, branch], repoPath)
  return { path: wtPath, branch }
}

/** True when the path is inside a git repository. */
export async function isGitRepo(path: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', path, 'rev-parse', '--git-dir'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}
