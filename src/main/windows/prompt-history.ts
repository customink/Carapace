import { BrowserWindow, ipcMain } from 'electron'
import { loadPromptHistory } from '../services/prompt-history'

const historyWindows = new Map<number, BrowserWindow>()

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

export function togglePromptHistoryWindow(parentWin: BrowserWindow, color: string, ptyId: string): boolean {
  const existing = historyWindows.get(parentWin.id)
  if (existing && !existing.isDestroyed()) {
    existing.close()
    historyWindows.delete(parentWin.id)
    return false
  }

  const parentBounds = parentWin.getBounds()
  const bgColor = tintedBackground(color, 0.06)
  const channelType = `prompthistory-type-${parentWin.id}`

  const prompts = loadPromptHistory(ptyId)

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

  historyWindows.set(parentWin.id, win)

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
    historyWindows.delete(parentWin.id)
  }

  win.on('closed', () => {
    cleanup()
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send('terminal:prompthistory-closed')
    }
  })

  parentWin.on('closed', () => {
    if (!win.isDestroyed()) win.close()
    cleanup()
  })

  const accentColor = color
  const promptsJson = JSON.stringify(prompts)

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
  #list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
    -webkit-app-region: no-drag;
  }
  #list::-webkit-scrollbar { width: 5px; }
  #list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
  .prompt-item {
    padding: 8px 14px;
    cursor: pointer;
    transition: background 0.1s;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .prompt-item:hover { background: rgba(255,255,255,0.06); }
  .prompt-item:active { background: ${accentColor}30; }
  .prompt-text {
    font-size: 12px;
    color: rgba(255,255,255,0.8);
    font-family: 'SF Mono', Menlo, monospace;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .prompt-num {
    font-size: 10px;
    color: rgba(255,255,255,0.25);
    margin-bottom: 3px;
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
  <div id="header">Prompt History</div>
  <div id="list"></div>
  <script>
    const { ipcRenderer } = require('electron');
    const prompts = ${promptsJson};
    const list = document.getElementById('list');

    if (prompts.length === 0) {
      list.innerHTML = '<div class="empty">No prompts yet.<br>Send a prompt in the terminal to see it here.</div>';
    } else {
      for (let i = 0; i < prompts.length; i++) {
        const el = document.createElement('div');
        el.className = 'prompt-item';
        const num = document.createElement('div');
        num.className = 'prompt-num';
        num.textContent = '#' + (i + 1);
        const text = document.createElement('div');
        text.className = 'prompt-text';
        text.textContent = prompts[i];
        el.appendChild(num);
        el.appendChild(text);
        el.addEventListener('click', () => {
          ipcRenderer.send('${channelType}', prompts[i]);
        });
        list.appendChild(el);
      }
    }

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
