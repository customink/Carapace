import { ipcMain, BrowserWindow, app, shell, Menu } from 'electron'
import { exec } from 'child_process'
import { SESSION_COLORS } from '@shared/constants/colors'
import { createTerminalWindow } from '../windows/terminal'
import { getOrbWindow } from '../windows/orb'
import { toggleNotesWindow } from '../windows/notes'
import { toggleSkillsWindow } from '../windows/skills'
import { toggleSkillBrowserWindow } from '../windows/skill-browser'
import { toggleModelSelectorWindow } from '../windows/model-selector'
import { toggleFileTreeWindow } from '../windows/file-tree'
import { IPC_CHANNELS } from '../ipc/channels'
import { recordSession, updateHistoryEntry } from './session-history'
import { discoverSessionsAsync, invalidateCache } from './session-discovery'
import * as ptyManager from './pty-manager'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

let spawnCount = 0

/**
 * Spawn a new Claude Code session in an embedded Electron terminal window.
 * Uses xterm.js + node-pty for a fully controlled terminal experience.
 */
export function spawnClaudeSession(bypass: boolean, title?: string, cwd?: string, colorOverride?: string, shellTab?: boolean, existingPtyId?: string, label?: string): void {
  const color = colorOverride || SESSION_COLORS[spawnCount % SESSION_COLORS.length]!
  spawnCount++

  const ptyId = existingPtyId || `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const shellPtyId = shellTab ? `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : undefined

  const displayTitle = title || 'Claude Code'

  // Record in history for "Revive Recent Session"
  recordSession({
    title: title || '',
    folder: cwd || '',
    bypass,
    shellTab: !!shellTab,
    ptyId,
    startTime: new Date().toISOString(),
    color,
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

    // Restore label from history if reviving
    if (label) {
      const session = ptyManager.getByWindowId(win.id)
      if (session) session.label = label
    }

    if (shellTab && shellPtyId) {
      ptyManager.createShellPty({
        ptyId: shellPtyId,
        windowId: win.id,
        cwd,
        cols: 80,
        rows: 24,
      })
    }

    // Immediately broadcast updated sessions so the orb shows the new mini-orb
    invalidateCache()
    discoverSessionsAsync().then(sessions => {
      const orb = getOrbWindow()
      if (orb && !orb.isDestroyed()) {
        orb.webContents.send(IPC_CHANNELS.SESSIONS_UPDATED, sessions)
      }
    })
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

  // When window is closed by user, save state, clean up PTY(s), and update orb
  win.on('closed', () => {
    // Save final label/color to history before destroying
    const session = ptyManager.getByWindowId(win.id)
    if (session) {
      updateHistoryEntry(ptyId, { label: session.label, color: session.color })
    }
    ptyManager.destroyPty(ptyId)
    if (shellPtyId) ptyManager.destroyShellPty(shellPtyId)

    invalidateCache()
    discoverSessionsAsync().then(sessions => {
      const orb = getOrbWindow()
      if (orb && !orb.isDestroyed()) {
        orb.webContents.send(IPC_CHANNELS.SESSIONS_UPDATED, sessions)
      }
    })
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

  // Right-click context menu for terminal
  ipcMain.on('terminal:context-menu', (event, hasSelection: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const menu = Menu.buildFromTemplate([
      {
        label: 'Copy',
        role: 'copy',
        enabled: hasSelection,
      },
      {
        label: 'Paste',
        role: 'paste',
      },
      { type: 'separator' },
      {
        label: 'Select All',
        role: 'selectAll',
      },
      { type: 'separator' },
      {
        label: 'Clear Terminal',
        click: () => {
          const session = ptyManager.getByWindowId(win.id)
          if (session) ptyManager.writeToPty(session.ptyId, 'clear\n')
        },
      },
    ])
    menu.popup({ window: win })
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

  // Toggle file tree drawer
  ipcMain.on('terminal:toggle-filetree', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return
    toggleFileTreeWindow(win, session.color, session.cwd)
  })

  // Toggle model selector drawer
  ipcMain.on('terminal:toggle-modelselector', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return
    toggleModelSelectorWindow(win, session.color)
  })

  // Get GitHub remote URL for the session's working directory
  ipcMain.handle('terminal:github-url', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return null

    return new Promise<string | null>((resolve) => {
      exec('git remote get-url origin', { cwd: session.cwd, timeout: 3000 }, (err, stdout) => {
        if (err || !stdout.trim()) { resolve(null); return }
        const url = stdout.trim()
        // Convert git@github.com:user/repo.git or https://github.com/user/repo.git to browser URL
        let browserUrl: string | null = null
        const sshMatch = url.match(/git@github\.com:(.+?)(?:\.git)?$/)
        const httpsMatch = url.match(/https?:\/\/github\.com\/(.+?)(?:\.git)?$/)
        if (sshMatch) {
          browserUrl = `https://github.com/${sshMatch[1]}`
        } else if (httpsMatch) {
          browserUrl = `https://github.com/${httpsMatch[1]}`
        }
        resolve(browserUrl)
      })
    })
  })

  // Open URL in default browser
  ipcMain.on('terminal:open-external', (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url)
    }
  })

  // Open GitHub repo in browser
  ipcMain.on('terminal:open-github', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return

    exec('git remote get-url origin', { cwd: session.cwd, timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) return
      const url = stdout.trim()
      let browserUrl: string | null = null
      const sshMatch = url.match(/git@github\.com:(.+?)(?:\.git)?$/)
      const httpsMatch = url.match(/https?:\/\/github\.com\/(.+?)(?:\.git)?$/)
      if (sshMatch) {
        browserUrl = `https://github.com/${sshMatch[1]}`
      } else if (httpsMatch) {
        browserUrl = `https://github.com/${httpsMatch[1]}`
      }
      if (browserUrl) shell.openExternal(browserUrl)
    })
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
