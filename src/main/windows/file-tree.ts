import { BrowserWindow, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/** Map of terminal windowId → file-tree BrowserWindow */
const treeWindows = new Map<number, BrowserWindow>()

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  }
}

function tintedBackground(hex: string, tint = 0.08): string {
  const { r, g, b } = hexToRgb(hex)
  const tr = Math.round(r * tint).toString(16).padStart(2, '0')
  const tg = Math.round(g * tint).toString(16).padStart(2, '0')
  const tb = Math.round(b * tint).toString(16).padStart(2, '0')
  return `#${tr}${tg}${tb}`
}

const PANEL_WIDTH = 300

/** Hidden dirs/files to skip */
const IGNORED = new Set([
  'node_modules', '.git', '.DS_Store', '__pycache__', '.next', '.nuxt',
  'dist', 'out', '.cache', '.turbo', 'coverage', '.nyc_output',
  '.vscode', '.idea', 'build', '.svelte-kit',
])

interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

function readDir(dirPath: string): DirEntry[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const results: DirEntry[] = []
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue
      if (entry.name.startsWith('.') && entry.name !== '.env') continue
      results.push({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        isDir: entry.isDirectory(),
      })
    }
    // Sort: dirs first, then alphabetically
    results.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return results
  } catch {
    return []
  }
}

export function toggleFileTreeWindow(parentWin: BrowserWindow, color: string, cwd: string): boolean {
  const existing = treeWindows.get(parentWin.id)
  if (existing && !existing.isDestroyed()) {
    existing.close()
    treeWindows.delete(parentWin.id)
    return false
  }

  const parentBounds = parentWin.getBounds()
  const bgColor = tintedBackground(color, 0.06)
  const channelReadDir = `filetree-readdir-${parentWin.id}`
  const channelAddToPrompt = `filetree-addprompt-${parentWin.id}`

  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: parentBounds.height,
    x: parentBounds.x - PANEL_WIDTH,
    y: parentBounds.y,
    frame: false,
    transparent: false,
    backgroundColor: bgColor,
    hasShadow: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  treeWindows.set(parentWin.id, win)

  // IPC: read directory contents on demand
  ipcMain.handle(channelReadDir, (_e, dirPath: string) => {
    // Security: only allow reading within cwd
    const resolved = path.resolve(dirPath)
    if (!resolved.startsWith(cwd)) return []
    return readDir(resolved)
  })

  // IPC: add file/folder path to prompt
  ipcMain.on(channelAddToPrompt, (_e, filePath: string) => {
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send('terminal:type-command', filePath + ' ')
    }
  })

  const updatePosition = () => {
    if (win.isDestroyed()) return
    const b = parentWin.getBounds()
    win.setBounds({
      x: b.x - PANEL_WIDTH,
      y: b.y,
      width: PANEL_WIDTH,
      height: b.height,
    })
  }

  parentWin.on('move', updatePosition)
  parentWin.on('resize', updatePosition)
  parentWin.on('minimize', () => { if (!win.isDestroyed()) win.hide() })
  parentWin.on('restore', () => { if (!win.isDestroyed()) win.show() })

  const cleanup = () => {
    ipcMain.removeHandler(channelReadDir)
    ipcMain.removeAllListeners(channelAddToPrompt)
    parentWin.removeListener('move', updatePosition)
    parentWin.removeListener('resize', updatePosition)
    treeWindows.delete(parentWin.id)
  }

  win.on('closed', () => {
    cleanup()
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send('terminal:filetree-closed')
    }
  })

  parentWin.on('closed', () => {
    if (!win.isDestroyed()) win.close()
    cleanup()
  })

  const accentColor = color
  const rootName = path.basename(cwd)

  const html = `<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    background: ${bgColor};
    overflow: hidden;
  }
  body {
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  }
  #header {
    -webkit-app-region: drag;
    height: 38px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    font-size: 11px;
    font-weight: 600;
    color: rgba(255,255,255,0.55);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: ${tintedBackground(color, 0.1)};
  }
  #tree {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
    -webkit-app-region: no-drag;
  }
  #tree::-webkit-scrollbar { width: 5px; }
  #tree::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
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
  .children { display: none; }
  .children.open { display: block; }
  .ctx-menu {
    position: fixed;
    background: rgba(30,30,50,0.96);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 160px;
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
  .ctx-sep { height: 1px; background: rgba(255,255,255,0.08); margin: 3px 0; }
</style></head>
<body>
  <div id="header">File Tree</div>
  <div id="tree"></div>
  <script>
    const { ipcRenderer } = require('electron');
    const tree = document.getElementById('tree');
    const rootPath = ${JSON.stringify(cwd)};
    const rootName = ${JSON.stringify(rootName)};

    // Icon helpers
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

    async function loadChildren(dirPath, container, depth) {
      const entries = await ipcRenderer.invoke('${channelReadDir}', dirPath);
      container.innerHTML = '';
      for (const entry of entries) {
        const row = document.createElement('div');
        row.className = 'node ' + (entry.isDir ? 'dir' : 'file');
        row.style.paddingLeft = (depth * 14 + 6) + 'px';
        row.dataset.path = entry.path;
        row.dataset.isDir = entry.isDir ? '1' : '0';

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

        const childContainer = document.createElement('div');
        childContainer.className = 'children';

        let loaded = false;
        if (entry.isDir) {
          row.addEventListener('click', async (e) => {
            e.stopPropagation();
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
          });
        }

        // Right-click context menu
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showContextMenu(e.clientX, e.clientY, entry.path, entry.isDir);
        });

        container.appendChild(row);
        if (entry.isDir) container.appendChild(childContainer);
      }
    }

    // Context menu
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

      // Keep in viewport
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
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (activeMenu) hideContextMenu();
        else window.close();
      }
    });

    // Load root
    loadChildren(rootPath, tree, 0);
  </script>
</body>
</html>`

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  win.once('ready-to-show', () => win.show())

  return true
}
