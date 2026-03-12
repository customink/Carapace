import { BrowserWindow, ipcMain } from 'electron'
import {
  drawerBaseCss, drawerHeaderCss, drawerHeaderHtml, drawerBaseScript,
  createDrawerWindow, loadDrawerHtml,
} from './drawer-base'

const modelWindows = new Map<number, BrowserWindow>()

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
  const channelType = `model-type-${parentWin.id}`

  const result = createDrawerWindow({
    parentWin,
    width: PANEL_WIDTH,
    color,
    closedChannel: 'terminal:modelselector-closed',
    windowMap: modelWindows,
    ipcChannels: [channelType],
  })

  if (!result) return false
  const { win, bgColor, headerBg } = result

  ipcMain.on(channelType, (_e, command: string) => {
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send('terminal:type-command', command)
    }
  })

  const accentColor = color
  const modelsJson = JSON.stringify(MODELS)

  const html = `<!DOCTYPE html>
<html>
<head><style>
  ${drawerBaseCss(bgColor)}
  ${drawerHeaderCss(headerBg)}
  #list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }
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
  ${drawerHeaderHtml('Switch Model')}
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

    ${drawerBaseScript()}
  </script>
</body>
</html>`

  loadDrawerHtml(win, html)
  return true
}

export function isModelSelectorOpen(windowId: number): boolean {
  const win = modelWindows.get(windowId)
  return !!win && !win.isDestroyed()
}
