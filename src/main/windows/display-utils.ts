import { screen, type BrowserWindow } from 'electron'

/**
 * Centres a window on the display the cursor is on, rather than the primary one.
 *
 * `center: true` always uses the primary display, so on a multi-monitor setup a dialog
 * triggered from Slack on the external screen silently opens on the laptop screen — it looks
 * like the action did nothing. Called just before `show()`.
 */
export function centerOnCursorDisplay(win: BrowserWindow): void {
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const { width, height } = win.getBounds()
    const area = display.workArea
    win.setBounds({
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width,
      height,
    })
  } catch {
    // Fall back to wherever the window already is
  }
}
