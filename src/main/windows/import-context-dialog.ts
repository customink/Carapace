import { BrowserWindow, ipcMain, dialog } from 'electron'

export interface ImportContextResult {
  title: string
  folder: string
  bypass: boolean
}

/**
 * Show a dialog for importing a shared context.
 * User picks a working directory and can adjust the session title.
 */
export function showImportContextDialog(suggestedTitle: string): Promise<ImportContextResult | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 420,
      height: 260,
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

    const channelOk = `import-ctx-ok-${win.id}`
    const channelCancel = `import-ctx-cancel-${win.id}`
    const channelBrowse = `import-ctx-browse-${win.id}`

    const cleanup = () => {
      ipcMain.removeAllListeners(channelOk)
      ipcMain.removeAllListeners(channelCancel)
      ipcMain.removeAllListeners(channelBrowse)
    }

    ipcMain.once(channelOk, (_e, data: ImportContextResult) => {
      cleanup()
      win.close()
      resolve(data)
    })

    ipcMain.once(channelCancel, () => {
      cleanup()
      win.close()
      resolve(null)
    })

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

    const escapedTitle = suggestedTitle.replace(/"/g, '&quot;')

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
  input:focus { border-color: rgba(124,58,237,0.6); }
  .field { margin-bottom: 10px; }
  .folder-row { display: flex; gap: 6px; }
  .folder-row input { flex: 1; }
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
  .ok:disabled { opacity: 0.4; cursor: default; }
</style></head>
<body>
  <h3>Import Shared Context</h3>
  <div class="field">
    <label>Session Title</label>
    <input id="title" type="text" placeholder="e.g. Fix login bug" value="${escapedTitle}" autofocus />
  </div>
  <div class="field">
    <label>Working Directory</label>
    <div class="folder-row">
      <input id="folder" type="text" placeholder="Select a folder..." readonly />
      <button class="browse" onclick="require('electron').ipcRenderer.send('${channelBrowse}')">Browse</button>
    </div>
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="bypass" checked />
    <label for="bypass">Skip permissions</label>
  </div>
  <div class="buttons">
    <button class="cancel" onclick="require('electron').ipcRenderer.send('${channelCancel}')">Cancel</button>
    <button class="ok" id="okBtn" onclick="submit()" disabled>Import</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const titleEl = document.getElementById('title');
    const folderEl = document.getElementById('folder');
    const bypassEl = document.getElementById('bypass');
    const okBtn = document.getElementById('okBtn');

    function updateOk() {
      okBtn.disabled = !folderEl.value;
    }

    function submit() {
      if (!folderEl.value) return;
      ipcRenderer.send('${channelOk}', {
        title: titleEl.value.trim(),
        folder: folderEl.value,
        bypass: bypassEl.checked,
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') ipcRenderer.send('${channelCancel}');
    });

    ipcRenderer.on('${channelBrowse}-reply', (_e, path) => {
      folderEl.value = path;
      updateOk();
    });
  </script>
</body>
</html>`

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    win.once('ready-to-show', () => win.show())
  })
}
