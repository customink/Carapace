import { execSync, exec } from 'child_process'
import { colorEmoji } from '@shared/constants/colors'

/** Track PIDs and how many times we've attempted colorization */
const colorAttempts = new Map<number, number>()

const MAX_ATTEMPTS = 3

/** Convert hex color (#RRGGBB) to {r,g,b} 0-255 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  }
}

function getTtyForPid(pid: number): string | null {
  try {
    const tty = execSync(`ps -p ${pid} -o tty=`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()

    if (!tty || tty === '??' || tty === '-') return null
    return tty.startsWith('/dev/') ? tty : `/dev/tty${tty}`
  } catch {
    return null
  }
}

/**
 * Set subtle color identification for a terminal running a Claude session.
 * Uses AppleScript to find the session by TTY and set:
 * - Subtle background tint (8% of session color)
 * - Cursor color (full session color)
 * - Session name
 *
 * Note: writing escape sequences to TTY is blocked by macOS permissions,
 * so AppleScript is the only reliable way to change colors from an external process.
 */
export function colorizeSessionTerminal(pid: number, color: string): void {
  const attempts = colorAttempts.get(pid) ?? 0
  if (attempts >= MAX_ATTEMPTS) return

  const devTty = getTtyForPid(pid)
  if (!devTty) return

  const { r, g, b } = hexToRgb(color)

  // Subtle background tint (8% of session color)
  const tint = 0.08
  const bgR = Math.round(r * tint) * 257
  const bgG = Math.round(g * tint) * 257
  const bgB = Math.round(b * tint) * 257

  // Cursor at full session color
  const curR = r * 257
  const curG = g * 257
  const curB = b * 257

  const emoji = colorEmoji(color)

  const script = `
tell application "iTerm"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "${devTty}" then
          set background color of s to {${bgR}, ${bgG}, ${bgB}}
          set cursor color of s to {${curR}, ${curG}, ${curB}}
          set name of s to "${emoji} Claude Code"
          return
        end if
      end repeat
    end repeat
  end repeat
end tell
`

  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, () => {
    // Silently ignore errors
  })

  colorAttempts.set(pid, attempts + 1)
}

/** Remove a PID from tracking (e.g. when session ends) */
export function clearColorizedPid(pid: number): void {
  colorAttempts.delete(pid)
}
