import { BrowserWindow, ipcMain, dialog } from 'electron'
import { SESSION_COLORS } from '@shared/constants/colors'

export interface SessionOptions {
  title: string
  folder: string
  bypass: boolean
  color: string
  shellTab: boolean
}

// Human-friendly names for the color palette
const COLOR_NAMES: Record<string, string> = {
  '#F472B6': 'Pink',
  '#34D399': 'Emerald',
  '#60A5FA': 'Blue',
  '#FBBF24': 'Amber',
  '#A78BFA': 'Violet',
  '#FB923C': 'Orange',
  '#2DD4BF': 'Teal',
  '#F87171': 'Red',
}

/**
 * Show a session options dialog with title, folder, color, and permissions inputs.
 * Returns null if the user cancels.
 */
export function showSessionOptionsDialog(): Promise<SessionOptions | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 420,
      height: 400,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      frame: false,
      transparent: true,
      vibrancy: 'popover',
      visualEffectState: 'active',
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      }
    })

    const channelOk = `prompt-ok-${win.id}`
    const channelCancel = `prompt-cancel-${win.id}`
    const channelBrowse = `prompt-browse-${win.id}`

    const cleanup = () => {
      ipcMain.removeAllListeners(channelOk)
      ipcMain.removeAllListeners(channelCancel)
      ipcMain.removeAllListeners(channelBrowse)
    }

    ipcMain.once(channelOk, (_e, title: string, folder: string, bypass: boolean, color: string, shellTab: boolean) => {
      cleanup()
      win.close()
      resolve({ title: title || '', folder: folder || '', bypass, color, shellTab })
    })

    ipcMain.once(channelCancel, () => {
      cleanup()
      win.close()
      resolve(null)
    })

    // Folder picker via native dialog
    ipcMain.on(channelBrowse, async () => {
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select Working Directory',
      })
      if (!result.canceled && result.filePaths[0]) {
        win.webContents.send(`${channelBrowse}-reply`, result.filePaths[0])
      }
    })

    win.on('closed', () => {
      cleanup()
      resolve(null)
    })

    // Build color <option> elements
    const colorOptions = SESSION_COLORS.map((hex, i) => {
      const name = COLOR_NAMES[hex] || `Color ${i + 1}`
      return `<option value="${hex}">${name}</option>`
    }).join('')

    const html = `<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    padding: 20px;
    -webkit-app-region: drag;
    color: #e2e8f0;
  }
  h3 { font-size: 14px; font-weight: 600; margin-bottom: 14px; }
  label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: #94a3b8; }
  input[type="text"] {
    -webkit-app-region: no-drag;
    width: 100%; padding: 7px 10px; font-size: 13px;
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    background: rgba(0,0,0,0.3); color: #e2e8f0; outline: none;
  }
  input[type="text"]:focus { border-color: rgba(124,58,237,0.6); }
  select {
    -webkit-app-region: no-drag;
    width: 100%; padding: 7px 10px; font-size: 13px;
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    background: rgba(0,0,0,0.3); color: #e2e8f0; outline: none;
    -webkit-appearance: none; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%2394a3b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
  }
  select:focus { border-color: rgba(124,58,237,0.6); }
  .field { margin-bottom: 10px; }
  .folder-row { display: flex; gap: 6px; }
  .folder-row input { flex: 1; }
  .color-row { display: flex; gap: 8px; align-items: center; }
  .color-row select { flex: 1; }
  .color-dot {
    width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0;
    border: 2px solid rgba(255,255,255,0.2);
  }
  .browse {
    -webkit-app-region: no-drag;
    padding: 7px 12px; font-size: 12px; border-radius: 6px; border: none;
    background: rgba(255,255,255,0.1); color: #e2e8f0; cursor: pointer;
    white-space: nowrap; font-weight: 500;
  }
  .browse:hover { background: rgba(255,255,255,0.15); }
  .checkbox-row {
    -webkit-app-region: no-drag;
    display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
  }
  .checkbox-row input[type="checkbox"] {
    width: 16px; height: 16px; accent-color: #7C3AED; cursor: pointer;
  }
  .checkbox-row label { margin-bottom: 0; cursor: pointer; font-size: 13px; color: #e2e8f0; }
  .buttons {
    -webkit-app-region: no-drag;
    display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;
  }
  button {
    padding: 6px 16px; font-size: 13px; border-radius: 6px; border: none;
    cursor: pointer; font-weight: 500;
  }
  .cancel { background: rgba(255,255,255,0.1); color: #e2e8f0; }
  .cancel:hover { background: rgba(255,255,255,0.15); }
  .ok { background: #7C3AED; color: white; }
  .ok:hover { background: #6D28D9; }
</style></head>
<body>
  <h3>New Session Options</h3>
  <div class="field">
    <label>Session Title</label>
    <input id="title" type="text" placeholder="e.g. Fix login bug" autofocus />
  </div>
  <div class="field">
    <label>Working Directory</label>
    <div class="folder-row">
      <input id="folder" type="text" placeholder="~ (home directory)" />
      <button class="browse" onclick="require('electron').ipcRenderer.send('${channelBrowse}')">Browse</button>
    </div>
  </div>
  <div class="field">
    <label>Color</label>
    <div class="color-row">
      <div id="colorDot" class="color-dot" style="background: ${SESSION_COLORS[0]}"></div>
      <select id="color">
        <option value="">Auto</option>
        ${colorOptions}
      </select>
    </div>
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="bypass" checked />
    <label for="bypass">Skip permissions</label>
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="shellTab" checked />
    <label for="shellTab">Open companion shell tab</label>
  </div>
  <div class="buttons">
    <button class="cancel" onclick="require('electron').ipcRenderer.send('${channelCancel}')">Cancel</button>
    <button class="ok" onclick="submit()">Create</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const titleEl = document.getElementById('title');
    const folderEl = document.getElementById('folder');
    const colorEl = document.getElementById('color');
    const colorDot = document.getElementById('colorDot');
    const bypassEl = document.getElementById('bypass');
    const shellTabEl = document.getElementById('shellTab');
    let titleTouched = false;

    titleEl.addEventListener('input', () => { titleTouched = titleEl.value.length > 0; });

    function updateTitleFromFolder(folderPath) {
      if (!titleTouched) {
        const name = folderPath.split('/').filter(Boolean).pop() || '';
        titleEl.value = name;
      }
    }

    folderEl.addEventListener('input', () => { updateTitleFromFolder(folderEl.value); });

    colorEl.addEventListener('change', () => {
      colorDot.style.background = colorEl.value || '#7C3AED';
    });

    function submit() {
      ipcRenderer.send('${channelOk}', titleEl.value, folderEl.value, bypassEl.checked, colorEl.value, shellTabEl.checked);
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') ipcRenderer.send('${channelCancel}');
    });
    ipcRenderer.on('${channelBrowse}-reply', (_e, path) => {
      folderEl.value = path;
      updateTitleFromFolder(path);
    });
  </script>
</body>
</html>`

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    win.once('ready-to-show', () => win.show())
  })
}
