import { BrowserWindow, ipcMain, Menu, shell, clipboard, nativeImage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  drawerBaseCss, drawerHeaderCss, drawerHeaderHtml, drawerBaseScript,
  createDrawerWindow, loadDrawerHtml,
} from './drawer-base'

const IMAGES_DIR = path.join(os.homedir(), '.claude', 'usage-data', 'carapace-images')

const galleryWindows = new Map<number, BrowserWindow>()

const GALLERY_WIDTH = 320

interface ImageEntry {
  id: string
  filename: string
  addedAt: string
}

function orderPath(): string {
  return path.join(IMAGES_DIR, 'order.json')
}

function ensureDir(): void {
  fs.mkdirSync(IMAGES_DIR, { recursive: true })
}

function loadOrder(): ImageEntry[] {
  try {
    return JSON.parse(fs.readFileSync(orderPath(), 'utf-8'))
  } catch {
    return []
  }
}

function saveOrder(entries: ImageEntry[]): void {
  ensureDir()
  fs.writeFileSync(orderPath(), JSON.stringify(entries, null, 2), 'utf-8')
}

export function toggleImageGalleryWindow(parentWin: BrowserWindow, _ptyId: string, color: string): boolean {
  const channelList = `imagegallery-list-${parentWin.id}`
  const channelAdd = `imagegallery-add-${parentWin.id}`
  const channelAddBuffer = `imagegallery-add-buffer-${parentWin.id}`
  const channelDelete = `imagegallery-delete-${parentWin.id}`
  const channelReorder = `imagegallery-reorder-${parentWin.id}`
  const channelSend = `imagegallery-send-${parentWin.id}`
  const channelContextMenu = `imagegallery-contextmenu-${parentWin.id}`
  const channelStartDrag = `imagegallery-startdrag-${parentWin.id}`

  const result = createDrawerWindow({
    parentWin,
    width: GALLERY_WIDTH,
    color,
    closedChannel: 'terminal:imagegallery-closed',
    windowMap: galleryWindows,
    ipcHandlers: [channelList, channelAddBuffer],
    ipcChannels: [channelAdd, channelDelete, channelReorder, channelSend, channelContextMenu, channelStartDrag],
  })

  if (!result) return false
  const { win, bgColor, headerBg } = result

  const accentColor = color

  // IPC: list images
  ipcMain.handle(channelList, () => {
    const entries = loadOrder()
    return entries.map(e => ({
      id: e.id,
      filename: e.filename,
      path: path.join(IMAGES_DIR, e.filename),
      addedAt: e.addedAt,
    }))
  })

  // IPC: add image from file path (drag-drop)
  ipcMain.on(channelAdd, (_e, filePath: string) => {
    try {
      ensureDir()
      const ext = path.extname(filePath) || '.png'
      const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const filename = `${id}${ext}`
      fs.copyFileSync(filePath, path.join(IMAGES_DIR, filename))
      const entries = loadOrder()
      entries.push({ id, filename, addedAt: new Date().toISOString() })
      saveOrder(entries)
      // Notify the gallery window to refresh
      if (!win.isDestroyed()) {
        win.webContents.send('imagegallery-refresh')
      }
    } catch { /* ignore errors */ }
  })

  // IPC: add image from buffer (clipboard paste)
  ipcMain.handle(channelAddBuffer, (_e, buffer: Buffer) => {
    try {
      ensureDir()
      const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const filename = `${id}.png`
      fs.writeFileSync(path.join(IMAGES_DIR, filename), buffer)
      const entries = loadOrder()
      entries.push({ id, filename, addedAt: new Date().toISOString() })
      saveOrder(entries)
      return { id, filename, path: path.join(IMAGES_DIR, filename) }
    } catch {
      return null
    }
  })

  // IPC: delete image
  ipcMain.on(channelDelete, (_e, imageId: string) => {
    const entries = loadOrder()
    const entry = entries.find(e => e.id === imageId)
    if (entry) {
      try { fs.unlinkSync(path.join(IMAGES_DIR, entry.filename)) } catch { /* ok */ }
    }
    saveOrder(entries.filter(e => e.id !== imageId))
  })

  // IPC: reorder images
  ipcMain.on(channelReorder, (_e, orderedIds: string[]) => {
    const entries = loadOrder()
    const byId = new Map(entries.map(e => [e.id, e]))
    const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean) as ImageEntry[]
    // Append any entries not in the reorder list
    for (const e of entries) {
      if (!orderedIds.includes(e.id)) reordered.push(e)
    }
    saveOrder(reordered)
  })

  // IPC: send image path to terminal
  ipcMain.on(channelSend, (_e, imagePath: string) => {
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send('terminal:type-command', imagePath + ' ')
    }
  })

  // IPC: context menu for an image
  ipcMain.on(channelContextMenu, (_e, imageId: string, imagePath: string) => {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Copy to Clipboard',
        click: () => {
          try {
            const img = nativeImage.createFromPath(imagePath)
            if (!img.isEmpty()) {
              clipboard.writeImage(img)
            }
          } catch { /* ignore */ }
        },
      },
      {
        label: 'Reveal in Finder',
        click: () => {
          shell.showItemInFolder(imagePath)
        },
      },
      { type: 'separator' },
      {
        label: 'Remove',
        click: () => {
          const entries = loadOrder()
          const entry = entries.find(e => e.id === imageId)
          if (entry) {
            try { fs.unlinkSync(path.join(IMAGES_DIR, entry.filename)) } catch { /* ok */ }
          }
          saveOrder(entries.filter(e => e.id !== imageId))
          if (!win.isDestroyed()) {
            win.webContents.send('imagegallery-refresh')
          }
        },
      },
    ])
    menu.popup({ window: win })
  })

  // Native drag for cross-window drag-to-terminal
  ipcMain.on(channelStartDrag, (event, filePath: string) => {
    if (!fs.existsSync(filePath)) return
    let icon: Electron.NativeImage
    try {
      icon = nativeImage.createFromPath(filePath).resize({ width: 32, height: 32 })
      if (icon.isEmpty()) throw new Error('empty')
    } catch {
      icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAC0lEQVQ4jWNgGAUAAAGAAAGWLqzRAAAAAElFTkSuQmCC')
    }
    event.sender.startDrag({ file: filePath, icon })
  })

  const html = `<!DOCTYPE html>
<html>
<head><style>
  ${drawerBaseCss(bgColor)}
  ${drawerHeaderCss(headerBg)}
  #gallery {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    align-content: start;
  }
  .img-card {
    position: relative;
    border-radius: 6px;
    overflow: hidden;
    background: rgba(255,255,255,0.04);
    cursor: pointer;
    transition: all 0.15s;
    aspect-ratio: 1;
  }
  .img-card:hover {
    background: rgba(255,255,255,0.08);
    box-shadow: 0 0 0 1px ${accentColor}40;
  }
  .img-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    pointer-events: none;
  }
  .img-card .delete-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 20px; height: 20px;
    border: none; border-radius: 4px;
    background: rgba(0,0,0,0.6);
    color: rgba(255,255,255,0.7);
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 12px; line-height: 1;
    padding: 0;
    transition: all 0.1s;
  }
  .img-card:hover .delete-btn { display: flex; }
  .img-card .delete-btn:hover {
    background: rgba(255,60,60,0.8);
    color: white;
  }
  .img-card.dragging {
    opacity: 0.4;
  }
  .img-card.drag-over {
    box-shadow: 0 0 0 2px ${accentColor};
  }
  #drop-zone {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  #drop-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 100;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  #drop-overlay.visible {
    display: flex;
  }
  #drop-overlay-inner {
    border: 2px dashed ${accentColor};
    border-radius: 12px;
    padding: 32px;
    color: ${accentColor};
    font-size: 14px;
    font-weight: 600;
  }
  .empty-state {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    gap: 10px;
    color: rgba(255,255,255,0.2);
    font-size: 12px;
    text-align: center;
    line-height: 1.5;
  }
  .empty-icon {
    font-size: 28px;
    opacity: 0.4;
  }
</style></head>
<body>
  ${drawerHeaderHtml('Images')}
  <div id="drop-zone">
    <div id="gallery"></div>
  </div>
  <div id="drop-overlay">
    <div id="drop-overlay-inner">Drop images here</div>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const gallery = document.getElementById('gallery');
    const dropZone = document.getElementById('drop-zone');
    const dropOverlay = document.getElementById('drop-overlay');

    let images = [];

    async function refresh() {
      images = await ipcRenderer.invoke('${channelList}');
      render();
    }

    function render() {
      gallery.innerHTML = '';
      if (images.length === 0) {
        gallery.innerHTML = '<div class="empty-state">' +
          '<div class="empty-icon">&#128444;</div>' +
          '<div>Drop or paste images here</div>' +
          '<div style="font-size:11px;opacity:0.6">Click a thumbnail to send its path to the terminal</div>' +
          '</div>';
        return;
      }
      for (const img of images) {
        const card = document.createElement('div');
        card.className = 'img-card';
        card.dataset.id = img.id;
        card.draggable = true;

        const imgEl = document.createElement('img');
        imgEl.src = 'file://' + img.path;
        imgEl.loading = 'lazy';

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.innerHTML = '&times;';
        delBtn.title = 'Remove';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          ipcRenderer.send('${channelDelete}', img.id);
          images = images.filter(i => i.id !== img.id);
          render();
        });

        card.addEventListener('click', () => {
          ipcRenderer.send('${channelSend}', img.path);
        });

        card.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          ipcRenderer.send('${channelContextMenu}', img.id, img.path);
        });

        // Native drag (supports cross-window drag to terminal + internal reorder)
        card.addEventListener('dragstart', (e) => {
          e.preventDefault();
          ipcRenderer.send('${channelStartDrag}', img.path);
        });
        card.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          card.classList.add('drag-over');
        });
        card.addEventListener('dragleave', () => {
          card.classList.remove('drag-over');
        });
        card.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          card.classList.remove('drag-over');
          // Look up dragged image by file path from native drag
          let draggedId = '';
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const droppedPath = e.dataTransfer.files[0].path;
            const match = images.find(i => i.path === droppedPath);
            if (match) draggedId = match.id;
          }
          if (draggedId && draggedId !== img.id) {
            const fromIdx = images.findIndex(i => i.id === draggedId);
            const toIdx = images.findIndex(i => i.id === img.id);
            if (fromIdx >= 0 && toIdx >= 0) {
              const [moved] = images.splice(fromIdx, 1);
              images.splice(toIdx, 0, moved);
              ipcRenderer.send('${channelReorder}', images.map(i => i.id));
              render();
            }
          }
        });

        card.appendChild(imgEl);
        card.appendChild(delBtn);
        gallery.appendChild(card);
      }
    }

    // ── External drag-drop (files from Finder / Dock) ──
    const imageExts = ['.png','.jpg','.jpeg','.gif','.bmp','.webp','.svg','.ico','.tiff','.tif'];
    function isImageFile(file) {
      if (file.type && file.type.startsWith('image/')) return true;
      const name = (file.name || '').toLowerCase();
      return imageExts.some(ext => name.endsWith(ext));
    }

    let dragCounter = 0;
    // Use window-level listeners to ensure we capture all drag events
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        dragCounter++;
        dropOverlay.classList.add('visible');
      }
    }, true);
    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dropOverlay.classList.remove('visible');
      }
    }, true);
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }, true);
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      dropOverlay.classList.remove('visible');
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      for (const file of e.dataTransfer.files) {
        if (!isImageFile(file)) continue;
        // Try file.path first (Electron provides this for local files)
        const filePath = file.path;
        // Skip files already in the gallery (internal reorder native drag)
        if (filePath && images.some(i => i.path === filePath)) continue;
        if (filePath) {
          ipcRenderer.send('${channelAdd}', filePath);
        } else {
          // Fallback: read as buffer (e.g. Dock drag or web content)
          const reader = new FileReader();
          reader.onload = async () => {
            if (reader.result) {
              const buf = Buffer.from(new Uint8Array(reader.result));
              const result = await ipcRenderer.invoke('${channelAddBuffer}', buf);
              if (result) { images.push(result); render(); }
            }
          };
          reader.readAsArrayBuffer(file);
        }
      }
    }, true);

    // ── Clipboard paste ──
    document.addEventListener('paste', async (e) => {
      if (!e.clipboardData) return;
      const imageItem = Array.from(e.clipboardData.items).find(
        item => item.type.startsWith('image/')
      );
      if (!imageItem) return;
      e.preventDefault();
      const blob = imageItem.getAsFile();
      if (!blob) return;
      const buffer = await blob.arrayBuffer();
      const result = await ipcRenderer.invoke('${channelAddBuffer}', Buffer.from(buffer));
      if (result) {
        images.push(result);
        render();
      }
    });

    // Listen for refresh events from main process (after file-based adds)
    ipcRenderer.on('imagegallery-refresh', () => refresh());

    // Initial load
    refresh();

    ${drawerBaseScript()}
  </script>
</body>
</html>`

  loadDrawerHtml(win, html)
  return true
}
