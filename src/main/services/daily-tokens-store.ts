import * as fs from 'fs'
import { join } from 'path'
import { DAILY_TOKENS_FILE } from '@shared/constants/paths'

// Persists the daily token accumulator independently of JSONL state.
//
// Problem: JSONL token counts are cumulative across the session's entire lifetime.
// A multi-day session that burned 1M tokens yesterday will report 1M+ today even
// before the user types anything new. Naively taking the MAX would count yesterday's
// tokens again today.
//
// Solution: record a per-session `baseline` on the first observation of each day.
//   tokens_today = offset + max(0, currentJSONLTotal - baseline)
//
// `offset` handles /clear: when the JSONL total drops below `peak` (Claude's /clear
// command resets the file), we freeze the pre-clear contribution into `offset` and
// restart the baseline from 0, so those tokens aren't lost from today's total.
//
// Also stores cost, model, color, name, and projectPath so the per-session gauge
// has complete data even for sessions that have already ended.

export interface SessionDayData {
  tokens: number       // tokens burned today
  baseline: number     // JSONL total at start of today for this session
  offset: number       // accumulated tokens from /clear resets within today
  peak: number         // highest JSONL total seen today (detects /clear)
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
    // Migrate v1: { sessionMaxes: Record<string,number> } → current format
    if (parsed.sessionMaxes && !parsed.sessions) {
      const sessions: Record<string, SessionDayData> = {}
      for (const [id, tokens] of Object.entries(parsed.sessionMaxes as Record<string, number>)) {
        sessions[id] = { tokens: tokens as number, baseline: 0, offset: 0, peak: tokens as number, cost: 0, model: '' }
      }
      store = { date: today(), sessions }
      return
    }
    // Migrate v2: sessions without baseline/offset/peak fields
    const sessions: Record<string, SessionDayData> = {}
    for (const [id, d] of Object.entries((parsed.sessions ?? {}) as Record<string, any>)) {
      sessions[id] = {
        tokens: d.tokens ?? 0,
        baseline: d.baseline ?? 0,
        offset: d.offset ?? 0,
        peak: d.peak ?? d.tokens ?? 0,
        cost: d.cost ?? 0,
        model: d.model ?? '',
        color: d.color,
        name: d.name,
        projectPath: d.projectPath,
      }
    }
    store = { date: today(), sessions }
  } catch {
    store = { date: today(), sessions: {} }
  }
}

/** Record a token/cost observation for a session. Returns true if today's total changed. */
export function recordSessionData(
  sessionId: string,
  currentTotal: number,
  cost: number,
  model: string,
  color?: string,
  name?: string,
  projectPath?: string,
): boolean {
  if (!sessionId || currentTotal < 0) return false
  if (store.date !== today()) {
    store = { date: today(), sessions: {} }
  }

  const prev = store.sessions[sessionId]
  let baseline: number
  let offset: number
  let peak: number
  let tokens: number

  if (!prev) {
    // First observation today — current JSONL total is the carry-over baseline.
    // Nothing has been burned yet today from this session's perspective.
    baseline = currentTotal
    offset = 0
    peak = currentTotal
    tokens = 0
  } else if (currentTotal < prev.peak) {
    // JSONL total dropped below our previous peak → /clear was run.
    // Freeze what was burned in the pre-clear run, then start fresh from 0.
    const preClearBurned = prev.peak - prev.baseline
    offset = prev.offset + preClearBurned
    baseline = 0
    peak = currentTotal
    tokens = offset + currentTotal
  } else {
    // Normal growth within the same JSONL run.
    baseline = prev.baseline
    offset = prev.offset
    peak = currentTotal
    tokens = offset + (currentTotal - baseline)
  }

  const prevTokens = prev?.tokens ?? 0
  const tokensChanged = tokens !== prevTokens

  store.sessions[sessionId] = {
    tokens,
    baseline,
    offset,
    peak,
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

/** Sum of tokens burned today across all sessions. */
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
