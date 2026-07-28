import { execFile } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { promisify } from 'util'
import { loadStacks } from './stacks-store'

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

/** Returns the first path whose git remote matches, checking the whole batch concurrently. */
async function firstMatching(paths: string[], owner: string, repo: string): Promise<string | null> {
  if (paths.length === 0) return null
  const checked = await Promise.all(
    paths.map(async path => ((await remoteMatches(path, owner, repo)) ? path : null))
  )
  return checked.find(Boolean) || null
}

/**
 * Finds the local clone for a repo: remembered mapping first, then any path configured in a
 * Stack. Returns null when we can't tell — the dialog then asks rather than guessing.
 *
 * Each candidate costs a `git remote get-url`, so they run concurrently rather than in
 * sequence — a stale or network-mounted stack path would otherwise burn its full 5s timeout
 * before the next one is even tried. Callers should not block their UI on this; see how
 * startReviewFlow hands the promise to the dialog instead of awaiting it.
 */
export async function resolveRepoPath(owner: string, repo: string): Promise<string | null> {
  const mapped = loadRepoMap()[`${owner}/${repo}`]
  if (mapped && existsSync(mapped)) return mapped

  const seen = new Set<string>()
  const candidates: string[] = []
  for (const stack of loadStacks()) {
    for (const path of [stack.systemPath, ...(stack.projects || []).map(p => p.path)]) {
      if (!path || seen.has(path)) continue
      seen.add(path)
      if (existsSync(path)) candidates.push(path)
    }
  }

  // Prefer a path whose basename matches the repo, but verify against the git remote so two
  // repos with the same name in different orgs don't collide.
  const isNameMatch = (p: string) => basename(p).toLowerCase() === repo.toLowerCase()
  const found =
    (await firstMatching(candidates.filter(isNameMatch), owner, repo)) ||
    (await firstMatching(candidates.filter(p => !isNameMatch(p)), owner, repo))

  if (found) rememberRepoPath(owner, repo, found)
  return found
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
