import { exec } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { IDE_DIR, PROJECTS_DIR } from '@shared/constants/paths'

export interface ActiveProcess {
  pid: number
  ppid: number
  cwd: string
  sessionId: string | null
  projectDir: string | null
  transcriptFile: string | null
}

function execAsync(cmd: string, timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'utf-8', timeout }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

/**
 * Detect running Claude Code processes and resolve their active session transcripts.
 * Fully async — does not block the main thread.
 */
export async function detectActiveProcesses(): Promise<ActiveProcess[]> {
  const processes: ActiveProcess[] = []

  try {
    const output = await execAsync('ps -eo pid,ppid,command', 5000)
    const lines = output.split('\n')
    const pidEntries: Array<{ pid: number; ppid: number }> = []

    for (const line of lines) {
      if (!line.includes('claude')) continue
      if (line.includes('grep') || line.includes('carapace') || line.includes('Claude.app')) continue

      const parts = line.trim().split(/\s+/)
      const pid = parseInt(parts[0] || '', 10)
      const ppid = parseInt(parts[1] || '', 10)
      if (isNaN(pid) || isNaN(ppid)) continue

      // Check if this is an actual claude CLI process
      const cmdPart = parts.slice(2).join(' ')
      if (cmdPart.match(/\bclaude\b/)) {
        pidEntries.push({ pid, ppid })
      }
    }

    if (pidEntries.length === 0) return processes

    // Batch lsof for all PIDs at once (much faster than one per PID)
    const pidList = pidEntries.map(e => e.pid).join(',')
    let lsofOutput = ''
    try {
      lsofOutput = await execAsync(`lsof -p ${pidList} 2>/dev/null | grep cwd`, 10000)
    } catch {
      return processes
    }

    // Parse lsof output to map PID -> CWD
    const pidToCwd = new Map<number, string>()
    for (const lsofLine of lsofOutput.split('\n')) {
      if (!lsofLine.trim()) continue
      const parts = lsofLine.trim().split(/\s+/)
      const pid = parseInt(parts[1] || '', 10)
      const cwd = parts[parts.length - 1]
      if (!isNaN(pid) && cwd && cwd !== '/') {
        pidToCwd.set(pid, cwd)
      }
    }

    // Deduplicate: multiple PIDs can map to the same Claude session
    // (e.g., shell process running `exec claude` + the actual claude process).
    // Keep only one entry per transcript file, preferring the one with a PTY match.
    const seenTranscripts = new Map<string, ActiveProcess>()

    for (const entry of pidEntries) {
      const cwd = pidToCwd.get(entry.pid)
      if (!cwd) continue

      // Encode CWD the way Claude stores project dirs
      const encoded = cwd.replace(/\//g, '-')
      const projectDir = path.join(PROJECTS_DIR, encoded)
      let transcriptFile: string | null = null
      let sessionId: string | null = null

      if (fs.existsSync(projectDir)) {
        transcriptFile = findLatestJsonl(projectDir)
        if (transcriptFile) {
          sessionId = path.basename(transcriptFile, '.jsonl')
        }
      }

      const proc: ActiveProcess = { pid: entry.pid, ppid: entry.ppid, cwd, sessionId, projectDir, transcriptFile }

      // Deduplicate by transcript file (or by CWD if no transcript)
      const dedupeKey = transcriptFile || `cwd:${cwd}`
      const existing = seenTranscripts.get(dedupeKey)
      if (!existing) {
        seenTranscripts.set(dedupeKey, proc)
      } else {
        // Keep the process with the lower PID (the parent/original process),
        // as that's what pty-manager tracks
        if (proc.pid < existing.pid) {
          seenTranscripts.set(dedupeKey, proc)
        }
      }
    }

    processes.push(...seenTranscripts.values())
  } catch {
    // ps failed
  }

  return processes
}

function findLatestJsonl(projectDir: string): string | null {
  try {
    const files = fs.readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: path.join(projectDir, f),
        mtime: fs.statSync(path.join(projectDir, f)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime)

    return files[0]?.path ?? null
  } catch {
    return null
  }
}

/**
 * Check IDE lock files for active sessions.
 */
export function detectIdeSessions(): Array<{ pid: number; workspaceFolders: string[] }> {
  const sessions: Array<{ pid: number; workspaceFolders: string[] }> = []

  if (!fs.existsSync(IDE_DIR)) return sessions

  try {
    const files = fs.readdirSync(IDE_DIR).filter(f => f.endsWith('.lock'))
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(IDE_DIR, file), 'utf-8')
        const data = JSON.parse(raw)
        if (data.pid) {
          sessions.push({
            pid: data.pid,
            workspaceFolders: data.workspaceFolders || []
          })
        }
      } catch {
        // Skip malformed lock files
      }
    }
  } catch {
    // Skip if can't read directory
  }

  return sessions
}
