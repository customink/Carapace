import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { loadAppSettings } from '../services/app-settings-store'
import { loadPresets } from '../services/preset-store'

/** Sound entries: [file path, display name] */
const CHIME_SOUNDS: Array<[string, string]> = [
  // Bundled custom sounds
  [join(__dirname, '../../resources/sounds/ding.aiff'), 'Ding (Clean Bell)'],
  [join(__dirname, '../../resources/sounds/chime.aiff'), 'Chime (Soft)'],
  // macOS system sounds
  ['/System/Library/Sounds/Glass.aiff', 'Glass'],
  ['/System/Library/Sounds/Ping.aiff', 'Ping'],
  ['/System/Library/Sounds/Pop.aiff', 'Pop'],
  ['/System/Library/Sounds/Purr.aiff', 'Purr'],
  ['/System/Library/Sounds/Tink.aiff', 'Tink'],
  ['/System/Library/Sounds/Blow.aiff', 'Blow'],
  ['/System/Library/Sounds/Bottle.aiff', 'Bottle'],
  ['/System/Library/Sounds/Frog.aiff', 'Frog'],
  ['/System/Library/Sounds/Funk.aiff', 'Funk'],
  ['/System/Library/Sounds/Hero.aiff', 'Hero'],
  ['/System/Library/Sounds/Morse.aiff', 'Morse'],
  ['/System/Library/Sounds/Sosumi.aiff', 'Sosumi'],
  ['/System/Library/Sounds/Submarine.aiff', 'Submarine'],
  ['/System/Library/Sounds/Basso.aiff', 'Basso'],
  // Extra macOS system sounds
  ['/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/siri/jbl_confirm.caf', 'Siri Confirm'],
  ['/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/acknowledgment_sent.caf', 'Acknowledgment'],
  ['/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/begin_record.caf', 'Begin Record'],
  ['/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/siri/jbl_begin_short.caf', 'Siri Short'],
]

