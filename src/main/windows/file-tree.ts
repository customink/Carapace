import { BrowserWindow, ipcMain, shell, nativeImage } from 'electron'
import { exec } from 'child_process'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  drawerBaseCss, drawerHeaderCss, drawerHeaderHtml, drawerBaseScript,
  drawerSearchCss, drawerSearchHtml, drawerSearchScript,
  createDrawerWindow, loadDrawerHtml,
} from './drawer-base'

const treeWindows = new Map<number, BrowserWindow>()

const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'usage-data', 'carapace-filetree-settings.json')

function loadShowHidden(): boolean {
  try {
    const data = JSON.parse(fsSync.readFileSync(SETTINGS_FILE, 'utf-8'))
    return !!data.showHidden
  } catch { return false }
}

function saveShowHidden(value: boolean): void {
  try {
    fsSync.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
    fsSync.writeFileSync(SETTINGS_FILE, JSON.stringify({ showHidden: value }))
  } catch { /* ignore */ }
}

const PANEL_WIDTH = 300

const IGNORED = new Set([
  'node_modules', '.git', '.DS_Store', '__pycache__', '.next', '.nuxt',
  'dist', 'out', '.cache', '.turbo', 'coverage', '.nyc_output',
  '.vscode', '.idea', 'build', '.svelte-kit',
])

interface DirEntry {
  name: string
  path: string
  isDir: boolean
  mtime: number   // last modified timestamp ms
  birthtime: number // created timestamp ms
}

function shouldSkip(name: string, showHidden: boolean): boolean {
  if (IGNORED.has(name)) return true
  if (!showHidden && name.startsWith('.') && name !== '.env') return true
  return false
}

type SortMode = 'name' | 'modified' | 'created' | 'default'

function sortEntries(entries: DirEntry[], mode: SortMode): DirEntry[] {
  return entries.sort((a, b) => {
    // Directories always first
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    switch (mode) {
      case 'modified':  return b.mtime - a.mtime
      case 'created':   return b.birthtime - a.birthtime
      case 'default':   return 0 // filesystem order (no sort within dirs/files)
      case 'name':
      default:          return a.name.localeCompare(b.name)
    }
  })
}

async function readDir(dirPath: string, showHidden = false, sort: SortMode = 'name'): Promise<DirEntry[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const results: DirEntry[] = []
    for (const entry of entries) {
      if (shouldSkip(entry.name, showHidden)) continue
      const fullPath = path.join(dirPath, entry.name)
      let mtime = 0, birthtime = 0
      try {
        const stat = await fs.stat(fullPath)
        mtime = stat.mtimeMs
        birthtime = stat.birthtimeMs
      } catch { /* skip stat errors */ }
      results.push({
        name: entry.name,
        path: fullPath,
        isDir: entry.isDirectory(),
        mtime,
        birthtime,
      })
    }
    return sortEntries(results, sort)
  } catch {
    return []
  }
}

/** Recursively search for files/folders matching a query under dirPath (async, depth-limited) */
async function searchDir(dirPath: string, query: string, showHidden = false, sort: SortMode = 'name', maxResults = 80, maxDepth = 8): Promise<DirEntry[]> {
  const results: DirEntry[] = []
  const q = query.toLowerCase()

  async function walk(dir: string, depth: number) {
    if (results.length >= maxResults || depth > maxDepth) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const subdirs: string[] = []
    for (const entry of entries) {
      if (results.length >= maxResults) return
      if (shouldSkip(entry.name, showHidden)) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.name.toLowerCase().includes(q)) {
        let mtime = 0, birthtime = 0
        try {
          const stat = await fs.stat(fullPath)
          mtime = stat.mtimeMs
          birthtime = stat.birthtimeMs
        } catch { /* skip */ }
        results.push({ name: entry.name, path: fullPath, isDir: entry.isDirectory(), mtime, birthtime })
      }
      if (entry.isDirectory()) {
        subdirs.push(fullPath)
      }
    }
    for (const sub of subdirs) {
      if (results.length >= maxResults) return
      await walk(sub, depth + 1)
    }
  }

  await walk(dirPath, 0)
  return sortEntries(results, sort)
}

