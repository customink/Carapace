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
  /** Output bytes received since bell was armed (since last user input) */
  outputSinceArmed: number
  idleTimer: ReturnType<typeof setTimeout> | null
  /** Timestamp when PTY was created — bell is suppressed during startup */
  createdAt: number
  /** True when Claude is actively generating a response */
  isThinking: boolean
  thinkingTimer: ReturnType<typeof setTimeout> | null
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

const IDLE_THRESHOLD_MS = 4000
const MIN_OUTPUT_AFTER_INPUT = 200 // Minimum output after user input to consider Claude "responded"
const STARTUP_GRACE_MS = 30000 // Ignore bell arming during first 30s (shell init + claude startup + trust prompt)
const SIGNIFICANT_CHUNK_SIZE = 80 // Chunks smaller than this are likely status bar updates (ccstatusline) and won't reset the idle timer

let onAttentionCallback: ((pid: number) => void) | null = null
let onThinkingChangeCallback: ((pid: number, isThinking: boolean) => void) | null = null

export function onAttention(cb: (pid: number) => void): void {
  onAttentionCallback = cb
}

export function onThinkingChange(cb: (pid: number, isThinking: boolean) => void): void {
  onThinkingChangeCallback = cb
}

export function clearAttention(pid: number): void {
  const session = getByPid(pid)
  if (session) {
    session.needsAttention = false
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
    outputSinceArmed: 0,
    idleTimer: null,
    createdAt: Date.now(),
    isThinking: false,
    thinkingTimer: null,
  }

  sessions.set(options.ptyId, session)

  // Disarm bell when user focuses this terminal — they're watching, no need to chime
  const termWin = BrowserWindow.fromId(options.windowId)
  if (termWin) {
    termWin.on('focus', () => {
      session.bellArmed = false
      session.needsAttention = false
      if (session.idleTimer) {
        clearTimeout(session.idleTimer)
        session.idleTimer = null
      }
    })
  }

  // Route PTY output to the renderer
  pty.onData((data) => {
    const win = BrowserWindow.fromId(options.windowId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('terminal:data', data)
    }

    // Only track idle if bell is armed (user has sent input)
    if (!session.bellArmed) return

    session.outputSinceArmed += data.length

    // Only reset the idle timer for significant output chunks.
    // Small chunks (< ~80 bytes) are typically status bar updates from
    // ccstatusline or similar tools — they should NOT prevent the bell
    // from firing after Claude finishes a long response.
    if (data.length >= SIGNIFICANT_CHUNK_SIZE) {
      if (session.idleTimer) {
        clearTimeout(session.idleTimer)
      }

      session.idleTimer = setTimeout(() => {
        // Only ring if Claude produced substantial output after user input
        if (session.outputSinceArmed < MIN_OUTPUT_AFTER_INPUT) return
        const w = BrowserWindow.fromId(options.windowId)
        if (w && !w.isDestroyed() && w.isFocused()) return

        session.needsAttention = true
        session.bellArmed = false // disarm — won't ring again until new user input
        onAttentionCallback?.(session.pid)
      }, IDLE_THRESHOLD_MS)
    }

    // Track thinking state — independent of bell, works even during startup
    if (data.length >= SIGNIFICANT_CHUNK_SIZE) {
      if (session.thinkingTimer) clearTimeout(session.thinkingTimer)
      session.thinkingTimer = setTimeout(() => {
        session.thinkingTimer = null
        if (session.isThinking) {
          session.isThinking = false
          onThinkingChangeCallback?.(session.pid, false)
        }
      }, IDLE_THRESHOLD_MS)
    }
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
  if (isEnter && Date.now() - session.createdAt > STARTUP_GRACE_MS) {
    session.bellArmed = true
    session.outputSinceArmed = 0
    session.needsAttention = false // clear any stale attention
  }

  // Mark as thinking when user sends Enter (works even during startup)
  if (isEnter && !session.isThinking) {
    session.isThinking = true
    onThinkingChangeCallback?.(session.pid, true)
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

  // Route PTY output to the renderer on a separate channel
  pty.onData((data) => {
    const win = BrowserWindow.fromId(options.windowId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('terminal:shell-data', data)
    }
  })

  pty.onExit(({ exitCode }) => {
    const win = BrowserWindow.fromId(options.windowId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('terminal:shell-exit', exitCode)
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

/** Update the color for a session (by PID) */
export function updateColor(pid: number, color: string): void {
  const session = getByPid(pid)
  if (session) session.color = color
}

/** Update the mini-orb label for a session (by PID) */
export function updateLabel(pid: number, label: string): void {
  const session = getByPid(pid)
  if (session) session.label = label
}

function updateDockVisibility(): void {
  if (sessions.size > 0) {
    app.dock?.show()
  } else {
    app.dock?.hide()
  }
}
