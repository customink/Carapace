import { BrowserWindow, shell } from 'electron'
import { join } from 'path'

/** Convert hex (#RRGGBB) to {r,g,b} 0-255 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  }
}

/** Generate a dark tinted background color string from a session color */
function tintedBackground(hex: string, tint = 0.08): string {
  const { r, g, b } = hexToRgb(hex)
  const tr = Math.round(r * tint)
  const tg = Math.round(g * tint)
  const tb = Math.round(b * tint)
  return `#${tr.toString(16).padStart(2, '0')}${tg.toString(16).padStart(2, '0')}${tb.toString(16).padStart(2, '0')}`
}

export interface TerminalWindowOptions {
  color: string
  ptyId: string
  title?: string
  shellTab?: boolean
}

export function createTerminalWindow(options: TerminalWindowOptions): BrowserWindow {
  const bgColor = tintedBackground(options.color)
  const windowTitle = options.title || 'Claude Code'

  const win = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    backgroundColor: bgColor,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    title: windowTitle,
    webPreferences: {
      preload: join(__dirname, '../preload/terminal.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  // Encode session info as query params for the renderer
  const params = new URLSearchParams({
    ptyId: options.ptyId,
    color: options.color,
    title: windowTitle,
    shellTab: options.shellTab ? '1' : '0',
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/terminal.html?${params}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/terminal.html'), {
      query: Object.fromEntries(params)
    })
  }

  // Open links in default browser instead of Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

  win.show()

  return win
}
