import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { loadReviewPresets, getQuickPreset, deleteReviewPreset } from '../services/review-preset-store'
import { centerOnCursorDisplay } from './display-utils'

export interface QuickPromptResult {
  presetId: string
  template: string
  bypass: boolean
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/**
 * Editor for the prompt that "Quick Review in Carapace" runs without asking.
 *
 * Reachable from the Services menu and the orb menu, since the whole point of quick review is
 * that you never see the review dialog — the prompt has to be editable somewhere else.
 */
export function showQuickPromptDialog(): Promise<QuickPromptResult | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 560,
      height: 630,
      resizable: true,
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

    const channelOk = `quickprompt-ok-${win.id}`
    const channelCancel = `quickprompt-cancel-${win.id}`
    const channelDelete = `quickprompt-delete-${win.id}`
    let settled = false

    const finish = (value: QuickPromptResult | null) => {
      if (settled) return
      settled = true
      ipcMain.removeAllListeners(channelOk)
      ipcMain.removeAllListeners(channelCancel)
      ipcMain.removeAllListeners(channelDelete)
      if (!win.isDestroyed()) win.close()
      resolve(value)
    }

    ipcMain.once(channelOk, (_e, data: QuickPromptResult) => finish(data))
    ipcMain.once(channelCancel, () => finish(null))

    ipcMain.on(channelDelete, async (_e, id: string, name: string) => {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Delete', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Delete the “${name}” review preset?`,
        detail: 'This cannot be undone.',
      })
      if (response !== 0 || win.isDestroyed()) return

