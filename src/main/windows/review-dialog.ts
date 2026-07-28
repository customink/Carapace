import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { loadReviewPresets, addReviewPreset } from '../services/review-preset-store'
import { showTextInputDialog } from './text-input-dialog'
import { centerOnCursorDisplay } from './display-utils'
import type { ParsedPr } from '../services/pr-resolver'

export interface ReviewDialogResult {
  prompt: string
  cwd: string
  worktree: boolean
  bypass: boolean
  reviewPresetId: string
}

/** Outcome of the caller's async preparation step (git worktree checkout). */
export type PrepareResult = { ok: true; cwd: string } | { ok: false; error: string }

export interface ReviewDialogOptions {
  pr: ParsedPr
  /**
   * Resolves to the local clone path, or '' if none was found.
   *
   * A promise rather than a value on purpose: looking the path up shells out to git once per
   * candidate, so awaiting it before opening the window would leave the engineer staring at
   * nothing after clicking the Slack button. The dialog opens immediately and fills the field
   * when this settles.
   */
  repoPath: Promise<string>
  /** Quoted text the link came with, if any. Drives the skip-permissions warning. */
  slackMessage?: string
  /** Preset name or id requested by the deep link. */
  requestedPreset?: string
  /** Renders a preset template with the current PR/Slack variables. */
  render: (template: string) => string
  /** Runs the git work. The dialog stays open showing progress until this resolves. */
  prepare: (result: ReviewDialogResult) => Promise<PrepareResult>
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Safe to embed in a <script> block — closes no tags and breaks no strings. */
function toScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/**
 * Turns an edited prompt back into a reusable template by swapping this PR's details for
 * placeholders, and dropping the quoted Slack text (which belongs to one message, not to a
 * saved preset).
 *
 * Best-effort: a bare PR number in prose won't be caught, which is why the saved template is
 * editable afterwards.
 */
function genericize(prompt: string, pr: ParsedPr): string {
  const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return prompt
    // Slack context block appended by appendSlackContext()
    .replace(
      /\n*(?:Slack thread: \S+\n*)?Untrusted quoted text from Slack[^\n]*\n```\n[\s\S]*?\n```/g,
      '\n\n{{slack_message}}'
    )
    .replace(new RegExp(escapeRe(pr.url), 'g'), '{{pr_url}}')
    .replace(new RegExp(escapeRe(`carapace-review/pr-${pr.number}`), 'g'), '{{branch}}')
    .replace(new RegExp(escapeRe(`${pr.owner}/${pr.repo}`), 'g'), '{{owner}}/{{repo}}')
    .replace(new RegExp(`#${pr.number}\\b`, 'g'), '#{{pr_number}}')
    // `gh pr diff 42` / `gh pr checkout 42`
    .replace(new RegExp(`(gh pr \\w+ )${pr.number}\\b`, 'g'), '$1{{pr_number}}')
    .trimEnd()
}

/**
 * The editable review prompt dialog.
 *
 * This dialog is a security control, not a convenience. The prompt it shows may embed text
 * from a Slack message, which any workspace member can write. A human reads the prompt before
 * anything runs, and "skip permissions" defaults off and must be turned on deliberately here.
 * Do not add a "don't ask again" path for Slack-originated reviews.
 */
export function showReviewDialog(opts: ReviewDialogOptions): Promise<(ReviewDialogResult & { cwd: string }) | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 560,
      height: 640,
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

    const channelOk = `review-ok-${win.id}`
    const channelCancel = `review-cancel-${win.id}`
    const channelBrowse = `review-browse-${win.id}`
    const channelSave = `review-save-${win.id}`
    let settled = false

    const cleanup = () => {
      ipcMain.removeAllListeners(channelOk)
      ipcMain.removeAllListeners(channelCancel)
      ipcMain.removeAllListeners(channelBrowse)
      ipcMain.removeAllListeners(channelSave)
    }

    const finish = (value: (ReviewDialogResult & { cwd: string }) | null) => {
      if (settled) return
      settled = true
      cleanup()
      if (!win.isDestroyed()) win.close()
      resolve(value)
    }

