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
import { togglePromptHistoryWindow } from '../windows/prompt-history'
import { toggleImageGalleryWindow } from '../windows/image-gallery'
import { showPresetDialog } from '../windows/preset-dialog'
import { addPreset } from './preset-store'
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
export function spawnClaudeSession(bypass: boolean, title?: string, cwd?: string, colorOverride?: string, shellTab?: boolean, existingPtyId?: string, label?: string, shellTabNames?: string[]): void {
  const color = colorOverride || SESSION_COLORS[spawnCount % SESSION_COLORS.length]!
  spawnCount++

  const ptyId = existingPtyId || `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

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

  const win = createTerminalWindow({ color, ptyId, title: displayTitle, shellTab, shellTabNames })

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

    // Restore label and shell tab names from history if reviving
    const session = ptyManager.getByWindowId(win.id)
    if (session) {
      if (label) session.label = label
      if (shellTabNames) session.shellTabNames = shellTabNames
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
    // Save final label/color/shellTabNames to history before destroying
    const session = ptyManager.getByWindowId(win.id)
    if (session) {
      updateHistoryEntry(ptyId, { label: session.label, color: session.color, shellTabNames: session.shellTabNames })
    }
    ptyManager.destroyPty(ptyId)
    // Destroy all shell tabs for this window
    for (const id of ptyManager.getShellPtyIdsByWindowId(win.id)) {
      ptyManager.destroyShellPty(id)
    }

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
    return { color: session.color, ptyId: session.ptyId, shellTabNames: session.shellTabNames }
  })

  // Shell tabs: keystrokes from renderer -> shell PTY (identified by shellPtyId)
  ipcMain.on('terminal:shell-input', (_event, shellPtyId: string, data: string) => {
    ptyManager.writeToShellPty(shellPtyId, data)
  })

  // Shell tabs: resize events
  ipcMain.on('terminal:shell-resize', (_event, shellPtyId: string, cols: number, rows: number) => {
    ptyManager.resizeShellPty(shellPtyId, cols, rows)
  })

  // Create a new shell tab
  ipcMain.handle('terminal:create-shell-tab', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return null
    const shellPtyId = `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    ptyManager.createShellPty({
      ptyId: shellPtyId,
      windowId: win.id,
      cwd: session.cwd,
      cols: 80,
      rows: 24,
    })
    return shellPtyId
  })

  // Close a shell tab
  ipcMain.on('terminal:close-shell-tab', (_event, shellPtyId: string) => {
    ptyManager.destroyShellPty(shellPtyId)
  })

  // Update shell tab names (for persistence on revive)
  ipcMain.on('terminal:shell-tab-names', (event, names: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (session) session.shellTabNames = names
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

  // Toggle prompt history drawer
  ipcMain.on('terminal:toggle-prompthistory', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return
    togglePromptHistoryWindow(win, session.color, session.ptyId)
  })

  // Toggle image gallery drawer
  ipcMain.on('terminal:toggle-imagegallery', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return
    toggleImageGalleryWindow(win, session.ptyId, session.color)
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
    if (typeof url !== 'string') return
    // Strip any trailing ANSI escape codes or whitespace
    const cleaned = url.replace(/[\x1b\u001b]\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x1f]/g, '').trim()
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
      shell.openExternal(cleaned).catch(() => {})
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

  // GitHub context menu (right-click on GitHub sidebar button)
  ipcMain.on('terminal:github-context-menu', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return

    const cwd = session.cwd

    // Gather git info in parallel: remote URL, current branch, and PR status
    const getRemoteUrl = () => new Promise<string | null>((resolve) => {
      exec('git remote get-url origin', { cwd, timeout: 3000 }, (err, stdout) => {
        if (err || !stdout.trim()) { resolve(null); return }
        const raw = stdout.trim()
        const sshMatch = raw.match(/git@github\.com:(.+?)(?:\.git)?$/)
        const httpsMatch = raw.match(/https?:\/\/github\.com\/(.+?)(?:\.git)?$/)
        if (sshMatch) resolve(`https://github.com/${sshMatch[1]}`)
        else if (httpsMatch) resolve(`https://github.com/${httpsMatch[1]}`)
        else resolve(null)
      })
    })

    const getBranch = () => new Promise<string | null>((resolve) => {
      exec('git rev-parse --abbrev-ref HEAD', { cwd, timeout: 3000 }, (err, stdout) => {
        resolve(err ? null : stdout.trim() || null)
      })
    })

    const getPrUrl = () => new Promise<string | null>((resolve) => {
      exec('gh pr view --json url -q .url', { cwd, timeout: 5000 }, (err, stdout) => {
        resolve(err ? null : stdout.trim() || null)
      })
    })

    Promise.all([getRemoteUrl(), getBranch(), getPrUrl()]).then(([repoUrl, branch, prUrl]) => {
      if (!repoUrl) return

      const isDefaultBranch = branch === 'main' || branch === 'master'

      const menuItems: Electron.MenuItemConstructorOptions[] = [
        {
          label: 'Open Repository',
          click: () => shell.openExternal(repoUrl),
        },
      ]

      if (prUrl) {
        menuItems.push({
          label: 'Open Pull Request',
          click: () => shell.openExternal(prUrl),
        })
      }

      if (branch && !isDefaultBranch) {
        menuItems.push({
          label: 'Create Pull Request',
          click: () => shell.openExternal(`${repoUrl}/compare/${encodeURIComponent(branch)}?expand=1`),
        })
      }

      const menu = Menu.buildFromTemplate(menuItems)
      menu.popup({ window: win })
    })
  })

  // Save current session as a preset
  ipcMain.on('terminal:save-as-preset', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const session = ptyManager.getByWindowId(win.id)
    if (!session) return

    const result = await showPresetDialog({
      name: '',
      title: session.title || '',
      folder: session.cwd || '',
      bypass: true,
      color: session.color || '',
      shellTab: (session.shellTabNames?.length ?? 0) > 0,
      shellTabCount: Math.max(1, session.shellTabNames?.length ?? 1),
      shellTabNames: session.shellTabNames || [],
    }, 'new')
    if (result) addPreset(result)
  })

  // Sidebar settings persistence (order + hidden)
  const sidebarSettingsFile = path.join(os.homedir(), '.claude', 'usage-data', 'carapace-sidebar-order.json')

  function loadSidebarSettings(): { order: string[] | null; hidden: string[] } {
    try {
      const data = JSON.parse(fs.readFileSync(sidebarSettingsFile, 'utf-8'))
      // Backwards compat: old format was just an array
      if (Array.isArray(data)) return { order: data, hidden: [] }
      return { order: data.order || null, hidden: data.hidden || [] }
    } catch {
      return { order: null, hidden: [] }
    }
  }

  function saveSidebarSettings(settings: { order: string[] | null; hidden: string[] }): void {
    try {
      fs.mkdirSync(path.dirname(sidebarSettingsFile), { recursive: true })
      fs.writeFileSync(sidebarSettingsFile, JSON.stringify(settings), 'utf-8')
    } catch { /* ignore */ }
  }

  ipcMain.handle('sidebar:get-settings', () => {
    return loadSidebarSettings()
  })

  ipcMain.on('sidebar:save-order', (_event, order: string[]) => {
    const settings = loadSidebarSettings()
    settings.order = order
    saveSidebarSettings(settings)
  })

  ipcMain.on('sidebar:save-hidden', (_event, hidden: string[]) => {
    const settings = loadSidebarSettings()
    settings.hidden = hidden
    saveSidebarSettings(settings)
  })

  // Sidebar visibility context menu
  const sidebarItems = [
    { id: 'notes', label: 'Notes' },
    { id: 'skills', label: 'Slash Commands' },
    { id: 'skillbrowser', label: 'Skills' },
    { id: 'filetree', label: 'File Tree' },
    { id: 'model', label: 'Switch Model' },
    { id: 'github', label: 'GitHub' },
    { id: 'prompthistory', label: 'Prompt History' },
    { id: 'imagegallery', label: 'Image Gallery' },
    { id: 'openfolder', label: 'Open Folder' },
    { id: 'savepreset', label: 'Save as Preset' },
    { id: 'slack', label: 'Share to Slack' },
  ]

  ipcMain.on('sidebar:visibility-menu', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const settings = loadSidebarSettings()
    const hidden = new Set(settings.hidden)

    const menu = Menu.buildFromTemplate(sidebarItems.map(item => ({
      label: item.label,
      type: 'checkbox' as const,
      checked: !hidden.has(item.id),
      click: () => {
        if (hidden.has(item.id)) {
          hidden.delete(item.id)
        } else {
          hidden.add(item.id)
        }
        const newHidden = Array.from(hidden)
        settings.hidden = newHidden
        saveSidebarSettings(settings)
        // Notify the renderer to update visibility
        if (!win.isDestroyed()) {
          win.webContents.send('sidebar:visibility-changed', newHidden)
        }
      },
    })))
    menu.popup({ window: win })
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
