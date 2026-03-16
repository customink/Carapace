import { BrowserWindow, app } from 'electron'
import { execSync } from 'child_process'
import type { IPty } from 'node-pty'

export interface PtySession {
  ptyId: string
  pty: IPty
  windowId: number
  color: string
  pid: number
  /** User-given session title from the options dialog */
  title: string
  /** Custom label for mini-orb (single letter or emoji). Empty = use default initial */
  label: string
  /** Working directory */
  cwd: string
  /** Visual bell indicator on mini orb — cleared on focus */
  needsAttention: boolean
  /** Bell arms only after user sends input to the PTY */
  bellArmed: boolean
  /** Timestamp when PTY was created — bell is suppressed during startup */
  createdAt: number
  /** True when Claude is actively generating a response */
  isThinking: boolean
  thinkingTimer: ReturnType<typeof setTimeout> | null
  /** Absolute max timer — force clears thinking after MAX_THINKING_MS */
  maxThinkingTimer: ReturnType<typeof setTimeout> | null
  /** Buffer for accumulating user keystrokes before Enter */
  inputBuffer: string
  /** Shell tab names for persistence on revive */
  shellTabNames?: string[]
}

const sessions = new Map<string, PtySession>()

/** Companion shell PTYs — plain shell tabs, no Claude, no bell tracking */
export interface ShellPtySession {
  ptyId: string
  pty: IPty
  windowId: number
  pid: number
}

const shellSessions = new Map<string, ShellPtySession>()

const IDLE_THRESHOLD_MS = 15000  // Fallback: clear spinner 15s after Enter if JSONL hasn't cleared it
const MAX_THINKING_MS = 300000  // Absolute max: 5 minutes (reset by each JSONL tool_use event)
const STARTUP_GRACE_MS = 8000  // Ignore bell arming during first 8s (shell init + claude startup)

let onAttentionCallback: ((pid: number) => void) | null = null
let onThinkingChangeCallback: ((pid: number, isThinking: boolean) => void) | null = null
let onPromptSubmitCallback: ((ptyId: string, prompt: string) => void) | null = null
let onSessionsChangedCallback: (() => void) | null = null

export function onAttention(cb: (pid: number) => void): void {
  onAttentionCallback = cb
}

export function onThinkingChange(cb: (pid: number, isThinking: boolean) => void): void {
  onThinkingChangeCallback = cb
}

export function onPromptSubmit(cb: (ptyId: string, prompt: string) => void): void {
  onPromptSubmitCallback = cb
}

export function onSessionsChanged(cb: () => void): void {
  onSessionsChangedCallback = cb
}

function notifySessionsChanged(): void {
  if (onSessionsChangedCallback) onSessionsChangedCallback()
}

export function clearAttention(pid: number): void {
  const session = getByPid(pid)
  if (session) {
    session.needsAttention = false
  }
}

/**
 * Fire the bell for a session if conditions are met:
 * - Bell must be armed (user sent input since last bell)
 * - Terminal window must not be focused
 * Called from handlers.ts when JSONL completion count increments.
 */
export function fireBell(pid: number): void {
  const session = getByPid(pid)
  if (!session || !session.bellArmed) return

  const w = BrowserWindow.fromId(session.windowId)
  if (w && !w.isDestroyed() && !w.isFocused()) {
    session.needsAttention = true
    onAttentionCallback?.(session.pid)
  }
  session.bellArmed = false
}

/**
 * Clear thinking state for a session.
 * Called from handlers.ts when JSONL shows end_turn,
 * and from the idle-timeout fallback in onData.
 * Does NOT fire the bell — bell is only fired from handlers.ts
 * on end_turn completion to avoid false triggers during tool_use pauses.
 */
export function clearThinking(pid: number): void {
  const session = getByPid(pid)
  if (!session || !session.isThinking) return

  if (session.thinkingTimer) {
    clearTimeout(session.thinkingTimer)
    session.thinkingTimer = null
  }
  if (session.maxThinkingTimer) {
    clearTimeout(session.maxThinkingTimer)
    session.maxThinkingTimer = null
  }
  session.isThinking = false
  onThinkingChangeCallback?.(session.pid, false)
}

/**
 * Re-arm thinking state for a session.
 * Called from handlers.ts when JSONL shows tool_use stop_reason,
 * indicating Claude is still actively working even if the idle timeout cleared the spinner.
 */
export function rearmThinking(pid: number): void {
  const session = getByPid(pid)
  if (!session) return

  // Cancel any pending timers
  if (session.thinkingTimer) {
    clearTimeout(session.thinkingTimer)
    session.thinkingTimer = null
  }
  if (session.maxThinkingTimer) {
    clearTimeout(session.maxThinkingTimer)
    session.maxThinkingTimer = null
  }

  // Restart idle timer
  session.thinkingTimer = setTimeout(() => {
    session.thinkingTimer = null
    clearThinking(session.pid)
  }, IDLE_THRESHOLD_MS)

  // Restart max timer (tool_use means Claude is still working — give it another 60s)
  session.maxThinkingTimer = setTimeout(() => {
    session.maxThinkingTimer = null
    clearThinking(session.pid)
  }, MAX_THINKING_MS)

  if (!session.isThinking) {
    session.isThinking = true
    onThinkingChangeCallback?.(session.pid, true)
  }
}

