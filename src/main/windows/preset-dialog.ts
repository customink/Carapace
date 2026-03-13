import { BrowserWindow, ipcMain, dialog } from 'electron'
import { SESSION_COLORS } from '@shared/constants/colors'
import type { Preset } from '@shared/types/preset'

// Human-friendly names for the color palette
const COLOR_NAMES: Record<string, string> = {
  '#3B6EE8': 'Blue',
  '#10B981': 'Green',
  '#F97316': 'Orange',
  '#E879F9': 'Fuchsia',
  '#06B6D4': 'Cyan',
  '#F43F5E': 'Rose',
  '#A78BFA': 'Violet',
  '#FBBF24': 'Amber',
  '#14B8A6': 'Teal',
  '#FB7185': 'Coral',
}

export interface PresetDialogResult {
  name: string
  title: string
  folder: string
  bypass: boolean
  color: string
  shellTab: boolean
  shellTabCount: number
  shellTabNames: string[]
}

/**
 * Show a dialog for creating or editing a preset.
 * Pass existing preset data to prefill for editing.
 * Returns null if the user cancels.
 */
export function showPresetDialog(existing?: Omit<Preset, 'id'>): Promise<PresetDialogResult | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 440,
      height: 530,
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

    const channelOk = `preset-ok-${win.id}`
    const channelCancel = `preset-cancel-${win.id}`
    const channelBrowse = `preset-browse-${win.id}`

    const cleanup = () => {
      ipcMain.removeAllListeners(channelOk)
      ipcMain.removeAllListeners(channelCancel)
      ipcMain.removeAllListeners(channelBrowse)
    }

    ipcMain.once(channelOk, (_e, data: PresetDialogResult) => {
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

    const colorOptions = SESSION_COLORS.map((hex, i) => {
      const name = COLOR_NAMES[hex] || `Color ${i + 1}`
      const selected = existing?.color === hex ? ' selected' : ''
      return `<option value="${hex}"${selected}>${name}</option>`
    }).join('')

    const isEdit = !!existing
    const heading = isEdit ? 'Edit Preset' : 'New Preset'
    const btnLabel = isEdit ? 'Save' : 'Create'

    const initName = existing?.name || ''
    const initTitle = existing?.title || ''
    const initFolder = existing?.folder || ''
    const initBypass = existing?.bypass ?? true
    const initShellTab = existing?.shellTab ?? true
    const initShellTabCount = existing?.shellTabCount ?? 1
    const initShellTabNames = JSON.stringify(existing?.shellTabNames || [])
    const initColor = existing?.color || ''
    const initDotColor = initColor || SESSION_COLORS[0]

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
  input[type="text"], input[type="number"] {
    -webkit-app-region: no-drag;
    width: 100%; padding: 7px 10px; font-size: 13px;
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    background: rgba(0,0,0,0.3); color: #e2e8f0; outline: none;
  }
  input[type="number"] { width: 60px; }
  input:focus { border-color: rgba(124,58,237,0.6); }
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
  .inline-row {
    -webkit-app-region: no-drag;
    display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
  }
  .inline-row label { margin-bottom: 0; white-space: nowrap; }
  .shell-names {
    -webkit-app-region: no-drag;
    margin-bottom: 10px; padding-left: 2px;
  }
  .shell-names .name-row {
    display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
  }
  .shell-names .name-row input { flex: 1; }
  .shell-names .name-label { font-size: 11px; color: #64748b; width: 50px; flex-shrink: 0; }
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
  <h3>${heading}</h3>
  <div class="field">
    <label>Preset Name</label>
    <input id="name" type="text" placeholder="e.g. Work project" value="${initName.replace(/"/g, '&quot;')}" autofocus />
  </div>
  <div class="field">
    <label>Session Title</label>
    <input id="title" type="text" placeholder="e.g. Fix login bug" value="${initTitle.replace(/"/g, '&quot;')}" />
  </div>
  <div class="field">
    <label>Working Directory</label>
    <div class="folder-row">
      <input id="folder" type="text" placeholder="~ (home directory)" value="${initFolder.replace(/"/g, '&quot;')}" />
      <button class="browse" onclick="require('electron').ipcRenderer.send('${channelBrowse}')">Browse</button>
    </div>
  </div>
  <div class="field">
    <label>Color</label>
    <div class="color-row">
      <div id="colorDot" class="color-dot" style="background: ${initDotColor}"></div>
      <select id="color">
        <option value=""${!initColor ? ' selected' : ''}>Auto</option>
        ${colorOptions}
      </select>
    </div>
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="bypass" ${initBypass ? 'checked' : ''} />
    <label for="bypass">Skip permissions</label>
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="shellTab" ${initShellTab ? 'checked' : ''} />
    <label for="shellTab">Open companion shell tabs</label>
  </div>
  <div class="inline-row" id="countRow" style="display:${initShellTab ? 'flex' : 'none'}">
    <label>Number of shell tabs</label>
    <input type="number" id="shellTabCount" min="1" max="8" value="${initShellTabCount}" />
  </div>
  <div class="shell-names" id="shellNames"></div>
  <div class="buttons">
    <button class="cancel" onclick="require('electron').ipcRenderer.send('${channelCancel}')">Cancel</button>
    <button class="ok" id="okBtn" onclick="submit()">${btnLabel}</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const nameEl = document.getElementById('name');
    const titleEl = document.getElementById('title');
    const folderEl = document.getElementById('folder');
    const colorEl = document.getElementById('color');
    const colorDot = document.getElementById('colorDot');
    const bypassEl = document.getElementById('bypass');
    const shellTabEl = document.getElementById('shellTab');
    const shellTabCountEl = document.getElementById('shellTabCount');
    const countRow = document.getElementById('countRow');
    const shellNamesEl = document.getElementById('shellNames');
    const okBtn = document.getElementById('okBtn');
    const initNames = ${initShellTabNames};

    function updateOk() {
      okBtn.disabled = !nameEl.value.trim();
    }
    nameEl.addEventListener('input', updateOk);
    updateOk();

    colorEl.addEventListener('change', () => {
      colorDot.style.background = colorEl.value || '#7C3AED';
    });

    shellTabEl.addEventListener('change', () => {
      countRow.style.display = shellTabEl.checked ? 'flex' : 'none';
      renderShellNames();
    });

    shellTabCountEl.addEventListener('input', renderShellNames);

    function renderShellNames() {
      if (!shellTabEl.checked) { shellNamesEl.innerHTML = ''; return; }
      const count = Math.max(1, Math.min(8, parseInt(shellTabCountEl.value) || 1));
      let html = '<label style="margin-bottom:6px;">Shell tab names</label>';
      for (let i = 0; i < count; i++) {
        const val = initNames[i] || '';
        const existing = shellNamesEl.querySelector('#sn' + i);
        const curVal = existing ? existing.value : val;
        html += '<div class="name-row">' +
          '<span class="name-label">Tab ' + (i + 1) + '</span>' +
          '<input id="sn' + i + '" type="text" placeholder="Shell ' + (i + 1) + '" value="' + curVal.replace(/"/g, '&quot;') + '" />' +
          '</div>';
      }
      // Preserve values before replacing
      const saved = {};
      for (let i = 0; i < 8; i++) {
        const el = shellNamesEl.querySelector('#sn' + i);
        if (el) saved[i] = el.value;
      }
      shellNamesEl.innerHTML = html;
      for (let i = 0; i < count; i++) {
        const el = shellNamesEl.querySelector('#sn' + i);
        if (el && saved[i] !== undefined) el.value = saved[i];
      }
    }
    renderShellNames();

    function submit() {
      if (!nameEl.value.trim()) return;
      const count = shellTabEl.checked ? Math.max(1, Math.min(8, parseInt(shellTabCountEl.value) || 1)) : 1;
      const names = [];
      if (shellTabEl.checked) {
        for (let i = 0; i < count; i++) {
          const el = document.getElementById('sn' + i);
          names.push(el ? el.value : '');
        }
      }
      ipcRenderer.send('${channelOk}', {
        name: nameEl.value.trim(),
        title: titleEl.value,
        folder: folderEl.value,
        bypass: bypassEl.checked,
        color: colorEl.value,
        shellTab: shellTabEl.checked,
        shellTabCount: count,
        shellTabNames: names,
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') ipcRenderer.send('${channelCancel}');
    });

    ipcRenderer.on('${channelBrowse}-reply', (_e, path) => {
      folderEl.value = path;
    });
  </script>
</body>
</html>`

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    win.once('ready-to-show', () => win.show())
  })
}
