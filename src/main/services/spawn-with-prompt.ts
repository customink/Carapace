import { app } from 'electron'
import { spawnClaudeSession } from './session-spawner'
import { ensureTrustAccepted } from './claude-config'
import { resetDockIcon } from './icon-generator'
import * as ptyManager from './pty-manager'

/** Max time to wait for Claude's prompt to appear before injecting anyway. */
const MAX_WAIT_MS = 30_000

/** Grace period after the ready signal — Claude needs a beat before it accepts input. */
const INJECT_DELAY_MS = 500

/**
 * Gap between typing the prompt and pressing Enter.
 *
 * Claude Code treats a bulk multi-line write as pasted text, so a `\r` appended to the same
 * write is swallowed as one more newline in the buffer — the prompt sits there unsent. Enter
 * has to arrive as its own keystroke, after the paste has settled.
 */
const SUBMIT_DELAY_MS = 400

export interface SpawnWithPromptOptions {
  /** Prompt injected once Claude is ready to accept input. */
  prompt: string
  cwd?: string
  title?: string
  color?: string
  bypass?: boolean
  shellTabNames?: string[]
  addDirs?: string[]
  /** Value for `claude --model`; omitted means the CLI default. */
  model?: string
  /** Spawn hidden (scheduled runs). Defaults to false. */
  background?: boolean
  /**
   * Show the window on the first assistant response. Defaults to `background` — a hidden
   * session surfaces when it has something to say, a visible one is already up.
   */
  bringToFrontOnFirstResponse?: boolean
}

/**
 * Spawns a Claude session and types a prompt into it once the CLI is ready.
 *
 * Getting this right is fiddlier than it looks, which is why it lives in one place:
 *   1. the trust dialog must be pre-accepted or it swallows the prompt
 *   2. the PTY is created asynchronously inside the window's `did-finish-load`, so we have
 *      to poll `getByPtyId()` before we can attach an interceptor
 *   3. Claude is only ready when its status line appears — a fixed delay races startup on a
 *      cold machine, so we watch for `Cost:` in the PTY output and keep a 30s backstop
 *
 * Used by the scheduler and by Slack-triggered PR reviews.
 */
export function spawnWithPrompt(opts: SpawnWithPromptOptions): { ptyId: string; win: Electron.BrowserWindow } {
  const background = !!opts.background
  const bringToFront = opts.bringToFrontOnFirstResponse ?? background

  // Pre-accept the trust dialog so it won't block the injected prompt
  ensureTrustAccepted()

  const shellTabNames = opts.shellTabNames
  const { ptyId, win } = spawnClaudeSession(
    !!opts.bypass,
    opts.title,
    opts.cwd,
    opts.color,
    !!(shellTabNames && shellTabNames.length > 0),
    undefined,
    undefined,
    shellTabNames,
    background,
    undefined,
    opts.addDirs,
    opts.model,
  )

  // Show dock now that a terminal exists, with the orb icon
  app.dock?.show()
  resetDockIcon()

  let promptInjected = false

  const maxTimer = setTimeout(() => {
    if (!promptInjected) injectPrompt()
  }, MAX_WAIT_MS)

  function injectPrompt(): void {
    if (promptInjected) return
    promptInjected = true
    clearTimeout(maxTimer)
    ptyManager.setDataInterceptor(ptyId, null)
    if (win.isDestroyed()) return

    setTimeout(() => {
      if (win.isDestroyed()) return
      ptyManager.writeToPty(ptyId, opts.prompt)

      // Enter must be its own write — see SUBMIT_DELAY_MS
      setTimeout(() => {
        if (win.isDestroyed()) return
        ptyManager.writeToPty(ptyId, '\r')
        const session = ptyManager.getByPtyId(ptyId)
        if (session && bringToFront) session.scheduledBringToFront = true
      }, SUBMIT_DELAY_MS)
    }, INJECT_DELAY_MS)
  }

  // The PTY is created async after the renderer loads — wait for it before intercepting
  function waitForPtyAndSetup(): void {
    if (win.isDestroyed()) { clearTimeout(maxTimer); return }
    if (!ptyManager.getByPtyId(ptyId)) {
      setTimeout(waitForPtyAndSetup, 500)
      return
    }
    setupInterceptor()
  }
  waitForPtyAndSetup()

  function setupInterceptor(): void {
    let rawBuffer = ''
    ptyManager.setDataInterceptor(ptyId, (data) => {
      if (win.isDestroyed()) return
      rawBuffer += data

      // Strip ANSI sequences for matching
      const stripped = rawBuffer
        .replace(/\x1b\[[^\x40-\x7e]*[\x40-\x7e]/g, '')
        .replace(/\x1b\][^\x07]*\x07/g, '')
        .replace(/\x1b[^[]/g, '')
        .replace(/[\x00-\x1f]/g, ' ')

      // Claude ready: the "Cost:" status line appears after full init
      if (!promptInjected && stripped.toLowerCase().includes('cost:')) {
        injectPrompt()
      }
    })
  }

  return { ptyId, win }
}
