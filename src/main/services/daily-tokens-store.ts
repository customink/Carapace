import * as fs from 'fs'
import { join } from 'path'
import { DAILY_TOKENS_FILE } from '@shared/constants/paths'

// Persists the daily token accumulator independently of JSONL state.
// Tracks the MAXIMUM tokens ever seen per session per day. Summing these
// gives the true daily consumption even after /clear (which resets the JSONL
// but doesn't undo tokens that were already sent to the API).
// Also stores cost, model, color, name, and projectPath so the per-session
// gauge has complete data even for sessions that have already ended.

export interface SessionDayData {
  tokens: number
  cost: number
  model: string
  color?: string
  name?: string
  projectPath?: string
}

interface DailyStore {
  date: string
  sessions: Record<string, SessionDayData>
}

let store: DailyStore = { date: '', sessions: {} }

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
    const parsed = JSON.parse(raw)
    if (parsed.date !== today()) {
      store = { date: today(), sessions: {} }
      return
    }
    // Migrate old format: { sessionMaxes: Record<string,number> } → new format
    if (parsed.sessionMaxes && !parsed.sessions) {
      const sessions: Record<string, SessionDayData> = {}
      for (const [id, tokens] of Object.entries(parsed.sessionMaxes as Record<string, number>)) {
        sessions[id] = { tokens, cost: 0, model: '' }
      }
      store = { date: today(), sessions }
    } else {
      store = { date: today(), sessions: parsed.sessions ?? {} }
    }
  } catch {
    store = { date: today(), sessions: {} }
  }
}

/** Record a token/cost observation for a session. Returns true if the daily total changed. */
export function recordSessionData(
  sessionId: string,
  tokens: number,
  cost: number,
  model: string,
  color?: string,
  name?: string,
  projectPath?: string,
): boolean {
  if (!sessionId || tokens <= 0) return false
  if (store.date !== today()) {
    store = { date: today(), sessions: {} }
  }
  const prev = store.sessions[sessionId]
  const prevTokens = prev?.tokens ?? 0
  const tokensChanged = tokens > prevTokens

  store.sessions[sessionId] = {
    tokens: Math.max(tokens, prevTokens),
    cost: tokensChanged ? cost : (prev?.cost ?? cost),
    model: model || prev?.model || '',
    color: color || prev?.color,
    name: name || prev?.name,
    projectPath: projectPath || prev?.projectPath,
  }

  if (tokensChanged) {
    persist()
    return true
  }
  return false
}

/** Sum of peak tokens seen per session for today. */
export function getDailyTokens(): number {
  if (store.date !== today()) return 0
  return Object.values(store.sessions).reduce((sum, v) => sum + v.tokens, 0)
}

/** Per-session breakdown for today — used by the outer gauge. */
export function getDailySessionBreakdown(): Array<SessionDayData & { sessionId: string }> {
  if (store.date !== today()) return []
  return Object.entries(store.sessions)
    .filter(([, d]) => d.tokens > 0)
    .map(([sessionId, d]) => ({ sessionId, ...d }))
}
