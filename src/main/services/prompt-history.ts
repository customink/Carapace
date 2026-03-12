import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const HISTORY_DIR = path.join(os.homedir(), '.claude', 'usage-data', 'prompt-history')
const MAX_PROMPTS = 20

function ensureDir(): void {
  fs.mkdirSync(HISTORY_DIR, { recursive: true })
}

function filePath(ptyId: string): string {
  return path.join(HISTORY_DIR, `${ptyId}.json`)
}

export function loadPromptHistory(ptyId: string): string[] {
  try {
    const raw = fs.readFileSync(filePath(ptyId), 'utf-8')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function addPrompt(ptyId: string, prompt: string): string[] {
  const trimmed = prompt.trim()
  if (!trimmed) return loadPromptHistory(ptyId)

  const history = loadPromptHistory(ptyId)

  // Don't add duplicates of the most recent entry
  if (history.length > 0 && history[0] === trimmed) return history

  // Add to front, cap at MAX_PROMPTS
  history.unshift(trimmed)
  if (history.length > MAX_PROMPTS) history.length = MAX_PROMPTS

  ensureDir()
  fs.writeFileSync(filePath(ptyId), JSON.stringify(history, null, 2), 'utf-8')
  return history
}

/** Copy prompt history from a previous session to a new one (for revive) */
export function copyPromptHistory(fromPtyId: string, toPtyId: string): void {
  const history = loadPromptHistory(fromPtyId)
  if (history.length === 0) return
  ensureDir()
  fs.writeFileSync(filePath(toPtyId), JSON.stringify(history, null, 2), 'utf-8')
}
