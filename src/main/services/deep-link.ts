import { dialog, Notification } from 'electron'
import { existsSync } from 'fs'
import { showReviewDialog, type ReviewDialogResult, type PrepareResult } from '../windows/review-dialog'
import { showQuickPromptDialog } from '../windows/quick-prompt-dialog'
import { renderTemplate, appendSlackContext, getQuickPreset, setQuickPreset } from './review-preset-store'
import { spawnWithPrompt } from './spawn-with-prompt'
import {
  parsePullRequestUrl,
  extractPrUrl,
  resolveRepoPath,
  rememberRepoPath,
  prepareWorktree,
  isGitRepo,
  type ParsedPr,
} from './pr-resolver'

/** Deep links that arrived before the app was ready. Drained by flushDeepLinks(). */
const pending: string[] = []
let ready = false

/**
 * Buffers a `carapace://` URL.
 *
 * On a cold launch macOS delivers `open-url` before `app.whenReady()` resolves, so links that
 * start the app have to be held until the windows exist. See the listener in index.ts.
 */
/** Runs a deep link, reporting failures instead of dropping them on the floor. */
function dispatch(url: string): void {
  console.log('[deeplink] handling', url)
  handleDeepLink(url).catch((err: Error) => {
    console.error('[deeplink] failed:', err?.stack || err)
    dialog.showErrorBox('Carapace', `Could not handle that link:\n\n${err?.message || err}`)
  })
}

export function queueDeepLink(url: string): void {
  if (ready) {
    dispatch(url)
    return
  }
  console.log('[deeplink] queued until ready', url)
  pending.push(url)
}

export function flushDeepLinks(): void {
  ready = true
  while (pending.length) dispatch(pending.shift()!)
}

async function handleDeepLink(rawUrl: string): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return
  }
  if (url.protocol !== 'carapace:') return

  // carapace://review?... parses as host="review"; tolerate carapace:///review too
  const action = (url.hostname || url.pathname.replace(/^\/+/, '')).toLowerCase()

  if (action === 'review') {
    await handleReview(url.searchParams)
    return
  }

  if (action === 'quick-prompt') {
    await editQuickPrompt()
    return
  }

  dialog.showErrorBox('Carapace', `Unknown deep link action: ${action || '(none)'}`)
}

/** Slack message text may be passed base64url-encoded to survive URL transport. */
function decodeMessage(value: string): string {
  if (!value) return ''
  if (/^[A-Za-z0-9_-]+={0,2}$/.test(value) && value.length > 8) {
    try {
      const decoded = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
      // Reject mojibake — if it didn't decode to sane text, treat it as plain
      if (decoded && !/�/.test(decoded)) return decoded
    } catch {
      // fall through
    }
  }
  return value
}

async function handleReview(params: URLSearchParams): Promise<void> {
  const slackMessage = decodeMessage(params.get('msg') || '')
  const slackPermalink = params.get('permalink') || ''
  const requestedPreset = params.get('preset') || ''

  const prParam = params.get('pr') || params.get('url') || ''
  const pr = parsePullRequestUrl(prParam) || extractPrUrl(prParam) || extractPrUrl(slackMessage)

  if (!pr) {
    dialog.showErrorBox(
      'Carapace — No pull request found',
      'That link didn\'t contain a GitHub pull request URL.\n\n' +
      'Expected something like https://github.com/owner/repo/pull/123'
    )
    return
  }

  if (params.get('quick') === '1') {
    await startQuickReview(pr)
    return
  }

  await startReviewFlow(pr, slackMessage, slackPermalink, requestedPreset)
}

/** Opens the editor for the prompt that quick review runs. */
export async function editQuickPrompt(): Promise<void> {
  console.log('[deeplink] opening quick prompt editor')
  const result = await showQuickPromptDialog()
  console.log('[deeplink] quick prompt editor closed:', result ? 'saved' : 'cancelled')
  if (result) setQuickPreset(result.presetId, result.template, result.bypass)
}

