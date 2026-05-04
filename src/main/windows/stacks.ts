import { BrowserWindow, ipcMain, dialog } from 'electron'
import * as fs from 'fs'
import {
  drawerBaseCss, drawerHeaderCss, drawerHeaderHtml, drawerBaseScript,
  createDrawerWindow, loadDrawerHtml,
} from './drawer-base'
import { loadStacks, addStack, updateStack, deleteStack, importStacks } from '../services/stacks-store'
import { showStackDialog } from './stack-dialog'
import { showStackImportDialog } from './stack-import-dialog'
import { spawnClaudeSession } from '../services/session-spawner'

const stacksWindows = new Map<number, BrowserWindow>()
const STACKS_WIDTH = 320

export function toggleStacksWindow(parentWin: BrowserWindow, color: string): boolean {
  const channelList = `stacks-list-${parentWin.id}`
  const channelLaunch = `stacks-launch-${parentWin.id}`
  const channelEdit = `stacks-edit-${parentWin.id}`
  const channelDelete = `stacks-delete-${parentWin.id}`
  const channelCreate = `stacks-create-${parentWin.id}`
  const channelImport = `stacks-import-${parentWin.id}`
  const channelShare = `stacks-share-${parentWin.id}`

  const result = createDrawerWindow({
    parentWin,
    width: STACKS_WIDTH,
    color,
    closedChannel: 'terminal:stacks-closed',
    windowMap: stacksWindows,
    ipcChannels: [channelList, channelLaunch, channelEdit, channelDelete, channelCreate, channelImport, channelShare],
  })

  if (!result) return false
  const { win, bgColor, headerBg } = result

  ipcMain.on(channelList, (e) => {
    e.returnValue = loadStacks()
  })

  ipcMain.on(channelLaunch, (_e, stackId: string, projectPath?: string) => {
    const stacks = loadStacks()
    const stack = stacks.find(s => s.id === stackId)
    if (!stack) return

    if (projectPath) {
      // Launch in a specific project — no extra dirs needed
      const title = stack.projects.find(p => p.path === projectPath)?.name || stack.name
      spawnClaudeSession(false, title, projectPath)
    } else {
      // Launch the full stack: start in systemPath, add all project paths as context
      const addDirs = stack.projects.map(p => p.path).filter(Boolean)
      spawnClaudeSession(false, stack.name, stack.systemPath, undefined, undefined, undefined, undefined, undefined, undefined, undefined, addDirs)
    }
  })

  ipcMain.on(channelEdit, async (_e, stackId: string) => {
    const stacks = loadStacks()
    const stack = stacks.find(s => s.id === stackId)
    if (!stack) return
    const updated = await showStackDialog({ ...stack }, 'edit')
    if (updated) {
      updateStack(stackId, updated)
      win.webContents.send(`${channelList}-reply`, loadStacks())
    }
  })

  ipcMain.on(channelDelete, (_e, stackId: string) => {
    deleteStack(stackId)
    win.webContents.send(`${channelList}-reply`, loadStacks())
  })

  ipcMain.on(channelCreate, async () => {
    const created = await showStackDialog(undefined, 'new')
    if (created) {
      addStack(created)
      win.webContents.send(`${channelList}-reply`, loadStacks())
    }
  })

  ipcMain.on(channelImport, async () => {
    const openResult = await dialog.showOpenDialog(win, {
      title: 'Import Stacks from JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    })

    if (!openResult.canceled && openResult.filePaths[0]) {
      try {
        const content = fs.readFileSync(openResult.filePaths[0], 'utf-8')
        const data = JSON.parse(content)
        const raw = Array.isArray(data) ? data : [data]
        const verified = await showStackImportDialog(raw)
        if (verified) {
          importStacks(verified)
          win.webContents.send(`${channelList}-reply`, loadStacks())
        }
      } catch (e) {
        console.error('Failed to import stacks:', e)
      }
    }
  })

  ipcMain.on(channelShare, async (_e, stackId: string) => {
    const stacks = loadStacks()
    const stack = stacks.find(s => s.id === stackId)
    if (!stack) return

    const saveResult = await dialog.showSaveDialog(win, {
      title: 'Share Stack',
      defaultPath: `${stack.name}-stack.json`,
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    })

    if (!saveResult.canceled && saveResult.filePath) {
      const { id: _id, ...exportable } = stack
      fs.writeFileSync(saveResult.filePath, JSON.stringify([exportable], null, 2))
    }
  })

  const html = `<!DOCTYPE html>
<html>
<head><style>
  ${drawerBaseCss(bgColor)}
  ${drawerHeaderCss(headerBg)}
  #content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }
  .action-buttons {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
  }
  .action-btn {
    flex: 1;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    background: rgba(255,255,255,0.05);
    color: rgba(255,255,255,0.7);
    cursor: pointer;
    transition: all 0.1s;
  }
  .action-btn:hover {
    background: rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.9);
  }
  .stack-card {
    padding: 10px;
    margin-bottom: 8px;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    background: rgba(255,255,255,0.02);
    transition: all 0.1s;
  }
  .stack-card:hover {
    background: rgba(255,255,255,0.04);
    border-color: rgba(255,255,255,0.15);
  }
  .stack-name {
    font-weight: 600;
    font-size: 13px;
    color: rgba(255,255,255,0.9);
    margin-bottom: 2px;
  }
  .stack-description {
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    margin-bottom: 4px;
    line-height: 1.3;
  }
  .stack-path {
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    margin-bottom: 6px;
    word-break: break-word;
  }
  .projects-list {
    margin: 4px 0 6px 0;
  }
  .project-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    margin-bottom: 2px;
    border-radius: 4px;
    background: rgba(255,255,255,0.03);
    transition: background 0.1s;
  }
  .project-item:hover { background: rgba(255,255,255,0.06); }
  .project-item-name {
    flex: 1;
    font-size: 11px;
    color: rgba(255,255,255,0.7);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .project-launch-btn {
    padding: 2px 8px;
    font-size: 10px;
    border: none;
    border-radius: 3px;
    background: rgba(124,58,237,0.25);
    color: rgba(167,139,250,0.9);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: all 0.1s;
  }
  .project-launch-btn:hover {
    background: rgba(124,58,237,0.5);
    color: white;
  }
  .stack-actions {
    display: flex;
    gap: 4px;
  }
  .stack-action-btn {
    flex: 1;
    padding: 4px 8px;
    font-size: 10px;
    border: none;
    border-radius: 3px;
    background: rgba(255,255,255,0.06);
    color: rgba(255,255,255,0.6);
    cursor: pointer;
    transition: all 0.1s;
  }
  .stack-action-btn:hover {
    background: rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.8);
  }
  .stack-action-btn.delete:hover {
    background: rgba(255,80,80,0.15);
    color: rgba(255,150,150,0.8);
  }
  .empty {
    text-align: center;
    padding: 20px 12px;
    color: rgba(255,255,255,0.4);
    font-size: 12px;
  }
</style></head>
<body>
  ${drawerHeaderHtml('Stacks', '')}
  <div id="content">
    <div class="action-buttons">
      <button class="action-btn" id="new-stack-btn">New</button>
      <button class="action-btn" id="import-btn">Import</button>
    </div>
    <div id="stacks-list"></div>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const listEl = document.getElementById('stacks-list');
    const newBtn = document.getElementById('new-stack-btn');
    const importBtn = document.getElementById('import-btn');

    function txt(str) { return document.createTextNode(str || ''); }
    function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

    function renderStacks() {
      const stacks = ipcRenderer.sendSync('${channelList}');
      listEl.innerHTML = '';

      if (!stacks || stacks.length === 0) {
        const empty = el('div', 'empty');
        empty.textContent = 'No stacks yet';
        listEl.appendChild(empty);
        return;
      }

      for (const stack of stacks) {
        const card = el('div', 'stack-card');

        const name = el('div', 'stack-name');
        name.appendChild(txt(stack.name));
        card.appendChild(name);

        if (stack.description) {
          const desc = el('div', 'stack-description');
          desc.appendChild(txt(stack.description));
          card.appendChild(desc);
        }

        const pathEl = el('div', 'stack-path');
        pathEl.appendChild(txt(stack.systemPath));
        card.appendChild(pathEl);

        // Projects list
        const projects = stack.projects || [];
        if (projects.length > 0) {
          const projList = el('div', 'projects-list');
          for (const proj of projects) {
            const item = el('div', 'project-item');
            const nameEl = el('span', 'project-item-name');
            nameEl.title = proj.path;
            nameEl.appendChild(txt(proj.name));
            const launchBtn = el('button', 'project-launch-btn');
            launchBtn.textContent = 'Launch';
            launchBtn.addEventListener('click', () => {
              ipcRenderer.send('${channelLaunch}', stack.id, proj.path);
            });
            item.appendChild(nameEl);
            item.appendChild(launchBtn);
            projList.appendChild(item);
          }
          card.appendChild(projList);
        }

        const actions = el('div', 'stack-actions');
        for (const [label, cls] of [['Launch', 'launch'], ['Edit', 'edit'], ['Share', 'share'], ['Delete', 'delete']]) {
          const btn = el('button', 'stack-action-btn ' + cls);
          btn.dataset.id = stack.id;
          btn.textContent = label;
          btn.addEventListener('click', () => {
            if (cls === 'launch') ipcRenderer.send('${channelLaunch}', stack.id);
            else if (cls === 'edit') ipcRenderer.send('${channelEdit}', stack.id);
            else if (cls === 'share') ipcRenderer.send('${channelShare}', stack.id);
            else if (cls === 'delete') ipcRenderer.send('${channelDelete}', stack.id);
          });
          actions.appendChild(btn);
        }
        card.appendChild(actions);
        listEl.appendChild(card);
      }
    }

    newBtn.addEventListener('click', () => { ipcRenderer.send('${channelCreate}'); });
    importBtn.addEventListener('click', () => { ipcRenderer.send('${channelImport}'); });

    // Main process sends this after any mutation (create, edit, delete, import)
    ipcRenderer.on('${channelList}-reply', () => { renderStacks(); });

    renderStacks();
    ${drawerBaseScript()}
  </script>
</body>
</html>`

  loadDrawerHtml(win, html)
  return true
}

export function closeStacksForWindow(windowId: number): void {
  const stacks = stacksWindows.get(windowId)
  if (stacks && !stacks.isDestroyed()) {
    stacks.close()
  }
  stacksWindows.delete(windowId)
}

export function isStacksOpen(windowId: number): boolean {
  const stacks = stacksWindows.get(windowId)
  return !!stacks && !stacks.isDestroyed()
}