export function toggleFileTreeWindow(parentWin: BrowserWindow, color: string, cwd: string): boolean {
  const channelReadDir = `filetree-readdir-${parentWin.id}`
  const channelSearch = `filetree-search-${parentWin.id}`
  const channelAddToPrompt = `filetree-addprompt-${parentWin.id}`
  const channelOpenVSCode = `filetree-openvscode-${parentWin.id}`
  const channelOpenFinder = `filetree-openfinder-${parentWin.id}`
  const channelStartDrag = `filetree-startdrag-${parentWin.id}`
  const channelSaveHidden = `filetree-savehidden-${parentWin.id}`

  const result = createDrawerWindow({
    parentWin,
    width: PANEL_WIDTH,
    color,
    closedChannel: 'terminal:filetree-closed',
    windowMap: treeWindows,
    ipcChannels: [channelAddToPrompt, channelOpenVSCode, channelOpenFinder, channelStartDrag, channelSaveHidden, `filetree-clickinsert-${parentWin.id}`],
    ipcHandlers: [channelReadDir, channelSearch],
  })

  if (!result) return false
  const { win, bgColor, headerBg } = result

  ipcMain.handle(channelReadDir, async (_e, dirPath: string, showHidden: boolean, sort: SortMode) => {
    const resolved = path.resolve(dirPath)
    if (!resolved.startsWith(cwd)) return []
    return await readDir(resolved, !!showHidden, sort || 'name')
  })

  ipcMain.handle(channelSearch, async (_e, query: string, showHidden: boolean, sort: SortMode) => {
    if (!query || query.length < 2) return []
    return await searchDir(cwd, query, !!showHidden, sort || 'name')
  })

  ipcMain.on(channelAddToPrompt, (_e, filePath: string) => {
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send('terminal:type-command', filePath + ' ')
    }
  })

  ipcMain.on(channelOpenVSCode, (_e, filePath: string) => {
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(cwd)) return
    exec(`code ${JSON.stringify(resolved)}`, { timeout: 5000 })
  })

  ipcMain.on(channelOpenFinder, (_e, filePath: string, isDir: boolean) => {
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(cwd)) return
    if (isDir) {
      shell.openPath(resolved)
    } else {
      shell.showItemInFolder(resolved)
    }
  })

  // Native file drag for cross-window drag-to-terminal
  // Create a visible 32x32 file drag icon
  const dragIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAJZJREFUWEft17ENgDAMBdDbWIQpmIkpmIJFaJiCmdiABkUosnzOT0AU/PLi2E4Msfilxe9XBXYBJ+AB7H8dsFnAA7gCqXflm7sOaAN2wBV4AU/gkH+QH+QmPORXpAHkW+CPbH5JxlvwkH8EsQJH4JxfohbsAnbAEUhfxAiuNqAALoAt2AZOA0fBq4BVwAbMgP/9C96opiAhjPnDAAAAAElFTkSuQmCC')

  ipcMain.on(channelStartDrag, (event, filePath: string) => {
    const resolved = path.resolve(filePath)
    console.log('[file-tree] startDrag:', resolved, 'cwd:', cwd, 'check:', resolved.startsWith(cwd))
    if (!resolved.startsWith(cwd)) return
    try {
      event.sender.startDrag({ file: resolved, icon: dragIcon })
      console.log('[file-tree] startDrag succeeded')
    } catch (err) {
      console.log('[file-tree] startDrag failed:', err)
    }
  })

  // Also support adding to prompt by typing the path directly into the terminal.
  // This is the fallback if native drag doesn't work across windows.
  ipcMain.on(`filetree-clickinsert-${parentWin.id}`, (_e, filePath: string) => {
    if (!parentWin.isDestroyed()) {
      const escaped = filePath.includes(' ') ? `"${filePath}"` : filePath
      parentWin.webContents.send('terminal:type-command', escaped + ' ')
    }
  })

  ipcMain.on(channelSaveHidden, (_e, value: boolean) => {
    saveShowHidden(!!value)
  })

  const initShowHidden = loadShowHidden()
  const accentColor = color
  const rootName = path.basename(cwd)

  const html = `<!DOCTYPE html>
<html>
<head><style>
  ${drawerBaseCss(bgColor)}
  ${drawerHeaderCss(headerBg)}
  ${drawerSearchCss(accentColor)}
  #tree {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
    margin-top: 6px;
    -webkit-app-region: no-drag;
  }
  #search-results {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
    margin-top: 6px;
    -webkit-app-region: no-drag;
    display: none;
  }
  .node {
    display: flex;
    align-items: center;
    padding: 3px 10px 3px 0;
    cursor: pointer;
    font-size: 12px;
    color: rgba(255,255,255,0.8);
    transition: background 0.1s;
    user-select: none;
    white-space: nowrap;
  }
  .node:hover { background: rgba(255,255,255,0.06); }
  .node .arrow {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    color: rgba(255,255,255,0.3);
    transition: transform 0.15s;
  }
  .node .arrow.open { transform: rotate(90deg); }
  .node .arrow.hidden { visibility: hidden; }
  .node .icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    margin-right: 5px;
  }
  .node .name { overflow: hidden; text-overflow: ellipsis; }
  .node.dir .name { font-weight: 500; }
  .node.file .name { color: rgba(255,255,255,0.65); }
  .node.file:active { background: rgba(255,255,255,0.1); }
  .node.dragging-item { opacity: 0.5; background: rgba(255,255,255,0.08); }
  .node .rel-path {
    font-size: 10px;
    color: rgba(255,255,255,0.25);
    margin-left: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .node .insert-btn {
    margin-left: auto;
    padding: 0 4px;
    font-size: 11px;
    color: rgba(255,255,255,0.15);
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .node:hover .insert-btn { opacity: 1; }
  .node .insert-btn:hover { color: rgba(255,255,255,0.7); }
  .children { display: none; }
  .children.open { display: block; }
  .empty {
    padding: 20px 14px;
    font-size: 12px;
    color: rgba(255,255,255,0.2);
    text-align: center;
  }
  .hidden-toggle {
    display: flex;
    align-items: center;
    padding: 4px 12px;
    -webkit-app-region: no-drag;
    cursor: pointer;
    user-select: none;
  }
  .hidden-toggle input[type="checkbox"] {
    appearance: none;
    width: 13px;
    height: 13px;
    border: 1.5px solid rgba(255,255,255,0.3);
    border-radius: 3px;
    background: transparent;
    cursor: pointer;
    margin: 0 6px 0 0;
    flex-shrink: 0;
    position: relative;
  }
  .hidden-toggle input[type="checkbox"]:checked {
    background: ${accentColor};
    border-color: ${accentColor};
  }
  .hidden-toggle input[type="checkbox"]:checked::after {
    content: '';
    position: absolute;
    left: 3px;
    top: 0.5px;
    width: 4px;
    height: 7px;
    border: solid #fff;
    border-width: 0 1.5px 1.5px 0;
    transform: rotate(45deg);
  }
  .hidden-toggle label {
    font-size: 11px;
    color: rgba(255,255,255,0.45);
    cursor: pointer;
  }
  .ctx-menu {
    position: fixed;
    background: rgba(30,30,50,0.96);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 180px;
    z-index: 1000;
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }
  .ctx-menu .ctx-item {
    padding: 6px 14px;
    font-size: 12px;
    color: rgba(255,255,255,0.85);
    cursor: pointer;
    transition: background 0.1s;
  }
  .ctx-menu .ctx-item:hover { background: ${accentColor}40; }
  .ctx-item-check {
    display: inline-block;
    width: 16px;
    font-size: 12px;
    color: ${accentColor};
  }
  .ctx-sep { height: 1px; background: rgba(255,255,255,0.08); margin: 3px 0; }
</style></head>
<body>
  ${drawerHeaderHtml('File Tree', `<button class="drawer-close-btn" id="sort-btn" title="Sort: Name" style="font-size:11px;margin-right:2px;width:auto;padding:0 6px;opacity:0.6;">A↓</button>`)}
  ${drawerSearchHtml('Search files...')}
  <div class="hidden-toggle">
    <input type="checkbox" id="hidden-cb"><label for="hidden-cb">Show hidden files</label>
  </div>
  <div id="tree"></div>
  <div id="search-results"></div>
  <script>
    const { ipcRenderer } = require('electron');
    const tree = document.getElementById('tree');
    const searchResults = document.getElementById('search-results');
    const searchInput = document.getElementById('search');
    const rootPath = ${JSON.stringify(cwd)};
    const rootName = ${JSON.stringify(rootName)};
    let showHidden = ${initShowHidden};
    const hiddenCb = document.getElementById('hidden-cb');
    hiddenCb.checked = showHidden;
    hiddenCb.addEventListener('change', () => {
      showHidden = hiddenCb.checked;
      ipcRenderer.send('${channelSaveHidden}', showHidden);
      reloadTree();
    });
    const sortModes = ['name', 'modified', 'created', 'default'];
    const sortLabels = { name: 'A\\u2193', modified: 'M\\u2193', created: 'C\\u2193', default: '\\u2014' };
    const sortTitles = { name: 'Sort: Name', modified: 'Sort: Date Modified', created: 'Sort: Date Created', default: 'Sort: Default' };
    let sortIdx = 0;
    let currentSort = 'name';
    const sortBtn = document.getElementById('sort-btn');
    sortBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sortIdx = (sortIdx + 1) % sortModes.length;
      currentSort = sortModes[sortIdx];
      sortBtn.textContent = sortLabels[currentSort];
      sortBtn.title = sortTitles[currentSort];
      sortBtn.style.opacity = currentSort === 'name' ? '0.6' : '1';
      reloadTree();
    });

    function dirIcon() { return '\\uD83D\\uDCC1'; }
    function fileIcon(name) {
      const ext = name.split('.').pop().toLowerCase();
      const icons = {
        ts: '\\uD83D\\uDCDC', tsx: '\\u269B', js: '\\uD83D\\uDFE8', jsx: '\\u269B',
        json: '{}', md: '\\uD83D\\uDCDD', css: '\\uD83C\\uDFA8', html: '\\uD83C\\uDF10',
        py: '\\uD83D\\uDC0D', rs: '\\u2699', go: '\\uD83D\\uDC39', rb: '\\uD83D\\uDC8E',
        sh: '\\uD83D\\uDCBB', yml: '\\u2699', yaml: '\\u2699', toml: '\\u2699',
        svg: '\\uD83D\\uDDBC', png: '\\uD83D\\uDDBC', jpg: '\\uD83D\\uDDBC',
        lock: '\\uD83D\\uDD12', env: '\\uD83D\\uDD11',
      };
      return icons[ext] || '\\uD83D\\uDCC4';
    }

    function relPath(fullPath) {
      return fullPath.startsWith(rootPath) ? fullPath.slice(rootPath.length + 1) : fullPath;
    }

    // ─── Tree view (default) ───
    async function loadChildren(dirPath, container, depth) {
      const entries = await ipcRenderer.invoke('${channelReadDir}', dirPath, showHidden, currentSort);
      container.innerHTML = '';
      for (const entry of entries) {
        const row = document.createElement('div');
        row.className = 'node ' + (entry.isDir ? 'dir' : 'file');
        row.style.paddingLeft = (depth * 14 + 6) + 'px';
        row.dataset.path = entry.path;
        row.dataset.isDir = entry.isDir ? '1' : '0';
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          // Set HTML5 drag data with the file path
          e.dataTransfer.setData('text/plain', entry.path);
          e.dataTransfer.effectAllowed = 'copy';
          // Also trigger native drag for external apps
          ipcRenderer.send('${channelStartDrag}', entry.path);
        });

        const arrow = document.createElement('span');
        arrow.className = 'arrow' + (entry.isDir ? '' : ' hidden');
        arrow.textContent = '\\u25B6';
        row.appendChild(arrow);

        const icon = document.createElement('span');
        icon.className = 'icon';
        icon.textContent = entry.isDir ? dirIcon() : fileIcon(entry.name);
        row.appendChild(icon);

        const nameEl = document.createElement('span');
        nameEl.className = 'name';
        nameEl.textContent = entry.name;
        row.appendChild(nameEl);

        // Insert button — sends path to terminal on click (works for files AND folders)
        const insertBtn = document.createElement('span');
        insertBtn.className = 'insert-btn';
        insertBtn.textContent = '\\u2192'; // → arrow
        insertBtn.title = 'Insert path into prompt';
        insertBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          ipcRenderer.send('filetree-clickinsert-${parentWin.id}', entry.path);
        });
        row.appendChild(insertBtn);

        const childContainer = document.createElement('div');
        childContainer.className = 'children';

        let loaded = false;

        if (!entry.isDir) {
          // Click a file to insert its path into the terminal prompt
          row.addEventListener('click', (e) => {
            e.stopPropagation();
            ipcRenderer.send('filetree-clickinsert-${parentWin.id}', entry.path);
          });
        }


        if (entry.isDir) {
          const toggleFolder = async () => {
            const isOpen = childContainer.classList.contains('open');
            if (isOpen) {
              childContainer.classList.remove('open');
              arrow.classList.remove('open');
            } else {
              if (!loaded) {
                await loadChildren(entry.path, childContainer, depth + 1);
                loaded = true;
              }
              childContainer.classList.add('open');
              arrow.classList.add('open');
            }
          };
          // Click on folder row toggles open/close
          row.addEventListener('click', (e) => { e.stopPropagation(); toggleFolder(); });
        }

        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showContextMenu(e.clientX, e.clientY, entry.path, entry.isDir);
        });

        container.appendChild(row);
        if (entry.isDir) container.appendChild(childContainer);
      }
    }

    // ─── Search ───
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (q.length < 2) {
        tree.style.display = '';
        searchResults.style.display = 'none';
        searchResults.innerHTML = '';
        return;
      }
      searchTimer = setTimeout(async () => {
        const results = await ipcRenderer.invoke('${channelSearch}', q, showHidden, currentSort);
        tree.style.display = 'none';
        searchResults.style.display = '';
        searchResults.innerHTML = '';
        if (results.length === 0) {
          searchResults.innerHTML = '<div class="empty">No matches</div>';
          return;
        }
        for (const entry of results) {
          const row = document.createElement('div');
          row.className = 'node ' + (entry.isDir ? 'dir' : 'file');
          row.style.paddingLeft = '10px';

          const icon = document.createElement('span');
          icon.className = 'icon';
          icon.textContent = entry.isDir ? dirIcon() : fileIcon(entry.name);
          row.appendChild(icon);

          const nameEl = document.createElement('span');
          nameEl.className = 'name';
          nameEl.textContent = entry.name;
          row.appendChild(nameEl);

          const rel = document.createElement('span');
          rel.className = 'rel-path';
          rel.textContent = relPath(entry.path);
          row.appendChild(rel);

          row.draggable = true;
          row.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', entry.path);
            e.dataTransfer.effectAllowed = 'copy';
            ipcRenderer.send('${channelStartDrag}', entry.path);
          });

          row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e.clientX, e.clientY, entry.path, entry.isDir);
          });

          row.addEventListener('click', () => {
            ipcRenderer.send('filetree-clickinsert-${parentWin.id}', entry.path);
          });

          searchResults.appendChild(row);
        }
      }, 200);
    });

    // ─── Context menu ───
    let activeMenu = null;
    function showContextMenu(x, y, filePath, isDir) {
      hideContextMenu();
      const menu = document.createElement('div');
      menu.className = 'ctx-menu';
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';

      const addItem = document.createElement('div');
      addItem.className = 'ctx-item';
      addItem.textContent = 'Add to prompt';
      addItem.addEventListener('click', () => {
        ipcRenderer.send('${channelAddToPrompt}', filePath);
        hideContextMenu();
      });
      menu.appendChild(addItem);

      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.appendChild(sep);

      const vscodeItem = document.createElement('div');
      vscodeItem.className = 'ctx-item';
      vscodeItem.textContent = 'Open with VS Code';
      vscodeItem.addEventListener('click', () => {
        ipcRenderer.send('${channelOpenVSCode}', filePath);
        hideContextMenu();
      });
      menu.appendChild(vscodeItem);

      const finderItem = document.createElement('div');
      finderItem.className = 'ctx-item';
      finderItem.textContent = 'Reveal in Finder';
      finderItem.addEventListener('click', () => {
        ipcRenderer.send('${channelOpenFinder}', filePath, isDir);
        hideContextMenu();
      });
      menu.appendChild(finderItem);

      document.body.appendChild(menu);
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
      if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';

      activeMenu = menu;
    }

    function hideContextMenu() {
      if (activeMenu) {
        activeMenu.remove();
        activeMenu = null;
      }
    }

    document.addEventListener('click', hideContextMenu);

    function reloadTree() {
      tree.innerHTML = '';
      loadChildren(rootPath, tree, 0);
      // If search is active, re-run it
      const q = searchInput.value.trim();
      if (q.length >= 2) {
        searchInput.dispatchEvent(new Event('input'));
      }
    }

    loadChildren(rootPath, tree, 0);

    // ─── Header right-click context menu ───
    document.querySelector('.drawer-header').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideContextMenu();
      const menu = document.createElement('div');
      menu.className = 'ctx-menu';
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';

      const toggleItem = document.createElement('div');
      toggleItem.className = 'ctx-item';
      const check = showHidden ? '\\u2713' : '';
      toggleItem.innerHTML = '<span class="ctx-item-check">' + check + '</span>Show Hidden Files';
      toggleItem.addEventListener('click', () => {
        showHidden = !showHidden;
        hiddenCb.checked = showHidden;
        ipcRenderer.send('${channelSaveHidden}', showHidden);
        hideContextMenu();
        reloadTree();
      });
      menu.appendChild(toggleItem);

      document.body.appendChild(menu);
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
      if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
      activeMenu = menu;
    });

    ${drawerSearchScript()}
    ${drawerBaseScript()}
  </script>
</body>
</html>`

  loadDrawerHtml(win, html)
  return true
}
