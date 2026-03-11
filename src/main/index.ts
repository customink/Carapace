import { app, ipcMain, Menu, BrowserWindow, screen } from 'electron'
import { registerIpcHandlers, startSessionMonitor, stopSessionMonitor } from './ipc/handlers'
import { IPC_CHANNELS } from './ipc/channels'
import { createOrbWindow, getOrbWindow, positionPanelUnderOrb } from './windows/orb'
import { createPanelWindow, getPanelWindow, hidePanel } from './windows/panel'
import { spawnClaudeSession, registerTerminalIpc } from './services/session-spawner'
import { focusSessionTerminal } from './services/terminal-focus'
import * as ptyManager from './services/pty-manager'
import { showSessionOptionsDialog } from './windows/prompt'
import { loadHistory, copyNotes } from './services/session-history'
import { loadSnippets, addSnippet, deleteSnippet } from './services/snippet-store'
import { showSnippetDialog } from './windows/snippet-dialog'
import { loadAppSettings, saveAppSettings } from './services/app-settings-store'
import { showSettingsWindow } from './windows/settings'

app.whenReady().then(() => {
  registerIpcHandlers()
  registerTerminalIpc()
  startSessionMonitor()

  // Play ding and notify orb when a terminal needs attention
  ptyManager.onAttention((pid) => {
    const orb = getOrbWindow()
    if (orb && !orb.isDestroyed()) {
      orb.webContents.send(IPC_CHANNELS.SESSION_ATTENTION, pid)
    }
    // Play chime sound with user-configured settings
    const chimeSettings = loadAppSettings()
    const vol = Math.max(0, Math.min(100, chimeSettings.chimeVolume)) / 100
    const { exec } = require('child_process')
    exec(`afplay "${chimeSettings.chimeSound}" -v ${vol}`)
  })

  createOrbWindow()
  createPanelWindow()

  // Panel blur-to-hide with grace period for orb clicks
  const panel = getPanelWindow()
  if (panel) {
    panel.on('blur', () => {
      setTimeout(() => {
        const orb = getOrbWindow()
        if (orb && orb.isFocused()) return
        const p = getPanelWindow()
        if (p && p.isVisible() && !p.isFocused()) {
          p.hide()
        }
      }, 150)
    })
  }

  // Toggle panel below orb
  ipcMain.on(IPC_CHANNELS.PANEL_TOGGLE, () => {
    const p = getPanelWindow()
    if (!p) return
    if (p.isVisible()) {
      p.hide()
    } else {
      positionPanelUnderOrb()
      p.show()
    }
  })

  ipcMain.on(IPC_CHANNELS.PANEL_HIDE, () => {
    hidePanel()
  })

  // Session creation
  ipcMain.on(IPC_CHANNELS.SESSION_CREATE, () => {
    spawnClaudeSession(false)
  })

  ipcMain.on(IPC_CHANNELS.SESSION_CREATE_BYPASS, () => {
    spawnClaudeSession(true)
  })

  // Focus session terminal
  ipcMain.on(IPC_CHANNELS.SESSION_FOCUS, (_e, pid: number) => {
    if (pid) focusSessionTerminal(pid)
  })

  // Right-click context menu on mini-orb
  ipcMain.on(IPC_CHANNELS.MINI_ORB_CONTEXT_MENU, (_e, pid: number) => {
    if (!pid) return
    const menu = Menu.buildFromTemplate([
      {
        label: 'Focus Terminal',
        click: () => focusSessionTerminal(pid)
      },
      { type: 'separator' },
      {
        label: 'Close Session',
        click: () => {
          const session = ptyManager.getByPid(pid)
          if (session) {
            ptyManager.destroyPty(session.ptyId)
          } else {
            // External session — kill the process directly
            try {
              process.kill(pid, 'SIGTERM')
            } catch { /* already dead */ }
          }
        }
      }
    ])
    menu.popup()
  })

  // Right-click context menu on orb
  ipcMain.on(IPC_CHANNELS.ORB_CONTEXT_MENU, () => {
    const menu = Menu.buildFromTemplate([
      {
        label: 'New Session',
        click: () => spawnClaudeSession(false)
      },
      {
        label: 'New Session (Skip Permissions)',
        click: () => spawnClaudeSession(true)
      },
      {
        label: 'New Session with Options...',
        click: async () => {
          const opts = await showSessionOptionsDialog()
          if (opts) spawnClaudeSession(opts.bypass, opts.title || undefined, opts.folder || undefined, opts.color || undefined, opts.shellTab)
        }
      },
      (() => {
        const history = loadHistory()
        if (history.length === 0) {
          return {
            label: 'Revive Recent Session',
            enabled: false,
          }
        }
        return {
          label: 'Revive Recent Session',
          submenu: history.map((entry) => {
            const d = new Date(entry.startTime)
            const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
            const label = entry.title
              ? `${entry.title} — ${dateStr} ${timeStr}`
              : `${entry.folder || 'Home'} — ${dateStr} ${timeStr}`
            return {
              label,
              click: () => {
                // spawnClaudeSession returns the ptyId indirectly;
                // we need to copy notes before spawning so the new ptyId gets them.
                // Since spawnClaudeSession generates the ptyId internally, we pass a
                // revive callback via a pre-spawn hook approach.
                // Simpler: spawn, then copy notes using the history's ptyId as source.
                const newPtyId = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                copyNotes(entry.ptyId, newPtyId)
                spawnClaudeSession(
                  entry.bypass,
                  entry.title || undefined,
                  entry.folder || undefined,
                  undefined,
                  entry.shellTab,
                  newPtyId,
                )
              }
            }
          })
        }
      })(),
      { type: 'separator' },
      {
        label: 'Arrange Terminals',
        click: () => {
          const windowIds = ptyManager.getAllWindowIds()
          if (windowIds.length === 0) return

          const workArea = screen.getPrimaryDisplay().workArea
          const count = windowIds.length
          const cols = Math.min(count, 6)
          const rows = Math.ceil(count / cols)
          const GAP = 4
          const cellW = Math.floor((workArea.width - GAP * (cols + 1)) / cols)
          const cellH = Math.floor((workArea.height - GAP * (rows + 1)) / rows)

          windowIds.forEach((wid, i) => {
            const win = BrowserWindow.fromId(wid)
            if (!win || win.isDestroyed()) return
            const col = i % cols
            const row = Math.floor(i / cols)
            const x = workArea.x + GAP + col * (cellW + GAP)
            const y = workArea.y + GAP + row * (cellH + GAP)
            win.setBounds({ x, y, width: cellW, height: cellH })
            win.show()
          })
        }
      },
      {
        label: 'Show Sessions',
        click: () => {
          const p = getPanelWindow()
          if (p) {
            positionPanelUnderOrb()
            p.show()
          }
        }
      },
      {
        label: 'Settings...',
        click: async () => {
          const result = await showSettingsWindow()
          if (result) {
            saveAppSettings({ chimeSound: result.chimeSound, chimeVolume: result.chimeVolume })
            if (result.clearHistory) {
              const fs = require('fs')
              const path = require('path')
              const os = require('os')
              const historyFile = path.join(os.homedir(), '.claude', 'usage-data', 'carapace-session-history.json')
              try { fs.writeFileSync(historyFile, '[]') } catch { /* ok */ }
            }
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit()
      }
    ])
    const orb = getOrbWindow()
    if (orb) {
      menu.popup({ window: orb })
    }
  })

  // ─── Snippets ───
  ipcMain.handle(IPC_CHANNELS.SNIPPETS_LIST, () => loadSnippets())

  ipcMain.on(IPC_CHANNELS.SNIPPET_DIALOG, async () => {
    console.log('[snippets] dialog requested')
    const result = await showSnippetDialog()
    console.log('[snippets] dialog result:', result)
    if (result) {
      const snippets = addSnippet(result.icon, result.label, result.prompt)
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC_CHANNELS.SNIPPETS_UPDATED, snippets)
      }
    }
  })

  ipcMain.on(IPC_CHANNELS.SNIPPET_CONTEXT_MENU, (_e, id: string) => {
    const allSnippets = loadSnippets()
    const snippet = allSnippets.find(s => s.id === id)
    if (!snippet) return

    const menu = Menu.buildFromTemplate([
      { label: snippet.label, enabled: false },
      { type: 'separator' },
      {
        label: 'Delete',
        click: () => {
          const updated = deleteSnippet(id)
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC_CHANNELS.SNIPPETS_UPDATED, updated)
          }
        }
      }
    ])
    menu.popup()
  })

  app.on('activate', () => {
    if (!getOrbWindow()) createOrbWindow()
    if (!getPanelWindow()) createPanelWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopSessionMonitor()
  ptyManager.destroyAll()
})

// Hide dock icon since this is a panel/accessory app
app.dock?.hide()
