import { app, BrowserWindow, ipcMain } from 'electron'

export interface TextInputOptions {
  title: string
  label: string
  placeholder?: string
  okLabel?: string
  parent?: BrowserWindow
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Small single-field prompt, styled like the other Carapace dialogs. */
export function showTextInputDialog(opts: TextInputOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 380,
      height: 170,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      frame: false,
      transparent: true,
      vibrancy: 'popover',
      visualEffectState: 'active',
      show: false,
      parent: opts.parent,
      modal: !!opts.parent,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      }
    })

    const channelOk = `textinput-ok-${win.id}`
    const channelCancel = `textinput-cancel-${win.id}`
    let settled = false

    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      ipcMain.removeAllListeners(channelOk)
      ipcMain.removeAllListeners(channelCancel)
      if (!win.isDestroyed()) win.close()
      resolve(value)
    }

    ipcMain.once(channelOk, (_e, value: string) => finish(value))
    ipcMain.once(channelCancel, () => finish(null))
    win.on('closed', () => finish(null))

    const html = `<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; padding: 18px;
    -webkit-app-region: drag; color: #e2e8f0; }
  h3 { font-size: 13px; font-weight: 600; margin-bottom: 12px; }
  label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: #94a3b8; }
  input { -webkit-app-region: no-drag; width: 100%; padding: 7px 10px; font-size: 13px;
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    background: rgba(0,0,0,0.3); color: #e2e8f0; outline: none; font-family: inherit; }
  input:focus { border-color: rgba(124,58,237,0.6); }
  .buttons { -webkit-app-region: no-drag; display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  button { padding: 6px 16px; font-size: 13px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; }
  .cancel { background: rgba(255,255,255,0.1); color: #e2e8f0; }
  .cancel:hover { background: rgba(255,255,255,0.15); }
  .ok { background: #7C3AED; color: white; }
  .ok:hover { background: #6D28D9; }
  .ok:disabled { opacity: 0.4; cursor: default; }
</style></head>
<body>
  <h3>${escapeHtml(opts.title)}</h3>
  <label>${escapeHtml(opts.label)}</label>
  <input id="value" type="text" placeholder="${escapeHtml(opts.placeholder || '')}" autofocus />
  <div class="buttons">
    <button class="cancel" onclick="require('electron').ipcRenderer.send('${channelCancel}')">Cancel</button>
    <button class="ok" id="okBtn" onclick="submit()">${escapeHtml(opts.okLabel || 'Save')}</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const input = document.getElementById('value');
    const okBtn = document.getElementById('okBtn');
    function validate() { okBtn.disabled = !input.value.trim(); }
    input.addEventListener('input', validate);
    function submit() { if (!okBtn.disabled) ipcRenderer.send('${channelOk}', input.value.trim()); }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') ipcRenderer.send('${channelCancel}');
    });
    validate();
  </script>
</body>
</html>`

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    win.once('ready-to-show', () => {
      app.focus({ steal: true })
      win.show()
      win.focus()
    })
  })
}