let cachedClaudePath: string | null = null

function findClaudePath(): string {
  if (cachedClaudePath) return cachedClaudePath
  try {
    cachedClaudePath = execSync('which claude', { encoding: 'utf-8', timeout: 3000 }).trim()
    return cachedClaudePath
  } catch {
    const paths = [
      `${process.env.HOME}/.local/bin/claude`,
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude'
    ]
    for (const p of paths) {
      try {
        execSync(`test -x "${p}"`, { timeout: 1000 })
        cachedClaudePath = p
        return p
      } catch { /* skip */ }
    }
    return 'claude'
  }
}

export function createPty(options: {
  ptyId: string
  windowId: number
  color: string
  bypass: boolean
  cwd?: string
  cols: number
  rows: number
  title?: string
}): PtySession {
  // Require node-pty at runtime (native module, externalized from bundle)
  const nodePty = require('node-pty') as typeof import('node-pty')

  const claudePath = findClaudePath()
  const flags = options.bypass ? ' --dangerously-skip-permissions' : ''

  // Resolve the user's default shell
  const shell = process.env.SHELL || '/bin/zsh'

  // Build clean env: inherit process.env but remove Claude Code nesting detection
  const env = { ...process.env } as Record<string, string>
  delete env['CLAUDECODE']
  env['TERM'] = 'xterm-256color'
  env['COLORTERM'] = 'truecolor'

  // Use interactive login shell, then send the exec command after shell init
  const pty = nodePty.spawn(shell, ['-l', '-i'], {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd || process.env.HOME || '/',
    env,
  })

  // After shell initializes, exec into Claude
  setTimeout(() => {
    pty.write(`exec ${claudePath}${flags}\r`)
  }, 500)

  const session: PtySession = {
    ptyId: options.ptyId,
    pty,
    windowId: options.windowId,
    color: options.color,
    pid: pty.pid,
    title: options.title || '',
    label: '',
    cwd: options.cwd || process.env.HOME || '/',
    needsAttention: false,
    bellArmed: false,
    createdAt: Date.now(),
    isThinking: false,
    thinkingTimer: null,
    maxThinkingTimer: null,
    inputBuffer: '',
  }

  sessions.set(options.ptyId, session)
  notifySessionsChanged()

  // Disarm bell when user focuses this terminal — they're watching, no need to chime
  const termWin = BrowserWindow.fromId(options.windowId)
  if (termWin) {
    termWin.on('focus', () => {
      session.bellArmed = false
      session.needsAttention = false
    })
  }

  // Route PTY output to the renderer
  pty.onData((data) => {
    const win = BrowserWindow.fromId(options.windowId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('terminal:data', data)
    }

    // PTY output does NOT reset the idle timer. Claude Code's status line
    // contains real text (model names, token counts) that is indistinguishable
    // from actual response text, so any PTY-based reset defeats the timer.
    // The idle timer fires purely based on elapsed time since Enter was pressed.
    // JSONL events are the primary mechanism: end_turn clears immediately,
    // tool_use resets both timers via rearmThinking().
  })

  // When PTY exits, notify renderer and close window
  pty.onExit(({ exitCode }) => {
    const win = BrowserWindow.fromId(options.windowId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('terminal:exit', exitCode)
      setTimeout(() => {
        if (!win.isDestroyed()) win.close()
      }, 500)
    }
    sessions.delete(options.ptyId)
    updateDockVisibility()
    notifySessionsChanged()
  })

  updateDockVisibility()
  return session
}

export function writeToPty(ptyId: string, data: string): void {
  const session = sessions.get(ptyId)
  if (!session) return

  // Only arm the bell when the user submits a real command (Enter key).
  // Reject: startup period, escape sequence responses (xterm query replies),
  // Shift+Enter (\x1b[13;2u), and bare \r with no visible content.
  const isEnter = data.includes('\r') && !data.includes('\x1b')

  // Buffer keystrokes for prompt history
  if (isEnter) {
    const prompt = session.inputBuffer.trim()
    if (prompt && Date.now() - session.createdAt > STARTUP_GRACE_MS) {
      onPromptSubmitCallback?.(session.ptyId, prompt)
    }
    session.inputBuffer = ''
  } else if (data === '\x7f') {
    // Backspace — remove last character
    session.inputBuffer = session.inputBuffer.slice(0, -1)
  } else if (!data.includes('\x1b') && data.length > 0) {
    session.inputBuffer += data
  }

  if (isEnter && Date.now() - session.createdAt > STARTUP_GRACE_MS) {
    session.bellArmed = true
    session.needsAttention = false // clear any stale attention
  }

  // Mark as thinking when user sends Enter — skip startup grace period
  // (Enter during startup is for CLI prompts like "trust this folder", not Claude conversations)
  if (isEnter && !session.isThinking && Date.now() - session.createdAt > STARTUP_GRACE_MS) {
    session.isThinking = true
    onThinkingChangeCallback?.(session.pid, true)

    // Start idle timer immediately (don't wait for PTY output)
    session.thinkingTimer = setTimeout(() => {
      session.thinkingTimer = null
      clearThinking(session.pid)
    }, IDLE_THRESHOLD_MS)

    // Absolute max timer — force clear if JSONL detection fails completely
    session.maxThinkingTimer = setTimeout(() => {
      session.maxThinkingTimer = null
      clearThinking(session.pid)
    }, MAX_THINKING_MS)
  }

  session.pty.write(data)
}

