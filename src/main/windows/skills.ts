import { BrowserWindow, ipcMain } from 'electron'

/** Map of terminal windowId → skills BrowserWindow */
const skillsWindows = new Map<number, BrowserWindow>()

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  }
}

function tintedBackground(hex: string, tint = 0.08): string {
  const { r, g, b } = hexToRgb(hex)
  const tr = Math.round(r * tint).toString(16).padStart(2, '0')
  const tg = Math.round(g * tint).toString(16).padStart(2, '0')
  const tb = Math.round(b * tint).toString(16).padStart(2, '0')
  return `#${tr}${tg}${tb}`
}

const SKILLS_WIDTH = 300

interface SkillDef {
  command: string
  description: string
  params?: string
}

const SKILLS: SkillDef[] = [
  { command: '/help', description: 'Show help and available commands' },
  { command: '/clear', description: 'Clear conversation history' },
  { command: '/compact', description: 'Compact conversation to save context', params: '[instructions]' },
  { command: '/cost', description: 'Show token usage and cost for this session' },
  { command: '/doctor', description: 'Check Claude Code installation health' },
  { command: '/init', description: 'Initialize project with CLAUDE.md guide' },
  { command: '/login', description: 'Switch accounts or auth method' },
  { command: '/logout', description: 'Sign out from current account' },
  { command: '/memory', description: 'Edit CLAUDE.md memory files' },
  { command: '/model', description: 'Switch Claude model', params: '[model-name]' },
  { command: '/permissions', description: 'View or update tool permissions' },
  { command: '/review', description: 'Review a pull request', params: '[pr-url]' },
  { command: '/status', description: 'Show current session status' },
  { command: '/vim', description: 'Toggle vim mode for input' },
  { command: '/bug', description: 'Report a bug with Claude Code' },
  { command: '/config', description: 'Open or view configuration' },
  { command: '/mcp', description: 'View MCP server status and tools' },
  { command: '/terminal-setup', description: 'Set up terminal key bindings' },
]

export function toggleSkillsWindow(parentWin: BrowserWindow, color: string): boolean {
  const existing = skillsWindows.get(parentWin.id)
  if (existing && !existing.isDestroyed()) {
    existing.close()
    skillsWindows.delete(parentWin.id)
    return false
  }

  const parentBounds = parentWin.getBounds()
  const bgColor = tintedBackground(color, 0.06)
  const channelType = `skills-type-${parentWin.id}`

  const win = new BrowserWindow({
    width: SKILLS_WIDTH,
    height: parentBounds.height,
    x: parentBounds.x - SKILLS_WIDTH,
    y: parentBounds.y,
    frame: false,
    transparent: false,
    backgroundColor: bgColor,
    hasShadow: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  skillsWindows.set(parentWin.id, win)

  // When a skill is clicked, forward the command text to the terminal renderer
  ipcMain.on(channelType, (_e, command: string) => {
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send('terminal:type-command', command)
    }
  })

  // Follow parent
  const updatePosition = () => {
    if (win.isDestroyed()) return
    const b = parentWin.getBounds()
    win.setBounds({
      x: b.x - SKILLS_WIDTH,
      y: b.y,
      width: SKILLS_WIDTH,
      height: b.height,
    })
  }

  parentWin.on('move', updatePosition)
  parentWin.on('resize', updatePosition)
  parentWin.on('minimize', () => { if (!win.isDestroyed()) win.hide() })
  parentWin.on('restore', () => { if (!win.isDestroyed()) win.show() })

  const cleanup = () => {
    ipcMain.removeAllListeners(channelType)
    parentWin.removeListener('move', updatePosition)
    parentWin.removeListener('resize', updatePosition)
    skillsWindows.delete(parentWin.id)
  }

  win.on('closed', () => {
    cleanup()
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send('terminal:skills-closed')
    }
  })

  parentWin.on('closed', () => {
    if (!win.isDestroyed()) win.close()
    cleanup()
  })

  const accentColor = color
  const skillsJson = JSON.stringify(SKILLS)

  const html = `<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    background: ${bgColor};
    overflow: hidden;
  }
  body {
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  }
  #header {
    -webkit-app-region: drag;
    height: 38px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    font-size: 11px;
    font-weight: 600;
    color: rgba(255,255,255,0.55);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: ${tintedBackground(color, 0.1)};
  }
  #search {
    -webkit-app-region: no-drag;
    margin: 8px 10px;
    padding: 6px 10px;
    width: calc(100% - 20px);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    background: rgba(0,0,0,0.25);
    color: rgba(255,255,255,0.9);
    font-size: 12px;
    outline: none;
    font-family: inherit;
  }
  #search:focus { border-color: ${accentColor}60; }
  #search::placeholder { color: rgba(255,255,255,0.2); }
  #list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  #list::-webkit-scrollbar { width: 5px; }
  #list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
  .skill {
    padding: 8px 14px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .skill:hover {
    background: rgba(255,255,255,0.06);
  }
  .skill-cmd {
    font-size: 13px;
    font-weight: 600;
    color: ${accentColor};
    font-family: 'SF Mono', Menlo, monospace;
  }
  .skill-params {
    font-weight: 400;
    color: rgba(255,255,255,0.5);
    margin-left: 4px;
  }
  .skill-desc {
    font-size: 11px;
    color: rgba(255,255,255,0.65);
    margin-top: 2px;
    line-height: 1.3;
  }
  .empty {
    padding: 20px 14px;
    font-size: 12px;
    color: rgba(255,255,255,0.2);
    text-align: center;
  }
</style></head>
<body>
  <div id="header">Slash Commands</div>
  <input id="search" type="text" placeholder="Filter commands..." autofocus />
  <div id="list"></div>
  <script>
    const { ipcRenderer } = require('electron');
    const skills = ${skillsJson};
    const list = document.getElementById('list');
    const search = document.getElementById('search');

    function render(filter) {
      const q = (filter || '').toLowerCase();
      const filtered = skills.filter(s =>
        s.command.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
      list.innerHTML = '';
      if (filtered.length === 0) {
        list.innerHTML = '<div class="empty">No matching commands</div>';
        return;
      }
      for (const s of filtered) {
        const el = document.createElement('div');
        el.className = 'skill';
        const params = s.params ? '<span class="skill-params">' + s.params + '</span>' : '';
        el.innerHTML = '<div class="skill-cmd">' + s.command + params + '</div>'
          + '<div class="skill-desc">' + s.description + '</div>';
        el.addEventListener('click', () => {
          const text = s.params ? s.command + ' ' : s.command;
          ipcRenderer.send('${channelType}', text);
        });
        list.appendChild(el);
      }
    }

    search.addEventListener('input', () => render(search.value));
    render('');

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.close();
    });
  </script>
</body>
</html>`

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  win.once('ready-to-show', () => win.show())

  return true
}

export function isSkillsOpen(windowId: number): boolean {
  const win = skillsWindows.get(windowId)
  return !!win && !win.isDestroyed()
}