export function showSettingsWindow(): Promise<{ chimeSound: string; chimeVolume: number; orbClickAction: string; orbCmdClickAction: string; orbCtrlClickAction: string; orbClickPreset: string; orbCmdClickPreset: string; orbCtrlClickPreset: string; dailyTokenGoal: number; clearHistory: boolean } | null> {
  return new Promise((resolve) => {
    const settings = loadAppSettings()

    const win = new BrowserWindow({
      width: 420,
      height: 600,
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

    const channelOk = `settings-ok-${win.id}`
    const channelCancel = `settings-cancel-${win.id}`
    const channelPreview = `settings-preview-${win.id}`

    const cleanup = () => {
      ipcMain.removeAllListeners(channelOk)
      ipcMain.removeAllListeners(channelCancel)
      ipcMain.removeAllListeners(channelPreview)
    }

    ipcMain.once(channelOk, (_e, data: any) => {
      cleanup()
      win.close()
      resolve(data)
    })

    ipcMain.once(channelCancel, () => {
      cleanup()
      win.close()
      resolve(null)
    })

    // Preview chime sound — value is the full path
    ipcMain.on(channelPreview, (_e, soundPath: string, volume: number) => {
      const vol = Math.max(0, Math.min(100, volume)) / 100
      const { exec } = require('child_process')
      exec(`afplay "${soundPath}" -v ${vol}`)
    })

    win.on('closed', () => {
      cleanup()
      resolve(null)
    })

    const presets = loadPresets()
    const presetOptionsHtml = (selectedId: string) => presets.map(p => {
      const sel = p.id === selectedId ? ' selected' : ''
      return `<option value="${p.id}"${sel}>${p.name}</option>`
    }).join('')

    function actionSelect(id: string, selected: string, presetId: string, presetSelectId: string): string {
      const opts = [
        ['new-session', 'New Session'],
        ['new-session-bypass', 'New Session (Skip Permissions)'],
        ['focus-recent', 'Focus Most Recent Terminal'],
        ['focus-all', 'Bring All Terminals to Front'],
        ['preset', 'Launch Preset...'],
      ]
      const selectHtml = opts.map(([val, label]) => `<option value="${val}"${val === selected ? ' selected' : ''}>${label}</option>`).join('')
      const presetDisplay = selected === 'preset' ? '' : 'display:none;'
      const presetOpts = presetOptionsHtml(presetId)
      const noPresets = presets.length === 0 ? '<option value="">(No presets)</option>' : ''
      return `<select id="${id}" onchange="togglePreset('${id}','${presetSelectId}')">${selectHtml}</select>
        <select id="${presetSelectId}" style="margin-top:4px;${presetDisplay}">${noPresets}${presetOpts}</select>`
    }

    const soundOptions = CHIME_SOUNDS.map(([path, name]) => {
      const selected = path === settings.chimeSound ? ' selected' : ''
      return `<option value="${path}"${selected}>${name}</option>`
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
  h3 { font-size: 14px; font-weight: 600; margin-bottom: 16px; }
  label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: #94a3b8; }
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
  .field { margin-bottom: 14px; }
  .sound-row { display: flex; gap: 6px; align-items: center; }
  .sound-row select { flex: 1; }
  .preview-btn {
    -webkit-app-region: no-drag;
    padding: 7px 12px; font-size: 12px; border-radius: 6px; border: none;
    background: rgba(255,255,255,0.1); color: #e2e8f0; cursor: pointer;
    white-space: nowrap; font-weight: 500;
  }
  .preview-btn:hover { background: rgba(255,255,255,0.15); }
  .volume-row {
    -webkit-app-region: no-drag;
    display: flex; align-items: center; gap: 10px;
  }
  .volume-row input[type="range"] {
    flex: 1; accent-color: #7C3AED; cursor: pointer;
  }
  .volume-label {
    font-size: 12px; color: #94a3b8; min-width: 32px; text-align: right;
  }
  .danger-section {
    margin-top: 8px;
    padding-top: 14px;
    border-top: 1px solid rgba(255,255,255,0.08);
  }
  .danger-btn {
    -webkit-app-region: no-drag;
    width: 100%; padding: 8px 16px; font-size: 13px; border-radius: 6px; border: none;
    background: rgba(239,68,68,0.15); color: #f87171; cursor: pointer; font-weight: 500;
    transition: background 0.15s ease;
  }
  .danger-btn:hover { background: rgba(239,68,68,0.25); }
  .danger-btn.confirmed { background: rgba(239,68,68,0.4); color: #fca5a5; }
  .buttons {
    -webkit-app-region: no-drag;
    display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px;
  }
  button { padding: 6px 16px; font-size: 13px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; }
  .cancel { background: rgba(255,255,255,0.1); color: #e2e8f0; }
  .cancel:hover { background: rgba(255,255,255,0.15); }
  .ok { background: #7C3AED; color: white; }
  .ok:hover { background: #6D28D9; }
</style></head>
<body>
  <h3>Settings</h3>

  <div class="field">
    <label>Click</label>
    ${actionSelect('orbClick', settings.orbClickAction, settings.orbClickPreset, 'orbClickPreset')}
  </div>
  <div class="field">
    <label>&#8984; Cmd + Click</label>
    ${actionSelect('orbCmdClick', settings.orbCmdClickAction, settings.orbCmdClickPreset, 'orbCmdClickPreset')}
  </div>
  <div class="field">
    <label>&#8963; Ctrl + Click</label>
    ${actionSelect('orbCtrlClick', settings.orbCtrlClickAction, settings.orbCtrlClickPreset, 'orbCtrlClickPreset')}
  </div>

  <div class="field">
    <label>Chime Sound</label>
    <div class="sound-row">
      <select id="chimeSound">${soundOptions}</select>
      <button class="preview-btn" onclick="preview()">Test</button>
    </div>
  </div>

  <div class="field">
    <label>Chime Volume</label>
    <div class="volume-row">
      <input type="range" id="chimeVolume" min="0" max="100" value="${settings.chimeVolume}" />
      <span class="volume-label" id="volLabel">${settings.chimeVolume}%</span>
    </div>
  </div>

  <div class="field">
    <label>Max Daily Tokens</label>
    <div style="display:flex;align-items:center;gap:8px;-webkit-app-region:no-drag;">
      <input type="number" id="dailyTokenGoal" min="0" step="10000" value="${settings.dailyTokenGoal}"
        style="width:130px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;-webkit-app-region:no-drag;outline:none;" />
      <span style="font-size:12px;color:#64748b;">0 = hide gauge</span>
    </div>
  </div>

  <div class="danger-section">
    <label>Session History</label>
    <p style="font-size: 12px; color: #64748b; margin: 4px 0 8px;">Remove all saved session history used by "Revive Recent Session".</p>
    <button class="danger-btn" id="clearBtn" onclick="confirmClear()">Clear Session History</button>
  </div>

  <div class="buttons">
    <button class="cancel" onclick="require('electron').ipcRenderer.send('${channelCancel}')">Cancel</button>
    <button class="ok" onclick="submit()">Save</button>
  </div>

  <script>
    const { ipcRenderer } = require('electron');
    const chimeSoundEl = document.getElementById('chimeSound');
    const chimeVolumeEl = document.getElementById('chimeVolume');
    const volLabel = document.getElementById('volLabel');
    const clearBtn = document.getElementById('clearBtn');
    let clearConfirmed = false;

    function togglePreset(selectId, presetSelectId) {
      const sel = document.getElementById(selectId);
      const presetSel = document.getElementById(presetSelectId);
      presetSel.style.display = sel.value === 'preset' ? '' : 'none';
    }

    chimeVolumeEl.addEventListener('input', () => {
      volLabel.textContent = chimeVolumeEl.value + '%';
    });

    function preview() {
      ipcRenderer.send('${channelPreview}', chimeSoundEl.value, parseInt(chimeVolumeEl.value));
    }

    function confirmClear() {
      if (!clearConfirmed) {
        clearConfirmed = true;
        clearBtn.textContent = 'Click again to confirm';
        clearBtn.classList.add('confirmed');
        return;
      }
      clearBtn.textContent = 'History cleared';
      clearBtn.disabled = true;
    }

    function submit() {
      ipcRenderer.send('${channelOk}', {
        chimeSound: chimeSoundEl.value,
        chimeVolume: parseInt(chimeVolumeEl.value),
        orbClickAction: document.getElementById('orbClick').value,
        orbCmdClickAction: document.getElementById('orbCmdClick').value,
        orbCtrlClickAction: document.getElementById('orbCtrlClick').value,
        orbClickPreset: document.getElementById('orbClickPreset').value || '',
        orbCmdClickPreset: document.getElementById('orbCmdClickPreset').value || '',
        orbCtrlClickPreset: document.getElementById('orbCtrlClickPreset').value || '',
        dailyTokenGoal: parseInt(document.getElementById('dailyTokenGoal').value) || 0,
        clearHistory: clearConfirmed,
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
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
