import { BrowserWindow, ipcMain, dialog } from 'electron'
import type { Stack } from '@shared/types/stack'

export interface StackDialogResult {
  name: string
  description: string
  systemPath: string
  projects: { name: string; path: string }[]
  bypass: boolean
}

export function showStackDialog(existing?: Omit<Stack, 'id'>, mode?: 'new' | 'edit'): Promise<StackDialogResult | null> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 500,
      minHeight: 400,
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

    const channelOk = `stack-ok-${win.id}`
    const channelCancel = `stack-cancel-${win.id}`
    const channelBrowseSystem = `stack-browse-system-${win.id}`
    const channelBrowseProject = `stack-browse-project-${win.id}`

    const cleanup = () => {
      ipcMain.removeAllListeners(channelOk)
      ipcMain.removeAllListeners(channelCancel)
      ipcMain.removeAllListeners(channelBrowseSystem)
      ipcMain.removeAllListeners(channelBrowseProject)
    }

    ipcMain.once(channelOk, (_e, data: StackDialogResult) => {
      cleanup()
      win.close()
      resolve(data)
    })

    ipcMain.once(channelCancel, () => {
      cleanup()
      win.close()
      resolve(null)
    })

    ipcMain.on(channelBrowseSystem, async () => {
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select Stack System Path',
      })
      if (!result.canceled && result.filePaths[0]) {
        win.webContents.send(`${channelBrowseSystem}-reply`, result.filePaths[0])
      }
    })

    ipcMain.on(channelBrowseProject, async (_e, idx: number) => {
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select Project Path',
      })
      if (!result.canceled && result.filePaths[0]) {
        win.webContents.send(`${channelBrowseProject}-reply`, { idx, path: result.filePaths[0] })
      }
    })

    win.on('closed', () => {
      cleanup()
      resolve(null)
    })

    const isEdit = mode === 'edit' || (!!existing && mode !== 'new')
    const heading = isEdit ? 'Edit Stack' : 'New Stack'
    const btnLabel = isEdit ? 'Save' : 'Create'

    const initName = existing?.name || ''
    const initDescription = existing?.description || ''
    const initSystemPath = existing?.systemPath || ''
    const initProjects = JSON.stringify(existing?.projects || [])
    const initBypass = existing?.bypass ?? false

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
  }
  h3 { font-size: 14px; font-weight: 600; margin-bottom: 14px; }
  label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: #94a3b8; }
  input[type="text"] {
    -webkit-app-region: no-drag;
    width: 100%; padding: 7px 10px; font-size: 13px;
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    background: rgba(0,0,0,0.3); color: #e2e8f0; outline: none;
  }
  input:focus { border-color: rgba(124,58,237,0.6); }
  .field { margin-bottom: 10px; }
  .path-row { display: flex; gap: 6px; }
  .path-row input { flex: 1; }
  .browse {
    -webkit-app-region: no-drag;
    padding: 7px 12px; font-size: 12px; border-radius: 6px; border: none;
    background: rgba(255,255,255,0.1); color: #e2e8f0; cursor: pointer;
    white-space: nowrap; font-weight: 500;
  }
  .browse:hover { background: rgba(255,255,255,0.15); }
  .projects-section {
    flex: 1;
    overflow-y: auto;
    margin-bottom: 10px;
    min-height: 60px;
  }
  .projects-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .projects-label label { margin-bottom: 0; }
  .add-project-btn {
    -webkit-app-region: no-drag;
    padding: 3px 10px; font-size: 11px; border-radius: 4px; border: none;
    background: rgba(124,58,237,0.3); color: #a78bfa; cursor: pointer;
    font-weight: 500;
  }
  .add-project-btn:hover { background: rgba(124,58,237,0.5); }
  .project-row {
    -webkit-app-region: no-drag;
    display: flex; gap: 4px; align-items: center; margin-bottom: 6px;
  }
  .project-row input { flex: 1; }
  .project-name { width: 110px !important; flex: none !important; }
  .remove-btn {
    padding: 6px 8px; font-size: 12px; border-radius: 4px; border: none;
    background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.4);
    cursor: pointer; line-height: 1;
  }
  .remove-btn:hover { background: rgba(255,80,80,0.2); color: rgba(255,150,150,0.8); }
  .empty-projects {
    font-size: 12px; color: rgba(255,255,255,0.3);
    padding: 8px 0; text-align: center;
  }
  .bypass-row {
    -webkit-app-region: no-drag;
    display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
    font-size: 12px; color: #94a3b8;
  }
  .bypass-row input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; accent-color: #7C3AED; }
  .bypass-row label { cursor: pointer; user-select: none; }
  .buttons {
    -webkit-app-region: no-drag;
    display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px;
    border-top: 1px solid rgba(255,255,255,0.06);
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
    <label>Stack Name</label>
    <input id="name" type="text" placeholder="e.g. inkbase" value="${initName.replace(/"/g, '&quot;')}" autofocus />
  </div>
  <div class="field">
    <label>Description</label>
    <input id="description" type="text" placeholder="What is this stack for?" value="${initDescription.replace(/"/g, '&quot;')}" />
  </div>
  <div class="field">
    <label>System Path</label>
    <div class="path-row">
      <input id="systemPath" type="text" placeholder="~/Documents/dbt" value="${initSystemPath.replace(/"/g, '&quot;')}" />
      <button class="browse" id="browse-system-btn">Browse</button>
    </div>
  </div>
  <div class="projects-section">
    <div class="projects-label">
      <label>Projects</label>
      <button class="add-project-btn" id="add-project-btn">+ Add</button>
    </div>
    <div id="projects-list"></div>
  </div>
  <div class="bypass-row">
    <input type="checkbox" id="bypass" ${initBypass ? 'checked' : ''} />
    <label for="bypass">Skip permissions</label>
  </div>
  <div class="buttons">
    <button class="cancel" id="cancel-btn">Cancel</button>
    <button class="ok" id="okBtn">${btnLabel}</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const nameEl = document.getElementById('name');
    const descriptionEl = document.getElementById('description');
    const systemPathEl = document.getElementById('systemPath');
    const bypassEl = document.getElementById('bypass');
    const projectsList = document.getElementById('projects-list');
    const addProjectBtn = document.getElementById('add-project-btn');
    const okBtn = document.getElementById('okBtn');
    const initProjects = ${initProjects};

    function updateOk() { okBtn.disabled = !nameEl.value.trim(); }
    nameEl.addEventListener('input', updateOk);
    updateOk();

    document.getElementById('browse-system-btn').addEventListener('click', () => {
      ipcRenderer.send('${channelBrowseSystem}');
    });
    ipcRenderer.on('${channelBrowseSystem}-reply', (_e, path) => {
      systemPathEl.value = path;
    });

    ipcRenderer.on('${channelBrowseProject}-reply', (_e, { idx, path }) => {
      const row = projectsList.querySelector('[data-idx="' + idx + '"]');
      if (row) row.querySelector('.project-path').value = path;
    });

    let projectCounter = 0;

    function addProjectRow(name, path) {
      const idx = projectCounter++;
      const row = document.createElement('div');
      row.className = 'project-row';
      row.dataset.idx = idx;

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'project-name';
      nameInput.placeholder = 'Project name';
      nameInput.value = name || '';

      const pathInput = document.createElement('input');
      pathInput.type = 'text';
      pathInput.className = 'project-path';
      pathInput.placeholder = '~/path/to/project';
      pathInput.value = path || '';

      const browseBtn = document.createElement('button');
      browseBtn.className = 'browse';
      browseBtn.textContent = '…';
      browseBtn.style.padding = '7px 8px';
      browseBtn.addEventListener('click', () => {
        ipcRenderer.send('${channelBrowseProject}', idx);
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => row.remove());

      row.appendChild(nameInput);
      row.appendChild(pathInput);
      row.appendChild(browseBtn);
      row.appendChild(removeBtn);
      projectsList.appendChild(row);
    }

    for (const p of initProjects) addProjectRow(p.name, p.path);

    addProjectBtn.addEventListener('click', () => addProjectRow('', ''));

    function submit() {
      if (!nameEl.value.trim()) return;
      const projects = [];
      for (const row of projectsList.querySelectorAll('.project-row')) {
        const n = row.querySelector('.project-name').value.trim();
        const p = row.querySelector('.project-path').value;
        if (n || p) projects.push({ name: n, path: p });
      }
      ipcRenderer.send('${channelOk}', {
        name: nameEl.value.trim(),
        description: descriptionEl.value.trim(),
        systemPath: systemPathEl.value,
        projects,
        bypass: bypassEl.checked,
      });
    }

    okBtn.addEventListener('click', submit);
    document.getElementById('cancel-btn').addEventListener('click', () => {
      ipcRenderer.send('${channelCancel}');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && document.activeElement.tagName !== 'INPUT') submit();
      if (e.key === 'Escape') ipcRenderer.send('${channelCancel}');
    });
  </script>
</body>
</html>`

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    win.once('ready-to-show', () => win.show())
  })
}
