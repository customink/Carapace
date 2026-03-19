import { BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'path'

let orbWindow: BrowserWindow | null = null
let dragStartBounds: Electron.Rectangle | null = null
let dragStartCursor = { x: 0, y: 0 }
let lastDragPos = { x: 0, y: 0 }
let lastDragTime = 0
let velocityX = 0
let velocityY = 0
let physicsTimer: ReturnType<typeof setInterval> | null = null

const WINDOW_WIDTH = 450
const WINDOW_HEIGHT = 280
const MAIN_ORB_CENTER_X = 70
const MAIN_ORB_CENTER_Y = 50

export function createOrbWindow(): BrowserWindow {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  orbWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: -20,
    y: -20,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  orbWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  orbWindow.setOpacity(0.7)

  // Make transparent areas click-through; forward cursor events so renderer can detect hover
  orbWindow.setIgnoreMouseEvents(true, { forward: true })

  ipcMain.on('orb:set-ignore-mouse', (_e, ignore: boolean) => {
    if (!orbWindow || orbWindow.isDestroyed()) return
    if (ignore) {
      orbWindow.setIgnoreMouseEvents(true, { forward: true })
    } else {
      orbWindow.setIgnoreMouseEvents(false)
    }
  })

  // Animated opacity fade on hover
  let opacityTimer: ReturnType<typeof setInterval> | null = null
  let targetOpacity = 0.7

  function animateOpacity(target: number) {
    targetOpacity = target
    if (opacityTimer) return // already animating
    opacityTimer = setInterval(() => {
      if (!orbWindow || orbWindow.isDestroyed()) {
        if (opacityTimer) { clearInterval(opacityTimer); opacityTimer = null }
        return
      }
      const current = orbWindow.getOpacity()
      const diff = targetOpacity - current
      if (Math.abs(diff) < 0.02) {
        orbWindow.setOpacity(targetOpacity)
        clearInterval(opacityTimer!)
        opacityTimer = null
        return
      }
      orbWindow.setOpacity(current + diff * 0.25)
    }, 16)
  }

  ipcMain.on('orb:mouse-enter', () => animateOpacity(1.0))
  ipcMain.on('orb:mouse-leave', () => animateOpacity(0.7))

  // Custom drag — also moves panel if visible
  // The visual content (orb + mini-orbs) is inset ~29px from the window edges.
  // Allow the transparent margin to go off-screen so the orb can sit near edges.
  // X: keep the orb fully visible (orb is at X=70, radius 35, so left edge is at ~35px)
  const VISUAL_INSET_X = 40
  // Y: allow orb to reach top/bottom edges (orb is near top of window)
  const VISUAL_INSET_Y = WINDOW_HEIGHT - 30

  const FRICTION = 0.82
  const BOUNCE = 0.3
  const MIN_VELOCITY = 1

  function stopPhysics() {
    if (physicsTimer) { clearInterval(physicsTimer); physicsTimer = null }
  }

  function getWorkArea() {
    if (!orbWindow) return null
    return screen.getDisplayMatching(orbWindow.getBounds()).workArea
  }

  function clampAndBounce(pos: number, vel: number, min: number, max: number): [number, number] {
    if (pos < min) return [min, Math.abs(vel) * BOUNCE]
    if (pos > max) return [max, -Math.abs(vel) * BOUNCE]
    return [pos, vel]
  }

  ipcMain.on('orb:drag-start', (_e, screenX: number, screenY: number) => {
    if (!orbWindow) return
    stopPhysics()
    dragStartBounds = orbWindow.getBounds()
    dragStartCursor = { x: screenX, y: screenY }
    lastDragPos = { x: screenX, y: screenY }
    lastDragTime = Date.now()
    velocityX = 0
    velocityY = 0
  })

  ipcMain.on('orb:drag-move', (_e, screenX: number, screenY: number) => {
    if (!orbWindow || !dragStartBounds) return

    const now = Date.now()
    const dt = Math.max(now - lastDragTime, 1)

    // Track velocity from recent movement (weighted toward latest)
    const instantVx = (screenX - lastDragPos.x) / dt * 16
    const instantVy = (screenY - lastDragPos.y) / dt * 16
    velocityX = velocityX * 0.3 + instantVx * 0.7
    velocityY = velocityY * 0.3 + instantVy * 0.7

    lastDragPos = { x: screenX, y: screenY }
    lastDragTime = now

    const newX = dragStartBounds.x + (screenX - dragStartCursor.x)
    const newY = dragStartBounds.y + (screenY - dragStartCursor.y)
    orbWindow.setBounds({ x: newX, y: newY, width: WINDOW_WIDTH, height: WINDOW_HEIGHT })
  })

  ipcMain.on('orb:drag-end', () => {
    if (!orbWindow || !dragStartBounds) { dragStartBounds = null; return }

    const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY)

    // If flicked fast enough, apply physics; otherwise just clamp
    if (speed > 3) {
      let posX = orbWindow.getBounds().x
      let posY = orbWindow.getBounds().y
      let vx = velocityX
      let vy = velocityY

      physicsTimer = setInterval(() => {
        if (!orbWindow || orbWindow.isDestroyed()) { stopPhysics(); return }

        const wa = getWorkArea()
        if (!wa) { stopPhysics(); return }

        posX += vx
        posY += vy
        vx *= FRICTION
        vy *= FRICTION

        const minX = wa.x - VISUAL_INSET_X
        const maxX = wa.x + wa.width - WINDOW_WIDTH + VISUAL_INSET_X
        const minY = wa.y - VISUAL_INSET_Y
        const maxY = wa.y + wa.height - WINDOW_HEIGHT + VISUAL_INSET_Y

        ;[posX, vx] = clampAndBounce(posX, vx, minX, maxX)
        ;[posY, vy] = clampAndBounce(posY, vy, minY, maxY)

        orbWindow.setBounds({
          x: Math.round(posX), y: Math.round(posY),
          width: WINDOW_WIDTH, height: WINDOW_HEIGHT
        })

        if (Math.abs(vx) < MIN_VELOCITY && Math.abs(vy) < MIN_VELOCITY) {
          stopPhysics()
        }
      }, 16)
    } else {
      // Gentle release — just clamp to bounds
      const wa = getWorkArea()
      if (wa) {
        const bounds = orbWindow.getBounds()
        const clampedX = Math.max(
          wa.x - VISUAL_INSET_X,
          Math.min(bounds.x, wa.x + wa.width - WINDOW_WIDTH + VISUAL_INSET_X)
        )
        const clampedY = Math.max(
          wa.y - VISUAL_INSET_Y,
          Math.min(bounds.y, wa.y + wa.height - WINDOW_HEIGHT + VISUAL_INSET_Y)
        )
        if (clampedX !== bounds.x || clampedY !== bounds.y) {
          orbWindow.setBounds({ x: clampedX, y: clampedY, width: WINDOW_WIDTH, height: WINDOW_HEIGHT })
        }
      }
    }
    dragStartBounds = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    orbWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#/orb')
  } else {
    orbWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/orb' })
  }

  orbWindow.on('closed', () => {
    orbWindow = null
  })

  return orbWindow
}

export function getOrbWindow(): BrowserWindow | null {
  return orbWindow
}