      const remaining = deleteReviewPreset(id)
      win.webContents.send(`${channelDelete}-reply`, remaining.map(p => ({
        id: p.id, name: p.name, template: p.template, bypass: !!p.bypass,
      })))
    })

    win.on('closed', () => finish(null))

    const presets = loadReviewPresets()
    const quick = getQuickPreset()
    const selectedIdx = Math.max(0, presets.findIndex(p => p.id === quick?.id))

    const options = presets.map((p, i) =>
      `<option value="${i}"${i === selectedIdx ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('')

    const html = `<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; padding: 20px;
    -webkit-app-region: drag; color: #e2e8f0; display: flex; flex-direction: column; height: 100vh; }
  h3 { font-size: 14px; font-weight: 600; margin-bottom: 2px; }
  .sub { font-size: 12px; color: #94a3b8; margin-bottom: 14px; }
  label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: #94a3b8; }
  select, textarea { -webkit-app-region: no-drag; width: 100%; padding: 7px 10px; font-size: 13px;
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    background: rgba(0,0,0,0.3); color: #e2e8f0; outline: none; font-family: inherit; }
  textarea { resize: none; flex: 1; min-height: 200px; line-height: 1.5;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  select:focus, textarea:focus { border-color: rgba(124,58,237,0.6); }
  select { -webkit-appearance: none; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%2394a3b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px; }
  .field { margin-bottom: 10px; }
  .prompt-field { display: flex; flex-direction: column; flex: 1; margin-bottom: 8px; min-height: 0; }
  .vars { font-size: 11px; color: #64748b; margin-top: 4px; line-height: 1.6; }
  code { background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px;
    font-family: ui-monospace, Menlo, monospace; }
  .preset-row { display: flex; gap: 6px; }
  .preset-row select { flex: 1; }
  .danger { -webkit-app-region: no-drag; padding: 7px 12px; font-size: 12px; border-radius: 6px;
    border: 1px solid rgba(248,113,113,0.35); background: transparent; color: #f87171;
    cursor: pointer; white-space: nowrap; font-weight: 500; }
  .danger:hover:not(:disabled) { background: rgba(248,113,113,0.12); border-color: rgba(248,113,113,0.6); }
  .danger:disabled { opacity: 0.35; cursor: default; }
  .checkbox-row { -webkit-app-region: no-drag; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .checkbox-row input[type="checkbox"] { width: 15px; height: 15px; accent-color: #7C3AED; cursor: pointer; }
  .checkbox-row label { margin-bottom: 0; cursor: pointer; font-size: 12px; color: #e2e8f0; }
  .warn { font-size: 11px; color: #fbbf24; margin: 0 0 6px 23px; line-height: 1.5; display: none; }
  .warn.show { display: block; }
  .buttons { -webkit-app-region: no-drag; display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  button { padding: 6px 16px; font-size: 13px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; }
  .cancel { background: rgba(255,255,255,0.1); color: #e2e8f0; }
  .cancel:hover { background: rgba(255,255,255,0.15); }
  .ok { background: #7C3AED; color: white; }
  .ok:hover { background: #6D28D9; }
  .ok:disabled { opacity: 0.4; cursor: default; }
</style></head>
<body>
  <h3>Quick Review Prompt</h3>
  <div class="sub">Runs immediately when you pick “Quick Review in Carapace” — no dialog.</div>

  <div class="field">
    <label>Preset used for quick review</label>
    <div class="preset-row">
      <select id="preset">${options}</select>
      <button class="danger" id="deleteBtn" onclick="del()" title="Delete this preset">Delete</button>
    </div>
  </div>

  <div class="prompt-field">
    <label>Prompt template</label>
    <textarea id="template" spellcheck="false"></textarea>
    <div class="vars">Placeholders: <code>{{pr_url}}</code> <code>{{owner}}</code>
      <code>{{repo}}</code> <code>{{pr_number}}</code> <code>{{branch}}</code></div>
  </div>

  <div class="checkbox-row">
    <input type="checkbox" id="bypass" />
    <label for="bypass">Skip permissions (<code>--dangerously-skip-permissions</code>)</label>
  </div>
  <div class="warn" id="bypassWarn">Quick review runs unattended. Claude will read and act on
    the PR's diff without asking — only enable this for repos you trust.</div>

  <div class="buttons">
    <button class="cancel" onclick="require('electron').ipcRenderer.send('${channelCancel}')">Cancel</button>
    <button class="ok" id="okBtn" onclick="submit()">Save</button>
  </div>

  <script>
    const { ipcRenderer } = require('electron');
    let presets = ${toScriptJson(presets.map(p => ({ id: p.id, name: p.name, template: p.template, bypass: !!p.bypass })))};
    const presetEl = document.getElementById('preset');
    const deleteBtn = document.getElementById('deleteBtn');
    const templateEl = document.getElementById('template');
    const bypassEl = document.getElementById('bypass');
    const bypassWarn = document.getElementById('bypassWarn');
    const okBtn = document.getElementById('okBtn');

    // Edits are per-preset, so switching the dropdown doesn't lose what you typed
    const edits = {};

    let current = presetEl.value;
    function load(idx) {
      const e = edits[idx];
      templateEl.value = e ? e.template : presets[idx].template;
      bypassEl.checked = e ? e.bypass : presets[idx].bypass;
      current = idx;
      syncWarn();
      validate();
    }
    function remember() {
      edits[current] = { template: templateEl.value, bypass: bypassEl.checked };
    }
    function syncWarn() { bypassWarn.classList.toggle('show', bypassEl.checked); }

    templateEl.addEventListener('input', () => { remember(); validate(); });
    bypassEl.addEventListener('change', () => { remember(); syncWarn(); });
    presetEl.addEventListener('change', () => load(presetEl.value));

    function validate() {
      okBtn.disabled = !templateEl.value.trim();
      // Never let the list get emptied — the review dialog needs something to offer
      deleteBtn.disabled = presets.length <= 1;
    }

    function del() {
      const p = presets[presetEl.value];
      if (!p || deleteBtn.disabled) return;
      ipcRenderer.send('${channelDelete}', p.id, p.name);
    }

    ipcRenderer.on('${channelDelete}-reply', (_e, remaining) => {
      presets = remaining;
      // Edits were keyed by index, which no longer lines up after a removal
      for (const k of Object.keys(edits)) delete edits[k];
      presetEl.innerHTML = '';
      presets.forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = p.name;
        presetEl.appendChild(opt);
      });
      presetEl.value = '0';
      load('0');
    });

    function submit() {
      if (okBtn.disabled) return;
      ipcRenderer.send('${channelOk}', {
        presetId: presets[presetEl.value].id,
        template: templateEl.value,
        bypass: bypassEl.checked,
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.metaKey) submit();
      if (e.key === 'Escape') ipcRenderer.send('${channelCancel}');
    });

    load(presetEl.value);
    templateEl.focus();
  </script>
</body>
</html>`

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    win.once('ready-to-show', () => {
      // Dock is hidden, so the app must be pulled forward explicitly — see review-dialog.ts
      centerOnCursorDisplay(win)
      app.focus({ steal: true })
      win.show()
      win.focus()
      win.moveTop()
    })
  })
}
