import { BrowserWindow, app } from 'electron'
import * as ptyManager from './pty-manager'
import { getOrbWindow } from '../windows/orb'
import { IPC_CHANNELS } from '../ipc/channels'

/**
 * Focus the terminal window running the given PID.
 * For embedded terminals, finds the BrowserWindow by PTY PID.
 * Falls back to AppleScript for external iTerm2/Terminal sessions.
 */
export function focusSessionTerminal(pid: number): void {
  // Check embedded terminals first
  const session = ptyManager.getByPid(pid)
  if (session) {
    const win = BrowserWindow.fromId(session.windowId)
    if (win && !win.isDestroyed()) {
      ptyManager.clearAttention(pid)
      const orb = getOrbWindow()
      if (orb && !orb.isDestroyed()) {
        orb.webContents.send(IPC_CHANNELS.SESSION_ATTENTION_CLEAR, pid)
      }
      app.dock?.show()
      app.focus({ steal: true })
      if (win.isMinimized()) win.restore()
      win.moveTop()
      win.show()
      win.focus()
      return
    }
  }

  // Fallback: try to focus via AppleScript for external sessions
  const { exec, execSync } = require('child_process')
  let tty: string
  try {
    tty = execSync(`ps -p ${pid} -o tty=`, { encoding: 'utf-8', timeout: 3000 }).trim()
  } catch {
    return
  }

  if (!tty || tty === '??' || tty === '-') return
  const devTty = tty.startsWith('/dev/') ? tty : `/dev/tty${tty}`

  const script = `
tell application "System Events"
  set iTermRunning to (name of processes) contains "iTerm2"
end tell
if iTermRunning then
  tell application "iTerm"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is "${devTty}" then
            select t
            tell w to select
            activate
            return
          end if
        end repeat
      end repeat
    end repeat
  end tell
end if
`
  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`)
}
