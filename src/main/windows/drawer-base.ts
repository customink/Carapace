import { BrowserWindow, ipcMain } from 'electron'

// ─── Color helpers ───

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  }
}

export function tintedBackground(hex: string, tint = 0.08): string {
  const { r, g, b } = hexToRgb(hex)
  const tr = Math.round(r * tint).toString(16).padStart(2, '0')
  const tg = Math.round(g * tint).toString(16).padStart(2, '0')
  const tb = Math.round(b * tint).toString(16).padStart(2, '0')
  return `#${tr}${tg}${tb}`
}

// ─── Shared CSS ───

/** Base reset + body + scrollbar styles shared by every drawer */
export function drawerBaseCss(bgColor: string): string {
  return `
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
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
`
}

/** Header bar CSS with close button */
export function drawerHeaderCss(headerBg: string): string {
  return `
  .drawer-header {
    -webkit-app-region: drag;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px 0 14px;
    font-size: 11px;
    font-weight: 600;
    color: rgba(255,255,255,0.55);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: ${headerBg};
  }
  .drawer-header-left {
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: none;
  }
  .drawer-header-right {
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .drawer-close-btn {
    -webkit-app-region: no-drag;
    width: 24px; height: 24px;
    border: none; border-radius: 5px;
    background: transparent;
    color: rgba(255,255,255,0.3);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; line-height: 1;
    transition: all 0.15s ease;
    padding: 0;
  }
  .drawer-close-btn:hover {
    background: rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.7);
  }
`
}

/** Header HTML with title, optional extra buttons, and a close (X) button */
export function drawerHeaderHtml(title: string, extraButtonsHtml = ''): string {
  const closeIcon = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`
  return `<div class="drawer-header">
  <span class="drawer-header-left">${title}</span>
  <span class="drawer-header-right">
    ${extraButtonsHtml}
    <button class="drawer-close-btn" id="drawer-close-btn" title="Close">${closeIcon}</button>
  </span>
</div>`
}

/** CSS for a search input with inline clear (x) button. Use with drawerSearchHtml(). */
export function drawerSearchCss(accentColor: string): string {
  return `
  .drawer-search-wrap {
    -webkit-app-region: no-drag;
    position: relative;
    margin: 8px 10px 0;
    flex-shrink: 0;
  }
  .drawer-search {
    width: 100%;
    padding: 6px 26px 6px 10px;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    background: rgba(0,0,0,0.25);
    color: rgba(255,255,255,0.9);
    font-size: 12px;
    outline: none;
    font-family: inherit;
  }
  .drawer-search:focus { border-color: ${accentColor}60; }
  .drawer-search::placeholder { color: rgba(255,255,255,0.2); }
  .drawer-search-clear {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    width: 18px; height: 18px;
    border: none; border-radius: 4px;
    background: transparent;
    color: rgba(255,255,255,0.25);
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all 0.1s;
  }
  .drawer-search-clear:hover {
    background: rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.6);
  }
  .drawer-search-clear.visible { display: flex; }
`
}

/** HTML for a search input with inline clear button */
export function drawerSearchHtml(placeholder: string, inputId = 'search'): string {
  return `<div class="drawer-search-wrap">
  <input id="${inputId}" class="drawer-search" type="text" placeholder="${placeholder}" />
  <button id="${inputId}-clear" class="drawer-search-clear" title="Clear">
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
  </button>
