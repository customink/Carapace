import { BrowserWindow, ipcMain } from 'electron'
import { loadAppSettings } from '../services/app-settings-store'

export function showFuelGaugeLimitsWindow(): Promise<{ tokenGoal: number; costGoal: number } | null> {
  return new Promise((resolve) => {
    const settings = loadAppSettings()
    const ts = Date.now()
    const channelOk = `fuel-limits:ok-${ts}`
    const channelCancel = `fuel-limits:cancel-${ts}`

    const win = new BrowserWindow({
      width: 280,
      height: 230,
      resizable: false,
      alwaysOnTop: true,
      frame: false,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    })

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
  padding: 18px;
  -webkit-app-region: no-drag;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 12px;
  overflow: hidden;
}
h3 { font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 14px; letter-spacing: 0.08em; text-transform: uppercase; }
.field { margin-bottom: 12px; }
label { display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px; }
input[type=number] {
  width: 100%; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
  color: #e2e8f0; border-radius: 6px; padding: 6px 9px; font-size: 13px; outline: none;
  -webkit-app-region: no-drag;
}
input[type=number]:focus { border-color: rgba(124,58,237,0.6); box-shadow: 0 0 0 2px rgba(124,58,237,0.15); }
.hint { font-size: 10px; color: #475569; margin-top: 3px; }
.buttons { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
button {
  padding: 6px 16px; border-radius: 6px; font-size: 12px; font-weight: 500;
  cursor: pointer; border: none; -webkit-app-region: no-drag;
}
.cancel { background: rgba(255,255,255,0.08); color: #94a3b8; }
.ok { background: rgba(124,58,237,0.75); color: #fff; }
.cancel:hover { background: rgba(255,255,255,0.15); }
.ok:hover { background: rgba(124,58,237,1); }
</style>
</head>
<body>
  <h3>Daily Limits</h3>
  <div class="field">
    <label>Token Limit</label>
    <input type="number" id="tokenGoal" min="0" step="10000" value="${settings.dailyTokenGoal}" />
    <div class="hint">0 = hide gauge</div>
  </div>
  <div class="field">
    <label>Cost Limit ($)</label>
    <input type="number" id="costGoal" min="0" step="0.5" value="${settings.dailyCostGoal}" />
    <div class="hint">0 = hide gauge</div>
  </div>
  <div class="buttons">
    <button class="cancel" onclick="require('electron').ipcRenderer.send('${channelCancel}')">Cancel</button>
    <button class="ok" onclick="submit()">Save</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    function submit() {
      ipcRenderer.send('${channelOk}', {
        tokenGoal: parseFloat(document.getElementById('tokenGoal').value) || 0,
        costGoal: parseFloat(document.getElementById('costGoal').value) || 0,
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') ipcRenderer.send('${channelCancel}');
    });
    document.getElementById('tokenGoal').focus();
  </script>
</body>
</html>`

    let settled = false
    const settle = (value: { tokenGoal: number; costGoal: number } | null) => {
      if (settled) return
      settled = true
      ipcMain.removeListener(channelOk, onOk)
      ipcMain.removeListener(channelCancel, onCancel)
      if (!win.isDestroyed()) win.close()
      resolve(value)
    }

    const onOk = (_: Electron.IpcMainEvent, result: { tokenGoal: number; costGoal: number }) => settle(result)
    const onCancel = () => settle(null)

    ipcMain.once(channelOk, onOk)
    ipcMain.once(channelCancel, onCancel)
    win.on('closed', () => settle(null))

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    win.once('ready-to-show', () => { win.show(); win.focus() })
  })
}
