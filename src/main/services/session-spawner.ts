import { ipcMain, BrowserWindow, app, shell } from 'electron'
import { SESSION_COLORS } from '@shared/constants/colors'
import { createTerminalWindow } from '../windows/terminal'
import { getOrbWindow } from '../windows/orb'
import { toggleNotesWindow } from '../windows/notes'
import { toggleSkillsWindow } from '../windows/skills'
import { toggleSkillBrowserWindow } from '../windows/skill-browser'
import { toggleModelSelectorWindow } from '../windows/model-selector'
import { IPC_CHANNELS } from '../ipc/channels'
import { recordSession } from './session-history'
import { formatEffortLevel } from '@shared/utils/format'
import { SETTINGS_FILE } from '@shared/constants/paths'
import * as ptyManager from './pty-manager'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

let spawnCount = 0

/**
 * Spawn a new Claude Code session in an embedded Electron terminal window.
 * Uses xterm.js + node-pty for a fully controlled terminal experience.
 */
export function spawnClaudeSession(bypass: boolean, title?: string, cwd?: string, colorOverride?: string, shellTab?: boolean, existingPtyId?: string): void {
  const color = colorOverride || SESSION_COLORS[spawnCount % SESSION_COLORS.length]!
  spawnCount++

  const ptyId = existingPtyId || `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const shellPtyId = shellTab ? `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : undefined

  // Read effort level from Claude settings
  let effortLevel = 'default'
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
    if (settings.effortLevel) effortLevel = settings.effortLevel
  } catch { /* use default */ }

  // Build display title: [Title] - [Effort] (model added later when detected)
  const baseTitle = title || 'Claude Code'
  const displayTitle = `${baseTitle} - ${formatEffortLevel(effortLevel)}`

  // Record in history for "Revive Recent Session"
  recordSession({
    title: title || '',
    folder: cwd || '',
    bypass,
    shellTab: !!shellTab,
    ptyId,
    startTime: new Date().toISOString(),
  })

  // Ensure dock is visible so terminal windows can show
  app.dock?.show()

  const win = createTerminalWindow({ color, ptyId, title: displayTitle, shellTab })

  // Wait for the renderer to be ready, then create the PTY(s)
  win.webContents.once('did-finish-load', () => {
    ptyManager.createPty({
      ptyId,
      windowId: win.id,
      color,
      bypass,
      cwd,
      cols: 80,
      rows: 24,
      title,
    })

    if (shellTab && shellPtyId) {
      ptyManager.createShellPty({
        ptyId: shellPtyId,
        windowId: win.id,
        cwd,
        cols: 80,
        rows: 24,
      })
    }
  })

  // Clear attention bell when user focuses the terminal window directly
  win.on('focus', () => {
    const session = ptyManager.getByWindowId(win.id)
    if (session && session.needsAttention) {
      ptyManager.clearAttention(session.pid)
      const orb = getOrbWindow()
      if (orb && !orb.isDestroyed()) {
        orb.webContents.send(IPC_CHANNELS.SESSION_ATTENTION_CLEAR, session.pid)
      }
    }
  })

  // When window is closed by user, clean up PTY(s)
  win.on('closed', () => {
    ptyManager.destroyPty(ptyId)
    if (shellPtyId) ptyManager.destroyShellPty(shellPtyId)
  })
}

/**
 * Register IPC handlers for terminal communication.
 * Called once from main index.ts.
 */
export function registerTerminalIpc(): void {
  // Keystrokes from renderer -> PTY
  ipcMain.on('terminal:input', (event, data: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (session) ptyManager.writeToPty(session.ptyId, data)
  })

  // Resize events from renderer -> PTY
  ipcMain.on('terminal:resize', (event, cols: number, rows: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (session) ptyManager.resizePty(session.ptyId, cols, rows)
  })

  // Session info request from renderer
  ipcMain.handle('terminal:session-info', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return null
    return { color: session.color, ptyId: session.ptyId }
  })

  // Shell tab: keystrokes from renderer -> shell PTY
  ipcMain.on('terminal:shell-input', (event, data: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getShellByWindowId(win.id)
    if (session) ptyManager.writeToShellPty(session.ptyId, data)
  })

  // Shell tab: resize events
  ipcMain.on('terminal:shell-resize', (event, cols: number, rows: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getShellByWindowId(win.id)
    if (session) ptyManager.resizeShellPty(session.ptyId, cols, rows)
  })

  // Toggle notes floating window
  ipcMain.on('terminal:toggle-notes', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return
    toggleNotesWindow(win, session.ptyId, session.color)
  })

  // Open session folder in Finder
  ipcMain.on('terminal:open-folder', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (session) shell.openPath(session.cwd)
  })

  // Toggle skills floating window (built-in slash commands)
  ipcMain.on('terminal:toggle-skills', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return
    toggleSkillsWindow(win, session.color)
  })

  // Toggle skill browser floating window (user/plugin skills)
  ipcMain.on('terminal:toggle-skillbrowser', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return
    toggleSkillBrowserWindow(win, session.color, session.cwd)
  })

  // Toggle model selector drawer
  ipcMain.on('terminal:toggle-modelselector', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return
    toggleModelSelectorWindow(win, session.color)
  })

  // Save clipboard image to temp file and return the path
  ipcMain.handle('terminal:save-clipboard-image', (_event, buffer: Buffer) => {
    const tmpDir = path.join(os.tmpdir(), 'carapace-images')
    fs.mkdirSync(tmpDir, { recursive: true })
    const filePath = path.join(tmpDir, `clipboard-${Date.now()}.png`)
    fs.writeFileSync(filePath, buffer)
    return filePath
  })
}