</div>`
}

/** Script to wire up a search clear button. Call after the input exists. */
export function drawerSearchScript(inputId = 'search'): string {
  return `
    (function() {
      const inp = document.getElementById('${inputId}');
      const clr = document.getElementById('${inputId}-clear');
      function updateClear() { clr.classList.toggle('visible', inp.value.length > 0); }
      inp.addEventListener('input', updateClear);
      clr.addEventListener('click', () => {
        inp.value = '';
        updateClear();
        inp.dispatchEvent(new Event('input'));
        inp.focus();
      });
    })();
  `
}

/** Base script: Escape to close + close button click handler */
export function drawerBaseScript(): string {
  return `
    document.getElementById('drawer-close-btn').addEventListener('click', () => window.close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.close();
    });
  `
}

// ─── Drawer window creation + lifecycle ───

export interface DrawerConfig {
  parentWin: BrowserWindow
  width: number
  color: string
  /** IPC channel name sent to parent when this drawer closes, e.g. 'terminal:notes-closed' */
  closedChannel: string
  /** Map to store the window reference, keyed by parentWin.id */
  windowMap: Map<number, BrowserWindow>
  /** Additional IPC channel names to removeAllListeners on cleanup */
  ipcChannels?: string[]
  /** Additional IPC handle names to removeHandler on cleanup */
  ipcHandlers?: string[]
  /** Which side of the parent to anchor: 'left' (default) or 'right' */
  side?: 'left' | 'right'
}

export interface DrawerResult {
  win: BrowserWindow
  bgColor: string
  headerBg: string
}

/**
 * Create a drawer BrowserWindow positioned to the left of parentWin.
 * Handles: positioning, follow-parent, minimize/restore, cleanup, close notification.
 * Returns the window and computed colors so the caller can build its HTML.
 */
export function createDrawerWindow(config: DrawerConfig): DrawerResult | null {
  const { parentWin, width, color, closedChannel, windowMap, ipcChannels, ipcHandlers, side = 'left' } = config

  // Toggle: if already open, close it
  const existing = windowMap.get(parentWin.id)
  if (existing && !existing.isDestroyed()) {
    existing.close()
    windowMap.delete(parentWin.id)
    return null
  }

  const parentBounds = parentWin.getBounds()
  const bgColor = tintedBackground(color, 0.06)
  const headerBg = tintedBackground(color, 0.1)

  const MIN_DRAWER_WIDTH = 200
  const MAX_DRAWER_WIDTH = 800

  const win = new BrowserWindow({
    width,
    height: parentBounds.height,
    x: side === 'right' ? parentBounds.x + parentBounds.width : parentBounds.x - width,
    y: parentBounds.y,
    frame: false,
    transparent: false,
    backgroundColor: bgColor,
    hasShadow: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    minWidth: MIN_DRAWER_WIDTH,
    maxWidth: MAX_DRAWER_WIDTH,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  })

  windowMap.set(parentWin.id, win)

  // Follow parent — keep drawer anchored to parent's edge, match height
  let resizing = false
  const updatePosition = () => {
    if (win.isDestroyed() || resizing) return
    const b = parentWin.getBounds()
    const drawerW = win.getBounds().width
    const x = side === 'right' ? b.x + b.width : b.x - drawerW
    win.setBounds({ x, y: b.y, width: drawerW, height: b.height })
  }

  // When user resizes the drawer, snap height to parent and re-anchor position.
  // Only the width should change freely; height stays locked to the terminal.
  const onDrawerResize = () => {
    if (win.isDestroyed() || parentWin.isDestroyed()) return
    resizing = true
    const db = win.getBounds()
    const pb = parentWin.getBounds()
    // Clamp width and lock height to parent
    const w = Math.max(MIN_DRAWER_WIDTH, Math.min(MAX_DRAWER_WIDTH, db.width))
    const x = side === 'right' ? pb.x + pb.width : pb.x - w
    win.setBounds({ x, y: pb.y, width: w, height: pb.height })
    resizing = false
  }

  parentWin.on('move', updatePosition)
  parentWin.on('resize', updatePosition)
  win.on('resize', onDrawerResize)
  parentWin.on('minimize', () => { if (!win.isDestroyed()) win.hide() })
  parentWin.on('restore', () => { if (!win.isDestroyed()) win.show() })

  const cleanup = () => {
    if (ipcChannels) {
      for (const ch of ipcChannels) ipcMain.removeAllListeners(ch)
    }
    if (ipcHandlers) {
      for (const h of ipcHandlers) {
        try { ipcMain.removeHandler(h) } catch { /* already removed */ }
      }
    }
    parentWin.removeListener('move', updatePosition)
    parentWin.removeListener('resize', updatePosition)
    win.removeListener('resize', onDrawerResize)
    windowMap.delete(parentWin.id)
  }

  win.on('closed', () => {
    cleanup()
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send(closedChannel)
    }
  })

  parentWin.on('closed', () => {
    if (!win.isDestroyed()) win.close()
    cleanup()
  })

  return { win, bgColor, headerBg }
}

/**
 * Load HTML into a drawer window and show it.
 */
export function loadDrawerHtml(win: BrowserWindow, html: string): void {
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  win.once('ready-to-show', () => win.show())
}
