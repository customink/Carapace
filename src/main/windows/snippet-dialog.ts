import { BrowserWindow, ipcMain } from 'electron'
import { SNIPPET_ICONS } from '@shared/constants/snippet-icons'

export interface SnippetInput {
  icon: string
  label: string
  prompt: string
}

export function showSnippetDialog(): Promise<SnippetInput | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 420,
      height: 440,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      frame: false,
      transparent: true,
      vibrancy: 'popover',
      visualEffectState: 'active',
      show: false,
      center: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      }
    })

    const channelOk = `snippet-ok-${win.id}`
    const channelCancel = `snippet-cancel-${win.id}`

    const cleanup = () => {
      ipcMain.removeAllListeners(channelOk)
      ipcMain.removeAllListeners(channelCancel)
    }

    ipcMain.once(channelOk, (_e, icon: string, label: string, prompt: string) => {
      cleanup()
      win.close()
      resolve({ icon, label, prompt })
    })

    ipcMain.once(channelCancel, () => {
      cleanup()
      win.close()
      resolve(null)
    })

    win.on('closed', () => {
      cleanup()
      resolve(null)
    })

    // Build icon grid HTML using emoji characters
    const iconGridHtml = Object.entries(SNIPPET_ICONS).map(([key, emoji]) => {
      return `<button class="icon-opt" data-icon="${key}" onclick="selectIcon('${key}')" title="${key}">${emoji}</button>`
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
  input[type="text"], textarea {
    -webkit-app-region: no-drag;
    width: 100%; padding: 7px 10px; font-size: 13px;
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    background: rgba(0,0,0,0.3); color: #e2e8f0; outline: none;
    font-family: inherit;
  }
  input[type="text"]:focus, textarea:focus { border-color: rgba(124,58,237,0.6); }
  textarea { resize: none; height: 80px; }
  .field { margin-bottom: 10px; }
  .icon-grid {
    -webkit-app-region: no-drag;
    display: flex; flex-wrap: wrap; gap: 4px;
  }
  .icon-opt {
    width: 36px; height: 36px; border-radius: 6px; border: 2px solid transparent;
    background: rgba(255,255,255,0.06); font-size: 18px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: all 0.15s ease; padding: 0;
  }
  .icon-opt:hover { background: rgba(255,255,255,0.12); }
  .icon-opt.selected { border-color: #7C3AED; background: rgba(124,58,237,0.2); }
  .buttons {
    -webkit-app-region: no-drag;
    display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;
  }
  button { padding: 6px 16px; font-size: 13px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; }
  .cancel { background: rgba(255,255,255,0.1); color: #e2e8f0; }
  .cancel:hover { background: rgba(255,255,255,0.15); }
  .ok { background: #7C3AED; color: white; }
  .ok:hover { background: #6D28D9; }
  .ok:disabled { opacity: 0.4; cursor: not-allowed; }
</style></head>
<body>
  <h3>New Quick Snippet</h3>
  <div class="field">
    <label>Name</label>
    <input id="label" type="text" placeholder="e.g. Add context files" autofocus />
  </div>
  <div class="field">
    <label>Prompt Text</label>
    <textarea id="prompt" placeholder="Text that will be pasted into the terminal..."></textarea>
  </div>
  <div class="field">
    <label>Icon</label>
    <div class="icon-grid">${iconGridHtml}</div>
  </div>
  <div class="buttons">
    <button class="cancel" onclick="require('electron').ipcRenderer.send('${channelCancel}')">Cancel</button>
    <button class="ok" id="saveBtn" onclick="submit()" disabled>Save</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const labelEl = document.getElementById('label');
    const promptEl = document.getElementById('prompt');
    const saveBtn = document.getElementById('saveBtn');
    let selectedIcon = '';

    function selectIcon(key) {
      selectedIcon = key;
      document.querySelectorAll('.icon-opt').forEach(el => {
        el.classList.toggle('selected', el.dataset.icon === key);
      });
      validate();
    }

    function validate() {
      saveBtn.disabled = !(labelEl.value.trim() && promptEl.value.trim() && selectedIcon);
    }

    labelEl.addEventListener('input', validate);
    promptEl.addEventListener('input', validate);

    function submit() {
      if (saveBtn.disabled) return;
      ipcRenderer.send('${channelOk}', selectedIcon, labelEl.value.trim(), promptEl.value);
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.metaKey) submit();
      if (e.key === 'Escape') ipcRenderer.send('${channelCancel}');
    });
  </script>
</body>
</html>`

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })
  })
}
