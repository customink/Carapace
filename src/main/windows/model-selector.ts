import { BrowserWindow, ipcMain } from 'electron'

/** Map of terminal windowId → model-selector BrowserWindow */
const modelWindows = new Map<number, BrowserWindow>()

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

const PANEL_WIDTH = 300

interface ModelDef {
  id: string
  name: string
  description: string
  tier: string
}

const MODELS: ModelDef[] = [
  { id: 'claude-opus-4-6', name: 'Opus 4.6', description: 'Most capable, best for complex tasks', tier: 'highest' },
  { id: 'opus', name: 'Opus (latest)', description: 'Alias for the latest Opus model', tier: 'highest' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', description: 'Balanced speed and capability', tier: 'mid' },
  { id: 'sonnet', name: 'Sonnet (latest)', description: 'Alias for the latest Sonnet model', tier: 'mid' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', description: 'Fastest and most compact', tier: 'low' },
  { id: 'haiku', name: 'Haiku (latest)', description: 'Alias for the latest Haiku model', tier: 'low' },
]

export function toggleModelSelectorWindow(parentWin: BrowserWindow, color: string): boolean {
  const existing = modelWindows.get(parentWin.id)
  if (existing && !existing.isDestroyed()) {
    existing.close()
    modelWindows.delete(parentWin.id)
    return false
  }

  const parentBounds = parentWin.getBounds()
  const bgColor = tintedBackground(color, 0.06)
  const channelType = `model-type-${parentWin.id}`

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

  modelWindows.set(parentWin.id, win)

  // When a model is selected, forward the /model command to the terminal
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
    modelWindows.delete(parentWin.id)
  }

  win.on('closed', () => {
    cleanup()
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send('terminal:modelselector-closed')
    }
  })

  parentWin.on('closed', () => {
    if (!win.isDestroyed()) win.close()
    cleanup()
  })

  const accentColor = color
  const modelsJson = JSON.stringify(MODELS)

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
    padding: 8px 0;
  }
  #list::-webkit-scrollbar { width: 5px; }
  #list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
  .model {
    padding: 10px 14px;
    cursor: pointer;
    transition: background 0.1s;
    border-left: 3px solid transparent;
  }
  .model:hover {
    background: rgba(255,255,255,0.06);
  }
  .model.selected {
    background: rgba(255,255,255,0.08);
    border-left-color: ${accentColor};
  }
  .model-name {
    font-size: 13px;
    font-weight: 600;
    color: rgba(255,255,255,0.9);
  }
  .model-id {
    font-size: 11px;
    color: rgba(255,255,255,0.35);
    font-family: 'SF Mono', Menlo, monospace;
    margin-top: 1px;
  }
  .model-desc {
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    margin-top: 3px;
    line-height: 1.3;
  }
  .tier-badge {
    display: inline-block;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 1px 5px;
    border-radius: 3px;
    margin-left: 6px;
    vertical-align: middle;
  }
  .tier-highest { background: rgba(168,85,247,0.25); color: rgba(168,85,247,0.9); }
  .tier-mid { background: rgba(59,130,246,0.25); color: rgba(59,130,246,0.9); }
  .tier-low { background: rgba(34,197,94,0.25); color: rgba(34,197,94,0.9); }
  #footer {
    -webkit-app-region: no-drag;
    padding: 12px 14px;
    border-top: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
  }
  #generate-btn {
    width: 100%;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    background: ${accentColor};
    color: white;
    font-family: inherit;
    transition: opacity 0.15s;
  }
  #generate-btn:hover { opacity: 0.85; }
  #generate-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .section-label {
    padding: 6px 14px 4px;
    font-size: 10px;
    font-weight: 600;
    color: rgba(255,255,255,0.25);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
</style></head>
<body>
  <div id="header">Switch Model</div>
  <div id="list"></div>
  <div id="footer">
    <button id="generate-btn" disabled>Paste /model Command</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const models = ${modelsJson};
    const list = document.getElementById('list');
    const btn = document.getElementById('generate-btn');
    let selectedModel = null;

    function render() {
      list.innerHTML = '';
      let lastTier = '';
      for (const m of models) {
        if (m.tier !== lastTier) {
          lastTier = m.tier;
          const label = document.createElement('div');
          label.className = 'section-label';
          label.textContent = m.tier === 'highest' ? 'Most Capable' : m.tier === 'mid' ? 'Balanced' : 'Fast';
          list.appendChild(label);
        }
        const el = document.createElement('div');
        el.className = 'model' + (selectedModel === m.id ? ' selected' : '');
        el.innerHTML = '<div class="model-name">' + m.name
          + '<span class="tier-badge tier-' + m.tier + '">'
          + (m.tier === 'highest' ? 'Pro' : m.tier === 'mid' ? 'Standard' : 'Fast')
          + '</span></div>'
          + '<div class="model-id">' + m.id + '</div>'
          + '<div class="model-desc">' + m.description + '</div>';
        el.addEventListener('click', () => {
          selectedModel = m.id;
          btn.disabled = false;
          render();
        });
        list.appendChild(el);
      }
    }

    btn.addEventListener('click', () => {
      if (!selectedModel) return;
      ipcRenderer.send('${channelType}', '/model ' + selectedModel);
    });

    render();

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

export function isModelSelectorOpen(windowId: number): boolean {
  const win = modelWindows.get(windowId)
  return !!win && !win.isDestroyed()
}
