import { BrowserWindow } from 'electron'
import { join } from 'path'

let panelWindow: BrowserWindow | null = null

export function createPanelWindow(): BrowserWindow {
  panelWindow = new BrowserWindow({
    width: 380,
    height: 650,
    frame: false,
    transparent: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    alwaysOnTop: true,
    show: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env['ELECTRON_RENDERER_URL']) {
    panelWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#/panel')
  } else {
    panelWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/panel' })
  }

  panelWindow.on('closed', () => {
    panelWindow = null
  })

  return panelWindow
}

export function hidePanel(): void {
  if (panelWindow && panelWindow.isVisible()) {
    panelWindow.hide()
  }
}

export function getPanelWindow(): BrowserWindow | null {
  return panelWindow
}
