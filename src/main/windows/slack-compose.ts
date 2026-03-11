import { BrowserWindow, ipcMain, clipboard } from 'electron'

export interface SlackComposeResult {
  recipient: string
  message: string
  action: 'copy' | 'cancel'
}

export function showSlackComposeDialog(lastResponse: string): Promise<SlackComposeResult | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
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
      center: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      }
    })

    const channelOk = `slack-ok-${win.id}`
    const channelCancel = `slack-cancel-${win.id}`

    const cleanup = () => {
      ipcMain.removeAllListeners(channelOk)
      ipcMain.removeAllListeners(channelCancel)
    }

    ipcMain.once(channelOk, (_e, recipient: string, message: string) => {
      cleanup()
      win.close()
      // Copy to clipboard
      clipboard.writeText(message)
      // Open Slack
      const { exec } = require('child_process')
      exec('open -a Slack')
      resolve({ recipient, message, action: 'copy' })
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

    // Escape special chars for embedding in HTML
    const escapedResponse = lastResponse
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '\\n')

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
  h3 { font-size: 14px; font-weight: 600; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
  .slack-icon { width: 20px; height: 20px; }
  label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: #94a3b8; }
  input[type="text"], textarea {
    -webkit-app-region: no-drag;
    width: 100%; padding: 7px 10px; font-size: 13px;
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    background: rgba(0,0,0,0.3); color: #e2e8f0; outline: none;
    font-family: inherit;
  }
  input[type="text"]:focus, textarea:focus { border-color: rgba(124,58,237,0.6); }
  textarea { resize: vertical; height: 200px; line-height: 1.5; }
  .field { margin-bottom: 12px; }
  .hint { font-size: 11px; color: #64748b; margin-top: 3px; }
  .buttons {
    -webkit-app-region: no-drag;
    display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;
  }
  button { padding: 6px 16px; font-size: 13px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; }
  .cancel { background: rgba(255,255,255,0.1); color: #e2e8f0; }
  .cancel:hover { background: rgba(255,255,255,0.15); }
  .ok { background: #4A154B; color: white; display: flex; align-items: center; gap: 6px; }
  .ok:hover { background: #611f69; }
  .ok:disabled { opacity: 0.4; cursor: not-allowed; }
  .char-count { font-size: 11px; color: #64748b; text-align: right; margin-top: 2px; }
</style></head>
<body>
  <h3>
    <svg class="slack-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#E01E5A"/>
      <path d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
      <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E"/>
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
    </svg>
    Share to Slack
  </h3>

  <div class="field">
    <label>To (channel or person)</label>
    <input id="recipient" type="text" placeholder="#general, @username, or DM name" autofocus />
    <div class="hint">Type the channel or person you want to message</div>
  </div>

  <div class="field">
    <label>Message</label>
    <textarea id="message"></textarea>
    <div class="char-count" id="charCount">0 chars</div>
  </div>

  <div class="buttons">
    <button class="cancel" onclick="require('electron').ipcRenderer.send('${channelCancel}')">Cancel</button>
    <button class="ok" id="sendBtn" onclick="submit()" disabled>
      Copy & Open Slack
    </button>
  </div>

  <script>
    const { ipcRenderer } = require('electron');
    const recipientEl = document.getElementById('recipient');
    const messageEl = document.getElementById('message');
    const sendBtn = document.getElementById('sendBtn');
    const charCount = document.getElementById('charCount');

    // Load last response
    const lastResponse = "${escapedResponse}";
    messageEl.value = lastResponse.replace(/\\\\n/g, '\\n');
    updateCharCount();

    function updateCharCount() {
      charCount.textContent = messageEl.value.length + ' chars';
    }

    function validate() {
      sendBtn.disabled = !(recipientEl.value.trim() && messageEl.value.trim());
    }

    recipientEl.addEventListener('input', validate);
    messageEl.addEventListener('input', () => { validate(); updateCharCount(); });

    function submit() {
      if (sendBtn.disabled) return;
      ipcRenderer.send('${channelOk}', recipientEl.value.trim(), messageEl.value);
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