    ipcMain.on(channelOk, async (_e, data: ReviewDialogResult) => {
      const prepared = await opts.prepare(data)
      if (prepared.ok) {
        finish({ ...data, cwd: prepared.cwd })
        return
      }
      if (!win.isDestroyed()) {
        win.webContents.send(`${channelOk}-error`, prepared.error)
      }
    })

    ipcMain.once(channelCancel, () => finish(null))

    ipcMain.on(channelSave, async (_e, data: { prompt: string; worktree: boolean }) => {
      const name = await showTextInputDialog({
        title: 'Save Review Preset',
        label: 'Preset name',
        placeholder: 'e.g. Rails deep dive',
        okLabel: 'Save',
        parent: win,
      })
      if (!name || win.isDestroyed()) return

      const template = genericize(data.prompt, opts.pr)
      const saved = addReviewPreset({ name, template, worktree: data.worktree })
      const added = saved[saved.length - 1]!
      win.webContents.send(`${channelSave}-reply`, {
        id: added.id,
        name: added.name,
        worktree: added.worktree,
        prompt: opts.render(added.template),
      })
    })

    ipcMain.on(channelBrowse, async () => {
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: `Where is ${opts.pr.owner}/${opts.pr.repo} checked out?`,
      })
      if (!result.canceled && result.filePaths[0]) {
        win.webContents.send(`${channelBrowse}-reply`, result.filePaths[0])
      }
    })

    win.on('closed', () => finish(null))

    const presets = loadReviewPresets()
    const wanted = (opts.requestedPreset || '').toLowerCase()
    const selectedIdx = Math.max(0, presets.findIndex(p =>
      p.id.toLowerCase() === wanted || p.name.toLowerCase() === wanted
    ))

    // Pre-render every preset so switching the dropdown is instant and offline
    const rendered = presets.map(p => ({
      id: p.id,
      name: p.name,
      worktree: p.worktree,
      prompt: opts.render(p.template),
    }))

    const presetOptions = presets.map((p, i) =>
      `<option value="${i}"${i === selectedIdx ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('')

    const channelRepo = `review-repo-${win.id}`
    const prLabel = `${opts.pr.owner}/${opts.pr.repo} #${opts.pr.number}`

    // Push the resolved clone path in once it lands, without holding the window closed.
    // Gated on did-finish-load: a remembered path resolves in ~10ms, well before the data-URL
    // renderer has registered its listener, and an early send is dropped silently.
    const loaded = new Promise<void>(resolve => {
      win.webContents.once('did-finish-load', () => resolve())
    })
    void Promise.all([opts.repoPath, loaded])
      .then(([resolved]) => {
        if (!win.isDestroyed()) win.webContents.send(channelRepo, resolved || '')
      })
      .catch(() => {
        if (!win.isDestroyed()) win.webContents.send(channelRepo, '')
      })

    const html = `<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; padding: 20px;
    -webkit-app-region: drag; color: #e2e8f0; display: flex; flex-direction: column; height: 100vh; }
  h3 { font-size: 14px; font-weight: 600; margin-bottom: 2px; }
  .pr { font-size: 12px; color: #94a3b8; margin-bottom: 14px; }
  .pr b { color: #c4b5fd; font-weight: 600; }
  label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: #94a3b8; }
  input[type="text"], textarea, select {
    -webkit-app-region: no-drag; width: 100%; padding: 7px 10px; font-size: 13px;
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    background: rgba(0,0,0,0.3); color: #e2e8f0; outline: none; font-family: inherit;
  }
  textarea { resize: none; flex: 1; min-height: 140px; line-height: 1.5;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  input:focus, textarea:focus, select:focus { border-color: rgba(124,58,237,0.6); }
  select { -webkit-appearance: none; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%2394a3b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px; }
  .field { margin-bottom: 10px; }
  .prompt-field { display: flex; flex-direction: column; flex: 1; margin-bottom: 10px; min-height: 0; }
  .folder-row { display: flex; gap: 6px; }
  .folder-row input { flex: 1; }
  .browse { -webkit-app-region: no-drag; padding: 7px 12px; font-size: 12px; border-radius: 6px;
    border: none; background: rgba(255,255,255,0.1); color: #e2e8f0; cursor: pointer;
    white-space: nowrap; font-weight: 500; }
  .browse:hover { background: rgba(255,255,255,0.15); }
  .checkbox-row { -webkit-app-region: no-drag; display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .checkbox-row input[type="checkbox"] { width: 15px; height: 15px; accent-color: #7C3AED; cursor: pointer; }
  .checkbox-row label { margin-bottom: 0; cursor: pointer; font-size: 12px; color: #e2e8f0; }
  .warn { font-size: 11px; color: #fbbf24; margin: -4px 0 8px 23px; display: none; }
  .warn.show { display: block; }
  .note { font-size: 11px; color: #64748b; margin-top: 3px; }
  .note.alert { color: #fbbf24; }
  .status { font-size: 12px; min-height: 16px; margin-top: 8px; }
  .status.err { color: #f87171; }
  .status.busy { color: #94a3b8; }
  .buttons { -webkit-app-region: no-drag; display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  .spacer { flex: 1; }
  .ghost { background: transparent; color: #94a3b8; border: 1px solid rgba(255,255,255,0.15); }
  .ghost:hover { color: #e2e8f0; border-color: rgba(255,255,255,0.3); }
  .ghost:disabled { opacity: 0.4; cursor: default; }
  button { padding: 6px 16px; font-size: 13px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; }
  .cancel { background: rgba(255,255,255,0.1); color: #e2e8f0; }
  .cancel:hover { background: rgba(255,255,255,0.15); }
  .ok { background: #7C3AED; color: white; }
  .ok:hover { background: #6D28D9; }
  .ok:disabled { opacity: 0.4; cursor: default; }
</style></head>
<body>
  <h3>Review Pull Request</h3>
  <div class="pr"><b>${escapeHtml(prLabel)}</b></div>

  <div class="field">
    <label>Review preset</label>
    <select id="preset">${presetOptions}</select>
  </div>

  <div class="prompt-field">
    <label>Prompt — edit before launching</label>
    <textarea id="prompt" spellcheck="false"></textarea>
  </div>

  <div class="field">
    <label>Repository</label>
    <div class="folder-row">
      <input id="cwd" type="text" value="" placeholder="Path to your local clone" />
      <button class="browse" onclick="require('electron').ipcRenderer.send('${channelBrowse}')">Browse</button>
    </div>
    <div class="note" id="cwdNote">Looking for your clone of ${escapeHtml(opts.pr.repo)}…</div>
  </div>

  <div class="checkbox-row">
    <input type="checkbox" id="worktree" checked />
    <label for="worktree">Check out into a separate worktree (leaves your branch alone)</label>
  </div>

  <div class="checkbox-row">
    <input type="checkbox" id="bypass" />
    <label for="bypass">Skip permissions</label>
  </div>
  <div class="warn" id="bypassWarn">This prompt contains text from Slack. Only skip permissions if you've read it.</div>

  <div class="status" id="status"></div>

  <div class="buttons">
    <button class="ghost" id="saveBtn" onclick="savePreset()">Save as Preset…</button>
    <div class="spacer"></div>
    <button class="cancel" id="cancelBtn" onclick="require('electron').ipcRenderer.send('${channelCancel}')">Cancel</button>
    <button class="ok" id="okBtn" onclick="submit()">Launch Review</button>
  </div>

  <script>
    const { ipcRenderer } = require('electron');
    const presets = ${toScriptJson(rendered)};
    const hasSlackText = ${opts.slackMessage ? 'true' : 'false'};

    const presetEl = document.getElementById('preset');
    const promptEl = document.getElementById('prompt');
    const cwdEl = document.getElementById('cwd');
    const worktreeEl = document.getElementById('worktree');
    const bypassEl = document.getElementById('bypass');
    const bypassWarn = document.getElementById('bypassWarn');
    const statusEl = document.getElementById('status');
    const okBtn = document.getElementById('okBtn');
    const saveBtn = document.getElementById('saveBtn');

    // Tracks whether the user has hand-edited the prompt, so switching presets
    // doesn't silently discard their edits.
    let dirty = false;

    function applyPreset() {
      const p = presets[presetEl.value];
      if (!p) return;
      promptEl.value = p.prompt;
      worktreeEl.checked = p.worktree;
      dirty = false;
    }

    presetEl.addEventListener('change', () => {
      if (dirty && !confirm('Replace your edits with the ' + presets[presetEl.value].name + ' template?')) {
        return;
      }
      applyPreset();
    });

    promptEl.addEventListener('input', () => { dirty = true; validate(); });
    cwdEl.addEventListener('input', validate);

    bypassEl.addEventListener('change', () => {
      bypassWarn.classList.toggle('show', bypassEl.checked && hasSlackText);
    });

    function validate() {
      okBtn.disabled = !(promptEl.value.trim() && cwdEl.value.trim());
    }

    function savePreset() {
      if (!promptEl.value.trim()) return;
      ipcRenderer.send('${channelSave}', {
        prompt: promptEl.value,
        worktree: worktreeEl.checked,
      });
    }

    ipcRenderer.on('${channelSave}-reply', (_e, preset) => {
      presets.push(preset);
      const opt = document.createElement('option');
      opt.value = String(presets.length - 1);
      opt.textContent = preset.name;
      presetEl.appendChild(opt);
      presetEl.value = String(presets.length - 1);
      dirty = false;
      statusEl.className = 'status';
      statusEl.textContent = 'Saved preset "' + preset.name + '".';
    });

    function setBusy(on, message) {
      okBtn.disabled = on;
      saveBtn.disabled = on;
      presetEl.disabled = on;
      promptEl.readOnly = on;
      statusEl.className = 'status' + (on ? ' busy' : '');
      statusEl.textContent = message || '';
      if (!on) validate();
    }

    function submit() {
      if (okBtn.disabled) return;
      setBusy(true, worktreeEl.checked ? 'Checking out the PR…' : 'Starting session…');
      ipcRenderer.send('${channelOk}', {
        prompt: promptEl.value,
        cwd: cwdEl.value.trim(),
        worktree: worktreeEl.checked,
        bypass: bypassEl.checked,
        reviewPresetId: presets[presetEl.value] ? presets[presetEl.value].id : '',
      });
    }

    ipcRenderer.on('${channelOk}-error', (_e, message) => {
      setBusy(false);
      statusEl.className = 'status err';
      statusEl.textContent = message;
    });

    const cwdNote = document.getElementById('cwdNote');

    ipcRenderer.on('${channelBrowse}-reply', (_e, path) => {
      cwdEl.value = path;
      cwdNote.className = 'note';
      cwdNote.textContent = 'This path will be remembered for this repo.';
      validate();
    });

    // Background clone lookup finished — don't clobber a path the user already typed or picked
    ipcRenderer.on('${channelRepo}', (_e, path) => {
      if (cwdEl.value.trim()) return;
      if (path) {
        cwdEl.value = path;
        cwdNote.className = 'note';
        cwdNote.textContent = 'Resolved from your stacks.';
      } else {
        cwdNote.className = 'note alert';
        cwdNote.textContent = "Couldn't find a local clone — pick it once and it'll be remembered.";
      }
      validate();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.metaKey) submit();
      if (e.key === 'Escape') ipcRenderer.send('${channelCancel}');
    });

    applyPreset();
    validate();
    promptEl.focus();
  </script>
</body>
</html>`

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    win.once('ready-to-show', () => {
      // Carapace runs with the dock hidden, so it can't come forward on its own. Without
      // this the dialog opens behind whatever app you triggered the review from (Slack) and
      // looks like nothing happened.
      centerOnCursorDisplay(win)
      app.focus({ steal: true })
      win.show()
      win.focus()
      win.moveTop()
    })
  })
}
