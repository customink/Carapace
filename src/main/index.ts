import { app, ipcMain, Menu, BrowserWindow, screen } from 'electron'
import { registerIpcHandlers, startSessionMonitor, stopSessionMonitor } from './ipc/handlers'
import { IPC_CHANNELS } from './ipc/channels'
import { createOrbWindow, getOrbWindow } from './windows/orb'
import { spawnClaudeSession, registerTerminalIpc } from './services/session-spawner'
import { focusSessionTerminal } from './services/terminal-focus'
import * as ptyManager from './services/pty-manager'
import { showSessionOptionsDialog } from './windows/prompt'
import { loadHistory, copyNotes } from './services/session-history'
import { addPrompt as addPromptToHistory, copyPromptHistory } from './services/prompt-history'
import { loadSnippets, addSnippet, updateSnippet, deleteSnippet } from './services/snippet-store'
import { showSnippetDialog } from './windows/snippet-dialog'
import { loadPresets, addPreset, updatePreset, deletePreset } from './services/preset-store'
import { showPresetDialog } from './windows/preset-dialog'
import { loadAppSettings, saveAppSettings } from './services/app-settings-store'
import { showSettingsWindow } from './windows/settings'
import { showSlackComposeDialog } from './windows/slack-compose'
import { getLastAssistantResponse } from './services/jsonl-parser'
import { detectActiveProcesses } from './services/process-detector'
import { getCachedSessions, invalidateCache, discoverSessionsAsync } from './services/session-discovery'
import { SESSION_COLORS } from '@shared/constants/colors'

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

  // Save user prompts to history
  ptyManager.onPromptSubmit((ptyId, prompt) => {
    addPromptToHistory(ptyId, prompt)
  })

  // Notify orb when a session starts/stops thinking
  ptyManager.onThinkingChange((pid, isThinking) => {
    const orb = getOrbWindow()
    if (orb && !orb.isDestroyed()) {
      orb.webContents.send(IPC_CHANNELS.SESSION_THINKING, pid, isThinking)
    }
  })

  createOrbWindow()

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

    const refreshOrb = () => {
      invalidateCache()
      discoverSessionsAsync().then(sessions => {
        const orb = getOrbWindow()
        if (orb && !orb.isDestroyed()) {
          orb.webContents.send(IPC_CHANNELS.SESSIONS_UPDATED, sessions)
        }
      })
    }

    const session = ptyManager.getByPid(pid)
    const currentLabel = session?.label || ''

    // Letters A-Z
    const letterItems: Electron.MenuItemConstructorOptions[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(ch => ({
      label: ch,
      type: 'radio' as const,
      checked: currentLabel === ch,
      click: () => { ptyManager.updateLabel(pid, ch); refreshOrb() }
    }))

    // Emoji picker — opens a small dialog with native macOS emoji panel
    const showEmojiPicker = () => {
      const channelOk = `emoji-ok-${Date.now()}`
      const channelCancel = `emoji-cancel-${Date.now()}`
      const pickerWin = new BrowserWindow({
        width: 340,
        height: 80,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        transparent: false,
        backgroundColor: '#1a1a2e',
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
      })

      const html = `<!DOCTYPE html>
<html><head><style>
  body { margin:0; padding:12px 16px; background:#1a1a2e; display:flex; align-items:center; gap:8px; font-family:-apple-system,sans-serif; }
  input { width:60px; font-size:24px; padding:6px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.15);
    background:rgba(255,255,255,0.08); color:#fff; outline:none; text-align:center; }
  input:focus { border-color:rgba(255,255,255,0.3); }
  button { padding:6px 14px; border-radius:8px; border:none; background:#7C3AED; color:#fff;
    font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; }
  button:hover { background:#6D28D9; }
  button.cancel { background:rgba(255,255,255,0.1); }
  button.cancel:hover { background:rgba(255,255,255,0.18); }
  button:disabled { opacity:0.3; cursor:default; }
</style></head><body>
  <input id="e" placeholder="?" autofocus />
  <button id="ok" disabled>Save</button>
  <button class="cancel" id="x">Cancel</button>
  <script>
    const {ipcRenderer} = require('electron');
    const input = document.getElementById('e');
    const btn = document.getElementById('ok');
    function updateBtn() { btn.disabled = !input.value.trim(); }
    function submit() {
      const val = input.value.trim();
      if (val) ipcRenderer.send('${channelOk}', val);
    }
    // input event + polling fallback (macOS emoji picker uses IME which may skip input events)
    input.addEventListener('input', updateBtn);
    setInterval(updateBtn, 200);
    btn.addEventListener('click', submit);
    document.getElementById('x').addEventListener('click', () => ipcRenderer.send('${channelCancel}'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); submit(); }
      if (e.key === 'Escape') ipcRenderer.send('${channelCancel}');
    });
  </script>
</body></html>`

      pickerWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

      pickerWin.webContents.once('did-finish-load', () => {
        app.showEmojiPanel()
      })

      let resolved = false
      const cleanup = () => {
        if (resolved) return
        resolved = true
        ipcMain.removeAllListeners(channelOk)
        ipcMain.removeAllListeners(channelCancel)
      }

      ipcMain.once(channelOk, (_e: Electron.IpcMainEvent, emoji: string) => {
        cleanup()
        if (!pickerWin.isDestroyed()) pickerWin.close()
        if (emoji) {
          ptyManager.updateLabel(pid, emoji)
          refreshOrb()
        }
      })

      ipcMain.once(channelCancel, () => {
        cleanup()
        if (!pickerWin.isDestroyed()) pickerWin.close()
      })

      pickerWin.on('closed', cleanup)
    }

    // Color options
    const colorNames: Record<string, string> = {
      '#3B6EE8': 'Blue', '#10B981': 'Green', '#F97316': 'Orange',
      '#E879F9': 'Fuchsia', '#06B6D4': 'Cyan', '#F43F5E': 'Rose',
      '#A78BFA': 'Violet', '#FBBF24': 'Amber', '#14B8A6': 'Teal',
      '#FB7185': 'Coral',
    }
    const currentColor = session?.color || ''
    const colorItems: Electron.MenuItemConstructorOptions[] = (SESSION_COLORS as readonly string[]).map((c: string) => ({
      label: colorNames[c] || c,
      type: 'radio' as const,
      checked: currentColor === c,
      click: () => {
        ptyManager.updateColor(pid, c)
        // Also update the terminal window tint
        if (session) {
          const termWin = BrowserWindow.fromId(session.windowId)
          if (termWin && !termWin.isDestroyed()) {
            termWin.webContents.send('terminal:color-updated', c)
          }
        }
        refreshOrb()
      }
    }))

    const menu = Menu.buildFromTemplate([
      {
        label: 'Focus Terminal',
        click: () => focusSessionTerminal(pid)
      },
      { type: 'separator' },
      {
        label: 'Set Letter',
        submenu: [
          {
            label: 'Default',
            type: 'radio',
            checked: currentLabel === '' || (currentLabel.length === 1 && !/[A-Z]/.test(currentLabel)),
            click: () => { ptyManager.updateLabel(pid, ''); refreshOrb() }
          },
          { type: 'separator' },
          ...letterItems,
        ]
      },
      {
        label: 'Set Emoji...',
        click: showEmojiPicker
      },
      {
        label: 'Clear Emoji',
        enabled: currentLabel.length > 1 || /\p{Emoji}/u.test(currentLabel),
        click: () => { ptyManager.updateLabel(pid, ''); refreshOrb() }
      },
      {
        label: 'Change Color',
        submenu: colorItems,
      },
      { type: 'separator' },
      {
        label: 'Close Session',
        click: () => {
          if (session) {
            ptyManager.destroyPty(session.ptyId)
          } else {
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
        const presets = loadPresets()
        if (presets.length === 0) {
          return {
            label: 'Presets',
            submenu: [
              { label: '(No presets)', enabled: false },
              { type: 'separator' as const },
              {
                label: 'New Preset...',
                click: async () => {
                  const result = await showPresetDialog()
                  if (result) addPreset(result)
                }
              },
            ]
          }
        }
        return {
          label: 'Presets',
          submenu: [
            ...presets.map((preset) => ({
              label: preset.name,
              click: () => {
                // Build shellTabNames array: if user wants N tabs, create N entries
                // so the renderer creates N shell tabs on startup
                let shellTabNames: string[] | undefined
                if (preset.shellTab) {
                  const count = Math.max(1, preset.shellTabCount)
                  shellTabNames = []
                  for (let i = 0; i < count; i++) {
                    shellTabNames.push(preset.shellTabNames[i] || '')
                  }
                }
                spawnClaudeSession(
                  preset.bypass,
                  preset.title || undefined,
                  preset.folder || undefined,
                  preset.color || undefined,
                  preset.shellTab || (shellTabNames && shellTabNames.length > 0),
                  undefined, // no existing ptyId
                  undefined, // no label
                  shellTabNames,
                )
              }
            })),
            { type: 'separator' as const },
            {
              label: 'New Preset...',
              click: async () => {
                const result = await showPresetDialog()
                if (result) addPreset(result)
              }
            },
            {
              label: 'Manage Presets...',
              submenu: presets.map((preset) => ({
                label: preset.name,
                submenu: [
                  {
                    label: 'Edit...',
                    click: async () => {
                      const result = await showPresetDialog({
                        name: preset.name,
                        title: preset.title,
                        folder: preset.folder,
                        bypass: preset.bypass,
                        color: preset.color,
                        shellTab: preset.shellTab,
                        shellTabCount: preset.shellTabCount,
                        shellTabNames: preset.shellTabNames,
                      })
                      if (result) updatePreset(preset.id, result)
                    }
                  },
                  {
                    label: 'Delete',
                    click: () => { deletePreset(preset.id) }
                  }
                ]
              }))
            },
          ]
        }
      })(),
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
            const prefix = entry.label ? `${entry.label} ` : ''
            const label = entry.title
              ? `${prefix}${entry.title} — ${dateStr} ${timeStr}`
              : `${prefix}${entry.folder || 'Home'} — ${dateStr} ${timeStr}`
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
                copyPromptHistory(entry.ptyId, newPtyId)
                spawnClaudeSession(
                  entry.bypass,
                  entry.title || undefined,
                  entry.folder || undefined,
                  entry.color || undefined,
                  entry.shellTab || (entry.shellTabNames && entry.shellTabNames.length > 0),
                  newPtyId,
                  entry.label || undefined,
                  entry.shellTabNames || undefined,
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

  // ─── Presets ───
  ipcMain.handle(IPC_CHANNELS.PRESETS_LIST, () => loadPresets())

  ipcMain.handle(IPC_CHANNELS.PRESET_CREATE, async (_e, preset: Omit<import('@shared/types/preset').Preset, 'id'>) => {
    return addPreset(preset)
  })

  ipcMain.handle(IPC_CHANNELS.PRESET_UPDATE, async (_e, id: string, updates: Omit<import('@shared/types/preset').Preset, 'id'>) => {
    return updatePreset(id, updates)
  })

  ipcMain.handle(IPC_CHANNELS.PRESET_DELETE, async (_e, id: string) => {
    return deletePreset(id)
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
        label: 'Edit...',
        click: async () => {
          const result = await showSnippetDialog({ icon: snippet.icon, label: snippet.label, prompt: snippet.prompt })
          if (result) {
            const updated = updateSnippet(id, result.icon, result.label, result.prompt)
            for (const win of BrowserWindow.getAllWindows()) {
              win.webContents.send(IPC_CHANNELS.SNIPPETS_UPDATED, updated)
            }
          }
        }
      },
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

  // ─── Slack compose ───
  ipcMain.on(IPC_CHANNELS.SLACK_COMPOSE, async (event) => {
    // Find the terminal window that sent this
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow) return

    // Look up the PTY session for this window
    const session = ptyManager.getByWindowId(senderWindow.id)
    let lastResponse = '(No Claude response found in this session)'

    if (session) {
      // Find transcript file for this session's PID
      const processes = await detectActiveProcesses()
      const proc = processes.find(p => p.pid === session.pid || p.ppid === session.pid)
      if (proc?.transcriptFile) {
        const response = getLastAssistantResponse(proc.transcriptFile)
        if (response) lastResponse = response
      }
    }

    showSlackComposeDialog(lastResponse)
  })

  app.on('activate', () => {
    if (!getOrbWindow()) createOrbWindow()
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
