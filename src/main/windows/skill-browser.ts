import { BrowserWindow, ipcMain } from 'electron'
import { discoverSkills } from '../services/skill-discovery'

/** Map of terminal windowId → skill-browser BrowserWindow */
const browserWindows = new Map<number, BrowserWindow>()

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

const PANEL_WIDTH = 320

export function toggleSkillBrowserWindow(parentWin: BrowserWindow, color: string, projectPath?: string): boolean {
  const existing = browserWindows.get(parentWin.id)
  if (existing && !existing.isDestroyed()) {
    existing.close()
    browserWindows.delete(parentWin.id)
    return false
  }

  const parentBounds = parentWin.getBounds()
  const bgColor = tintedBackground(color, 0.06)
  const channelType = `skillbrowser-type-${parentWin.id}`

  // Discover skills dynamically
  const skills = discoverSkills(projectPath)

  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: parentBounds.height,
    x: parentBounds.x - PANEL_WIDTH,
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

  browserWindows.set(parentWin.id, win)

  ipcMain.on(channelType, (_e, command: string) => {
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send('terminal:type-command', command)
    }
  })

  const updatePosition = () => {
    if (win.isDestroyed()) return
    const b = parentWin.getBounds()
    win.setBounds({
      x: b.x - PANEL_WIDTH,
      y: b.y,
      width: PANEL_WIDTH,
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
    browserWindows.delete(parentWin.id)
  }

  win.on('closed', () => {
    cleanup()
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send('terminal:skillbrowser-closed')
    }
  })

  parentWin.on('closed', () => {
    if (!win.isDestroyed()) win.close()
    cleanup()
  })

  const accentColor = color
  const skillsJson = JSON.stringify(skills)

  const sourceLabels: Record<string, string> = {
    user: 'User',
    plugin: 'Plugin',
    project: 'Project',
  }

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
  .skill-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .skill-cmd {
    font-size: 13px;
    font-weight: 600;
    color: ${accentColor};
    font-family: 'SF Mono', Menlo, monospace;
  }
  .skill-badge {
    font-size: 9px;
    font-weight: 600;
    color: rgba(255,255,255,0.55);
    background: rgba(255,255,255,0.08);
    padding: 1px 5px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .skill-desc {
    font-size: 11px;
    color: rgba(255,255,255,0.65);
    margin-top: 3px;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .empty {
    padding: 24px 14px;
    font-size: 12px;
    color: rgba(255,255,255,0.2);
    text-align: center;
    line-height: 1.5;
  }
</style></head>
<body>
  <div id="header">Skills</div>
  <input id="search" type="text" placeholder="Filter skills..." autofocus />
  <div id="list"></div>
  <script>
    const { ipcRenderer } = require('electron');
    const skills = ${skillsJson};
    const sourceLabels = ${JSON.stringify(sourceLabels)};
    const list = document.getElementById('list');
    const search = document.getElementById('search');

    function render(filter) {
      const q = (filter || '').toLowerCase();
      const filtered = skills.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
      list.innerHTML = '';
      if (filtered.length === 0) {
        list.innerHTML = '<div class="empty">No matching skills found</div>';
        return;
      }
      for (const s of filtered) {
        const el = document.createElement('div');
        el.className = 'skill';
        const badge = sourceLabels[s.source] || s.source;
        el.innerHTML =
          '<div class="skill-top">' +
            '<span class="skill-cmd">' + s.command + '</span>' +
            '<span class="skill-badge">' + badge + '</span>' +
          '</div>' +
          (s.description ? '<div class="skill-desc">' + escHtml(s.description) + '</div>' : '');
        el.addEventListener('click', () => {
          ipcRenderer.send('${channelType}', s.command + ' ');
        });
        list.appendChild(el);
      }
    }

    function escHtml(str) {
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
