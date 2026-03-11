import { BrowserWindow, ipcMain, app } from 'electron'
import { SNIPPET_ICONS } from '@shared/constants/snippet-icons'

export interface SnippetInput {
  icon: string
  label: string
  prompt: string
}

export interface SnippetEditData {
  icon: string
  label: string
  prompt: string
}

export function showSnippetDialog(editData?: SnippetEditData): Promise<SnippetInput | null> {
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

    const channelEmoji = `snippet-emoji-${win.id}`

    const cleanup = () => {
      ipcMain.removeAllListeners(channelOk)
      ipcMain.removeAllListeners(channelCancel)
      ipcMain.removeAllListeners(channelEmoji)
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

    ipcMain.on(channelEmoji, () => {
      app.showEmojiPanel()
    })

    win.on('closed', () => {
      cleanup()
      resolve(null)
    })

    // Quick-pick favorites row (subset of most useful icons)
    const quickPicks = ['rocket', 'lightning', 'bug', 'code', 'fire', 'wand', 'test', 'search', 'shield', 'wrench', 'broom', 'target']
    const quickPickHtml = quickPicks.map(key => {
      const emoji = SNIPPET_ICONS[key] || ''
      return `<button class="icon-opt" data-emoji="${emoji}" onclick="selectEmoji('${emoji}')" title="${key}">${emoji}</button>`
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
  .icon-row {
    -webkit-app-region: no-drag;
    display: flex; align-items: center; gap: 8px;
  }
  .emoji-preview {
    width: 42px; height: 42px; border-radius: 8px; border: 2px solid rgba(255,255,255,0.15);
    background: rgba(0,0,0,0.3); font-size: 22px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .emoji-preview.has-emoji { border-color: #7C3AED; background: rgba(124,58,237,0.2); }
  .emoji-input {
    width: 56px !important; font-size: 22px !important; text-align: center;
    padding: 6px 4px !important; flex-shrink: 0;
  }
  .pick-btn {
    -webkit-app-region: no-drag;
    padding: 6px 12px; font-size: 12px; border-radius: 6px; border: none;
    background: rgba(255,255,255,0.1); color: #e2e8f0; cursor: pointer;
    font-weight: 500; white-space: nowrap;
  }
  .pick-btn:hover { background: rgba(255,255,255,0.18); }
  .quick-picks {
    -webkit-app-region: no-drag;
    display: flex; flex-wrap: wrap; gap: 3px; margin-top: 6px;
  }
  .icon-opt {
    width: 32px; height: 32px; border-radius: 6px; border: 2px solid transparent;
    background: rgba(255,255,255,0.06); font-size: 16px;
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
  <h3>${editData ? 'Edit Snippet' : 'New Quick Snippet'}</h3>
  <div class="field">
    <label>Name</label>
    <input id="label" type="text" placeholder="e.g. Add context files" value="${editData ? editData.label.replace(/"/g, '&quot;') : ''}" autofocus />
  </div>
  <div class="field">
    <label>Prompt Text</label>
    <textarea id="prompt" placeholder="Text that will be pasted into the terminal...">${editData ? editData.prompt.replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''}</textarea>
  </div>
  <div class="field">
    <label>Icon</label>
    <div class="icon-row">
      <div class="emoji-preview" id="emojiPreview"></div>
      <input id="emojiInput" class="emoji-input" type="text" placeholder="?" maxlength="4" />
      <button class="pick-btn" onclick="pickEmoji()">Emoji Picker...</button>
    </div>
    <div class="quick-picks">${quickPickHtml}</div>
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
    const emojiInput = document.getElementById('emojiInput');
    const emojiPreview = document.getElementById('emojiPreview');
    let selectedIcon = '';

    function setIcon(emoji) {
      selectedIcon = emoji;
      emojiPreview.textContent = emoji;
      emojiPreview.classList.toggle('has-emoji', !!emoji);
      emojiInput.value = emoji;
      document.querySelectorAll('.icon-opt').forEach(el => {
        el.classList.toggle('selected', el.dataset.emoji === emoji);
      });
      validate();
    }

    function selectEmoji(emoji) {
      setIcon(emoji);
    }

    function pickEmoji() {
      emojiInput.value = '';
      emojiInput.focus();
      ipcRenderer.send('${channelEmoji}');
    }

    // Detect emoji typed or inserted via IME/emoji picker
    emojiInput.addEventListener('input', () => {
      const val = emojiInput.value.trim();
      if (val) setIcon(val);
    });

    // Polling fallback for macOS emoji picker IME insertion
    setInterval(() => {
      const val = emojiInput.value.trim();
      if (val && val !== selectedIcon) setIcon(val);
    }, 200);

    function validate() {
      saveBtn.disabled = !(labelEl.value.trim() && promptEl.value.trim() && selectedIcon);
    }

    labelEl.addEventListener('input', validate);
    promptEl.addEventListener('input', validate);

    // Pre-fill when editing
    ${editData ? `setIcon(${JSON.stringify(editData.icon)}); validate();` : ''}

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
