import { BrowserWindow, ipcMain, dialog } from 'electron'
import type { Stack } from '@shared/types/stack'

/**
 * Show a path-verification dialog before importing stacks received from another user.
 * Returns the verified/modified stacks ready to pass to importStacks(), or null if cancelled.
 */
export function showStackImportDialog(stacks: Omit<Stack, 'id'>[]): Promise<Omit<Stack, 'id'>[] | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 560,
      minHeight: 360,
      resizable: true,
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

    const channelOk = `stack-import-ok-${win.id}`
    const channelCancel = `stack-import-cancel-${win.id}`
    const channelBrowse = `stack-import-browse-${win.id}`

    const cleanup = () => {
      ipcMain.removeAllListeners(channelOk)
      ipcMain.removeAllListeners(channelCancel)
      ipcMain.removeAllListeners(channelBrowse)
    }

    ipcMain.once(channelOk, (_e, result: Omit<Stack, 'id'>[]) => {
      cleanup()
      win.close()
      resolve(result)
    })

    ipcMain.once(channelCancel, () => {
      cleanup()
      win.close()
      resolve(null)
    })

    ipcMain.on(channelBrowse, async (_e, token: string) => {
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select Path',
      })
      if (!result.canceled && result.filePaths[0]) {
        win.webContents.send(`${channelBrowse}-reply`, { token, path: result.filePaths[0] })
      }
    })

    win.on('closed', () => {
      cleanup()
      resolve(null)
    })

    const initData = JSON.stringify(stacks)

    const html = `<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    padding: 20px;
    -webkit-app-region: drag;
    color: #e2e8f0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h3 { font-size: 14px; font-weight: 600; }
  .subtitle { font-size: 12px; color: rgba(255,255,255,0.45); margin-top: 2px; }
  .stacks-scroll {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-right: 2px;
  }
  .stack-section {
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    overflow: hidden;
  }
  .stack-header {
    padding: 10px 12px 8px;
    background: rgba(255,255,255,0.04);
    border-bottom: 1px solid rgba(255,255,255,0.07);
  }
  .stack-header-name { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.9); }
  .stack-header-desc { font-size: 11px; color: rgba(255,255,255,0.45); margin-top: 1px; }
  .path-block { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .path-block:last-child { border-bottom: none; }
  .path-label {
    font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.35);
    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 5px;
  }
  .path-row {
    -webkit-app-region: no-drag;
    display: flex; align-items: center; gap: 6px;
  }
  .path-input {
    flex: 1;
    padding: 5px 8px; font-size: 12px;
    border: 1px solid rgba(255,255,255,0.12); border-radius: 5px;
    background: rgba(0,0,0,0.25); color: #e2e8f0; outline: none;
    font-family: 'SF Mono', Monaco, monospace;
  }
  .path-input:focus { border-color: rgba(124,58,237,0.5); }
  .status-icon { font-size: 13px; flex-shrink: 0; width: 16px; text-align: center; }
  .status-ok { color: #34d399; }
  .status-err { color: #f87171; }
  .browse-btn {
    -webkit-app-region: no-drag;
    padding: 5px 8px; font-size: 11px; border-radius: 4px; border: none;
    background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6);
    cursor: pointer; white-space: nowrap;
  }
  .browse-btn:hover { background: rgba(255,255,255,0.14); color: rgba(255,255,255,0.9); }
  .remove-btn {
    -webkit-app-region: no-drag;
    padding: 5px 8px; font-size: 11px; border-radius: 4px; border: none;
    background: rgba(255,255,255,0.05); color: rgba(255,100,100,0.55);
    cursor: pointer; white-space: nowrap;
  }
  .remove-btn:hover { background: rgba(255,80,80,0.15); color: rgba(255,150,150,0.85); }
  .project-name-chip {
    font-size: 11px; font-weight: 500; color: rgba(255,255,255,0.65);
    margin-bottom: 5px;
  }
  .buttons {
    -webkit-app-region: no-drag;
    display: flex; justify-content: flex-end; gap: 8px;
    padding-top: 4px;
    border-top: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
  }
  button.cancel { padding: 6px 16px; font-size: 13px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; background: rgba(255,255,255,0.1); color: #e2e8f0; }
  button.cancel:hover { background: rgba(255,255,255,0.15); }
  button.ok { padding: 6px 16px; font-size: 13px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; background: #7C3AED; color: white; }
  button.ok:hover { background: #6D28D9; }
  /* scrollbar */
  .stacks-scroll::-webkit-scrollbar { width: 4px; }
  .stacks-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
</style></head>
<body>
  <div>
    <h3>Import Stacks</h3>
    <div class="subtitle">Verify paths before importing — paths from another machine may need updating.</div>
  </div>
  <div class="stacks-scroll" id="stacks-scroll"></div>
  <div class="buttons">
    <button class="cancel" id="cancel-btn">Cancel</button>
    <button class="ok" id="ok-btn">Import</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const fs = require('fs');
    const os = require('os');

    const stacks = ${initData};
    const scroll = document.getElementById('stacks-scroll');

    function expandPath(p) {
      if (!p) return '';
      return p.replace(/^~/, os.homedir());
    }

    function pathExists(p) {
      try { return fs.existsSync(expandPath(p)); } catch { return false; }
    }

    function makeStatusIcon(p) {
      const span = document.createElement('span');
      span.className = 'status-icon';
      function update(val) {
        const exists = pathExists(val);
        span.className = 'status-icon ' + (exists ? 'status-ok' : 'status-err');
        span.textContent = exists ? '✓' : '✗';
      }
      update(p);
      return { el: span, update };
    }

    function makePathRow(value, browseToken, onRemove) {
      const row = document.createElement('div');
      row.className = 'path-row';

      const input = document.createElement('input');
      input.className = 'path-input';
      input.value = value;

      const { el: statusEl, update: updateStatus } = makeStatusIcon(value);
      input.addEventListener('input', () => updateStatus(input.value));

      const browseBtn = document.createElement('button');
      browseBtn.className = 'browse-btn';
      browseBtn.textContent = 'Browse';
      browseBtn.addEventListener('click', () => ipcRenderer.send('${channelBrowse}', browseToken));

      row.appendChild(input);
      row.appendChild(statusEl);
      row.appendChild(browseBtn);

      if (onRemove) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => onRemove());
        row.appendChild(removeBtn);
      }

      return { row, getPath: () => input.value };
    }

    // We store references to project blocks so we can collect them on submit
    const stackGetters = [];

    stacks.forEach((stack, si) => {
      const section = document.createElement('div');
      section.className = 'stack-section';

      // Header
      const header = document.createElement('div');
      header.className = 'stack-header';
      const hn = document.createElement('div');
      hn.className = 'stack-header-name';
      hn.textContent = stack.name;
      header.appendChild(hn);
      if (stack.description) {
        const hd = document.createElement('div');
        hd.className = 'stack-header-desc';
        hd.textContent = stack.description;
        header.appendChild(hd);
      }
      section.appendChild(header);

      // System path block
      const sysBlock = document.createElement('div');
      sysBlock.className = 'path-block';
      const sysLabel = document.createElement('div');
      sysLabel.className = 'path-label';
      sysLabel.textContent = 'System Path';
      sysBlock.appendChild(sysLabel);
      const sysToken = 'sys-' + si;
      const { row: sysRow, getPath: getSysPath } = makePathRow(stack.systemPath || '', sysToken, null);
      ipcRenderer.on('${channelBrowse}-reply', (_e, { token, path }) => {
        if (token === sysToken) {
          sysRow.querySelector('.path-input').value = path;
          sysRow.querySelector('.path-input').dispatchEvent(new Event('input'));
        }
      });
      sysBlock.appendChild(sysRow);
      section.appendChild(sysBlock);

      // Projects blocks
      const projects = stack.projects || [];
      const projectGetters = [];

      function renderProjects() {
        // Remove existing project blocks
        section.querySelectorAll('.project-path-block').forEach(el => el.remove());
        // Re-add for current projects list
        // (we keep a live array)
      }

      // Live array of project objects
      const liveProjects = projects.map(p => ({ ...p }));

      function rebuildProjectBlocks() {
        section.querySelectorAll('.project-path-block').forEach(el => el.remove());
        projectGetters.length = 0;
        liveProjects.forEach((proj, pi) => {
          const block = document.createElement('div');
          block.className = 'path-block project-path-block';

          const nameChip = document.createElement('div');
          nameChip.className = 'project-name-chip';
          nameChip.textContent = proj.name;
          block.appendChild(nameChip);

          const token = 'proj-' + si + '-' + pi + '-' + Date.now();
          const { row, getPath } = makePathRow(proj.path || '', token, () => {
            liveProjects.splice(pi, 1);
            rebuildProjectBlocks();
          });

          ipcRenderer.on('${channelBrowse}-reply', (_e, data) => {
            if (data.token === token) {
              row.querySelector('.path-input').value = data.path;
              row.querySelector('.path-input').dispatchEvent(new Event('input'));
            }
          });

          projectGetters.push({ proj, getPath });
          block.appendChild(row);
          section.appendChild(block);
        });
      }

      rebuildProjectBlocks();

      stackGetters.push({
        stack,
        getSysPath,
        getProjectGetters: () => projectGetters,
        getLiveProjects: () => liveProjects,
      });

      scroll.appendChild(section);
    });

    document.getElementById('cancel-btn').addEventListener('click', () => {
      ipcRenderer.send('${channelCancel}');
    });

    document.getElementById('ok-btn').addEventListener('click', () => {
      const result = stackGetters.map(({ stack, getSysPath, getProjectGetters, getLiveProjects }) => ({
        name: stack.name,
        description: stack.description,
        systemPath: getSysPath(),
        projects: getProjectGetters().map(({ proj, getPath }, i) => ({
          name: getLiveProjects()[i]?.name || proj.name,
          path: getPath(),
        })),
      }));
      ipcRenderer.send('${channelOk}', result);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') ipcRenderer.send('${channelCancel}');
    });
  </script>
</body>
</html>`

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    win.once('ready-to-show', () => win.show())
  })
}
