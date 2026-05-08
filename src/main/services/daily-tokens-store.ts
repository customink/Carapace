import * as fs from 'fs'
import { join } from 'path'
import { DAILY_TOKENS_FILE } from '@shared/constants/paths'

// Persists the daily token accumulator independently of JSONL state.
// Tracks the MAXIMUM tokens ever seen per session per day. Summing these
// gives the true daily consumption even after /clear (which resets the JSONL
// but doesn't undo tokens that were already sent to the API).

interface DailyStore {
  date: string                          // toDateString() of the tracked day
  sessionMaxes: Record<string, number>  // claudeSessionId → peak totalTokens seen
}

let store: DailyStore = { date: '', sessionMaxes: {} }

function today(): string {
  return new Date().toDateString()
}

function ensureDir(): void {
  const dir = join(DAILY_TOKENS_FILE, '..')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function persist(): void {
  try {
    ensureDir()
    fs.writeFileSync(DAILY_TOKENS_FILE, JSON.stringify(store), 'utf-8')
  } catch { /* non-fatal */ }
}

export function loadDailyTokens(): void {
  try {
    const raw = fs.readFileSync(DAILY_TOKENS_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as DailyStore
    store = parsed.date === today() ? parsed : { date: today(), sessionMaxes: {} }
  } catch {
    store = { date: today(), sessionMaxes: {} }
  }
}

/** Record a token observation for a session. Returns true if the daily total changed. */
export function recordSessionTokens(sessionId: string, tokens: number): boolean {
  if (!sessionId || tokens <= 0) return false
  if (store.date !== today()) {
    store = { date: today(), sessionMaxes: {} }
  }
  const prev = store.sessionMaxes[sessionId] ?? 0
  if (tokens > prev) {
    store.sessionMaxes[sessionId] = tokens
    persist()
    return true
  }
  return false
}

/** Sum of peak tokens seen per session for today. */
export function getDailyTokens(): number {
  if (store.date !== today()) return 0
  return Object.values(store.sessionMaxes).reduce((sum, v) => sum + v, 0)
}