function notify(body: string): void {
  new Notification({ title: 'Carapace', body }).show()
}

/**
 * Reviews a PR with no dialog: renders the quick preset, checks the PR out, and spawns.
 *
 * Safe to skip the human review step here because the only external input is the PR URL —
 * host-whitelisted and shape-checked — with no quoted message text interpolated into the
 * prompt. Permissions are skipped only if the quick preset opts in (checkbox in the quick
 * prompt editor); the diff itself is still untrusted content, so that defaults off.
 *
 * Falls back to the full dialog when the local clone can't be found, since that needs an answer.
 */
export async function startQuickReview(pr: ParsedPr): Promise<void> {
  const preset = getQuickPreset()
  if (!preset) {
    await startReviewFlow(pr)
    return
  }

  const repoPath = await resolveRepoPath(pr.owner, pr.repo)
  if (!repoPath) {
    notify(`No local clone of ${pr.repo} yet — pick it once.`)
    await startReviewFlow(pr)
    return
  }

  const prompt = renderTemplate(preset.template, {
    pr_url: pr.url,
    owner: pr.owner,
    repo: pr.repo,
    pr_number: pr.number,
    branch: `carapace-review/pr-${pr.number}`,
  })

  let cwd = repoPath
  if (preset.worktree) {
    notify(`Checking out ${pr.repo} #${pr.number}…`)
    try {
      const { path } = await prepareWorktree(repoPath, pr)
      cwd = path
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr
      dialog.showErrorBox(
        `Couldn't check out PR #${pr.number}`,
        (stderr || (err as Error).message || 'git failed').trim()
      )
      return
    }
  }

  spawnWithPrompt({
    prompt,
    cwd,
    title: `Review ${pr.repo} #${pr.number}`,
    bypass: !!preset.bypass,
  })
}

/**
 * Shows the review dialog and, once the human approves the prompt, checks the PR out and
 * spawns the session. Shared by the deep link and the "Review PR from clipboard" menu item.
 */
export async function startReviewFlow(
  pr: ParsedPr,
  slackMessage = '',
  slackPermalink = '',
  requestedPreset = '',
): Promise<void> {
  // Kick off the clone lookup but don't await it — the dialog opens now and fills the path
  // when this settles, so a slow or stale stack path can't stall the window.
  const repoPath = resolveRepoPath(pr.owner, pr.repo).then(path => path || '')

  const render = (template: string): string => {
    const hasPlaceholder = /\{\{\s*slack_message\s*\}\}/.test(template)
    const rendered = renderTemplate(template, {
      pr_url: pr.url,
      owner: pr.owner,
      repo: pr.repo,
      pr_number: pr.number,
      branch: `carapace-review/pr-${pr.number}`,
      slack_permalink: slackPermalink,
      slack_message: slackMessage,
    })
    return hasPlaceholder ? rendered : appendSlackContext(rendered, slackMessage, slackPermalink)
  }

  const prepare = async (result: ReviewDialogResult): Promise<PrepareResult> => {
    const repo = result.cwd
    if (!existsSync(repo)) return { ok: false, error: `No such directory: ${repo}` }
    if (!(await isGitRepo(repo))) return { ok: false, error: `${repo} is not a git repository.` }

    rememberRepoPath(pr.owner, pr.repo, repo)

    if (!result.worktree) return { ok: true, cwd: repo }

    try {
      const { path } = await prepareWorktree(repo, pr)
      return { ok: true, cwd: path }
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr
      const message = (stderr || (err as Error).message || 'git failed').trim().split('\n').slice(-2).join(' ')
      return { ok: false, error: `Couldn't check out PR #${pr.number}: ${message}` }
    }
  }

  const result = await showReviewDialog({
    pr,
    repoPath,
    slackMessage,
    requestedPreset,
    render,
    prepare,
  })

  if (!result) return

  spawnWithPrompt({
    prompt: result.prompt,
    cwd: result.cwd,
    title: `Review ${pr.repo} #${pr.number}`,
    bypass: result.bypass,
  })
}