export function resizePty(ptyId: string, cols: number, rows: number): void {
  sessions.get(ptyId)?.pty.resize(cols, rows)
}

export function destroyPty(ptyId: string): void {
  const session = sessions.get(ptyId)
  if (session) {
    session.pty.kill()
    sessions.delete(ptyId)
    updateDockVisibility()
    notifySessionsChanged()
  }
}

export function getByWindowId(windowId: number): PtySession | undefined {
  for (const session of sessions.values()) {
    if (session.windowId === windowId) return session
  }
  return undefined
}

export function getByPid(pid: number): PtySession | undefined {
  for (const session of sessions.values()) {
    if (session.pid === pid) return session
  }
  return undefined
}

/** Create a companion shell PTY (plain shell, no Claude, no bell tracking) */
export function createShellPty(options: {
  ptyId: string
  windowId: number
  cwd?: string
  cols: number
  rows: number
}): ShellPtySession {
  const nodePty = require('node-pty') as typeof import('node-pty')
  const shell = process.env.SHELL || '/bin/zsh'

  const env = { ...process.env } as Record<string, string>
  env['TERM'] = 'xterm-256color'
  env['COLORTERM'] = 'truecolor'

  const pty = nodePty.spawn(shell, ['-l', '-i'], {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd || process.env.HOME || '/',
    env,
  })

  const session: ShellPtySession = {
    ptyId: options.ptyId,
    pty,
    windowId: options.windowId,
    pid: pty.pid,
  }

  shellSessions.set(options.ptyId, session)

  // Route PTY output to the renderer, tagged with shellPtyId
  pty.onData((data) => {
    const win = BrowserWindow.fromId(options.windowId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('terminal:shell-data', options.ptyId, data)
    }
  })

  pty.onExit(({ exitCode }) => {
    const win = BrowserWindow.fromId(options.windowId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('terminal:shell-exit', options.ptyId, exitCode)
    }
    shellSessions.delete(options.ptyId)
  })

  return session
}

export function writeToShellPty(ptyId: string, data: string): void {
  shellSessions.get(ptyId)?.pty.write(data)
}

export function resizeShellPty(ptyId: string, cols: number, rows: number): void {
  shellSessions.get(ptyId)?.pty.resize(cols, rows)
}

export function destroyShellPty(ptyId: string): void {
  const session = shellSessions.get(ptyId)
  if (session) {
    session.pty.kill()
    shellSessions.delete(ptyId)
  }
}

export function getShellByWindowId(windowId: number): ShellPtySession | undefined {
  for (const session of shellSessions.values()) {
    if (session.windowId === windowId) return session
  }
  return undefined
}

export function getShellPtyIdsByWindowId(windowId: number): string[] {
  const ids: string[] = []
  for (const session of shellSessions.values()) {
    if (session.windowId === windowId) ids.push(session.ptyId)
  }
  return ids
}

export function destroyAll(): void {
  for (const session of sessions.values()) {
    session.pty.kill()
  }
  sessions.clear()
  for (const session of shellSessions.values()) {
    session.pty.kill()
  }
  shellSessions.clear()
}

export function getActiveCount(): number {
  return sessions.size
}

/** Get all active session window IDs */
export function getAllWindowIds(): number[] {
  return Array.from(sessions.values()).map(s => s.windowId)
}

/** Get all active PTY sessions */
export function getAllSessions(): PtySession[] {
  return Array.from(sessions.values())
}

/** Update the color for a session (by PID) */
export function updateColor(pid: number, color: string): void {
  const session = getByPid(pid)
  if (session) { session.color = color; notifySessionsChanged() }
}

/** Update the mini-orb label for a session (by PID) */
export function updateLabel(pid: number, label: string): void {
  const session = getByPid(pid)
  if (session) { session.label = label; notifySessionsChanged() }
}

/** Find all PTY sessions whose CWD encodes to the given project dir name */
export function getByEncodedCwd(encodedDir: string): PtySession[] {
  const results: PtySession[] = []
  for (const session of sessions.values()) {
    const encoded = session.cwd.replace(/\//g, '-')
    if (encoded === encodedDir) results.push(session)
  }
  return results
}


function updateDockVisibility(): void {
  if (sessions.size > 0) {
    app.dock?.show()
  } else {
    app.dock?.hide()
  }
}
