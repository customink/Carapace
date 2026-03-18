import { BrowserWindow, ipcMain, dialog } from 'electron'
import { loadPresets } from '../services/preset-store'
import type { ScheduledPrompt } from '@shared/types/scheduled-prompt'

export interface ScheduleDialogResult {
  name: string
  hour: number
  minute: number
  cwd: string
  prompt: string
  presetId: string
  enabled: boolean
}

export function showScheduleDialog(existing?: Omit<ScheduledPrompt, 'id'>): Promise<ScheduleDialogResult | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 440,
      height: 520,
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

    const channelOk = `schedule-ok-${win.id}`
    const channelCancel = `schedule-cancel-${win.id}`
    const channelBrowse = `schedule-browse-${win.id}`

    const cleanup = () => {
      ipcMain.removeAllListeners(channelOk)
      ipcMain.removeAllListeners(channelCancel)
      ipcMain.removeAllListeners(channelBrowse)
    }

    ipcMain.once(channelOk, (_e, data: ScheduleDialogResult) => {
      cleanup(); win.close(); resolve(data)
    })

    ipcMain.once(channelCancel, () => {
      cleanup(); win.close(); resolve(null)
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

    win.on('closed', () => { cleanup(); resolve(null) })

    const presets = loadPresets()
    const presetOptions = presets.map(p => {
      const sel = existing?.presetId === p.id ? ' selected' : ''
      return `<option value="${p.id}"${sel}>${p.name}</option>`
    }).join('')

    const isEdit = !!existing
    const heading = isEdit ? 'Edit Schedule' : 'New Schedule'
    const btnLabel = isEdit ? 'Save' : 'Create'

    const hourOptions = Array.from({ length: 24 }, (_, i) => {
      const label = `${i.toString().padStart(2, '0')}:00`
      const sel = existing?.hour === i ? ' selected' : ''
      return `<option value="${i}"${sel}>${label}</option>`
    }).join('')

    const minuteOptions = Array.from({ length: 60 }, (_, i) => {
      const sel = (existing?.minute || 0) === i ? ' selected' : ''
      return `<option value="${i}"${sel}>${i.toString().padStart(2, '0')}</option>`
    }).join('')

    const html = `<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; padding: 20px; -webkit-app-region: drag; color: #e2e8f0; }
  h3 { font-size: 14px; font-weight: 600; margin-bottom: 14px; }
  label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: #94a3b8; }
  input[type="text"], textarea, select {
    -webkit-app-region: no-drag; width: 100%; padding: 7px 10px; font-size: 13px;
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    background: rgba(0,0,0,0.3); color: #e2e8f0; outline: none;
    font-family: inherit;
  }
  textarea { resize: vertical; min-height: 60px; }
  input:focus, textarea:focus, select:focus { border-color: rgba(124,58,237,0.6); }
  select { -webkit-appearance: none; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%2394a3b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px;
  }
  .field { margin-bottom: 10px; }
  .time-row { display: flex; gap: 8px; }
  .time-row select { flex: 1; }
  .folder-row { display: flex; gap: 6px; }
  .folder-row input { flex: 1; }
  .browse { -webkit-app-region: no-drag; padding: 7px 12px; font-size: 12px; border-radius: 6px; border: none;
    background: rgba(255,255,255,0.1); color: #e2e8f0; cursor: pointer; white-space: nowrap; font-weight: 500; }
  .browse:hover { background: rgba(255,255,255,0.15); }
  .checkbox-row { -webkit-app-region: no-drag; display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .checkbox-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: #7C3AED; cursor: pointer; }
  .checkbox-row label { margin-bottom: 0; cursor: pointer; font-size: 13px; color: #e2e8f0; }
  .buttons { -webkit-app-region: no-drag; display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  button { padding: 6px 16px; font-size: 13px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; }
  .cancel { background: rgba(255,255,255,0.1); color: #e2e8f0; }
  .cancel:hover { background: rgba(255,255,255,0.15); }
  .ok { background: #7C3AED; color: white; }
  .ok:hover { background: #6D28D9; }
  .ok:disabled { opacity: 0.4; cursor: default; }
</style></head>
<body>
  <h3>${heading}</h3>
  <div class="field">
    <label>Schedule Name</label>
    <input id="name" type="text" placeholder="e.g. Morning standup" value="${(existing?.name || '').replace(/"/g, '&quot;')}" autofocus />
  </div>
  <div class="field">
    <label>Time</label>
    <div class="time-row">
      <select id="hour">${hourOptions}</select>
      <select id="minute">${minuteOptions}</select>
    </div>
  </div>
  <div class="field">
    <label>Working Directory</label>
    <div class="folder-row">
      <input id="cwd" type="text" placeholder="~ (home directory)" value="${(existing?.cwd || '').replace(/"/g, '&quot;')}" />
      <button class="browse" onclick="require('electron').ipcRenderer.send('${channelBrowse}')">Browse</button>
    </div>
  </div>
  <div class="field">
    <label>Prompt</label>
    <textarea id="prompt" placeholder="What should Claude do?">${existing?.prompt || ''}</textarea>
  </div>
  <div class="field">
    <label>Preset (optional)</label>
    <select id="presetId">
      <option value="">None</option>
      ${presetOptions}
    </select>
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="enabled" ${existing?.enabled !== false ? 'checked' : ''} />
    <label for="enabled">Enabled</label>
  </div>
  <div class="buttons">
    <button class="cancel" onclick="require('electron').ipcRenderer.send('${channelCancel}')">Cancel</button>
    <button class="ok" id="okBtn" onclick="submit()">${btnLabel}</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const nameEl = document.getElementById('name');
    const okBtn = document.getElementById('okBtn');
    function updateOk() { okBtn.disabled = !nameEl.value.trim(); }
    nameEl.addEventListener('input', updateOk);
    updateOk();
    function submit() {
      if (!nameEl.value.trim()) return;
      ipcRenderer.send('${channelOk}', {
        name: nameEl.value.trim(),
        hour: parseInt(document.getElementById('hour').value),
        minute: parseInt(document.getElementById('minute').value),
        cwd: document.getElementById('cwd').value,
        prompt: document.getElementById('prompt').value,
        presetId: document.getElementById('presetId').value,
        enabled: document.getElementById('enabled').checked,
      });
    }
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' && e.metaKey) || (e.key === 'Enter' && !e.target.matches('textarea'))) submit();
      if (e.key === 'Escape') ipcRenderer.send('${channelCancel}');
    });
    ipcRenderer.on('${channelBrowse}-reply', (_e, path) => {
      document.getElementById('cwd').value = path;
    });
  </script>
</body>
</html>`

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    win.once('ready-to-show', () => win.show())
  })
}
