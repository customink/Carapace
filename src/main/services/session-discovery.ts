import * as fs from 'fs'
import * as path from 'path'
import { SESSION_META_DIR, PROJECTS_DIR } from '@shared/constants/paths'
import type { SessionMeta, SessionState, TokenMetrics } from '@shared/types/session'
import { extractProjectName } from '@shared/utils/format'
import { computeSessionCost, computeDetailedCost } from './cost-calculator'
import { computeContextPercent } from './context-tracker'
import { parseSessionJsonl, findTranscriptFiles } from './jsonl-parser'
import { detectActiveProcesses } from './process-detector'
import { sessionColor } from '@shared/constants/colors'
import * as ptyManager from './pty-manager'

// ─── Cache layer ───
let cachedSessions: SessionState[] = []
let cacheTimestamp = 0
const CACHE_TTL_MS = 800 // serve cached results within 800ms

/** Async session discovery — does not block the main thread. */
export async function discoverSessionsAsync(): Promise<SessionState[]> {
  // Serve from cache if fresh
  if (Date.now() - cacheTimestamp < CACHE_TTL_MS && cachedSessions.length > 0) {
    return cachedSessions
  }

  const sessions: SessionState[] = []
  const seenIds = new Set<string>()

  // 1. Active sessions — each running Claude PID is a unique session
  const activeProcesses = await detectActiveProcesses()
  const usedSessionIds = new Set<string>()
  const seenPids = new Set<number>()

  for (const proc of activeProcesses) {
    // Skip if we've already seen this PID (shouldn't happen after process-detector dedup, but safety net)
    if (seenPids.has(proc.pid)) continue
    seenPids.add(proc.pid)

    let sessionId: string
    if (proc.sessionId && !usedSessionIds.has(proc.sessionId)) {
      sessionId = proc.sessionId
    } else {
      sessionId = `pid-${proc.pid}`
    }
    usedSessionIds.add(sessionId)
    seenIds.add(sessionId)

    const ptySession = ptyManager.getByPid(proc.pid) || ptyManager.getByPid(proc.ppid)

    let hasValidTranscript = false
    if (proc.transcriptFile && fs.existsSync(proc.transcriptFile)) {
      if (ptySession) {
        const mtime = fs.statSync(proc.transcriptFile).mtimeMs
        hasValidTranscript = mtime >= ptySession.createdAt - 5000
      } else {
        hasValidTranscript = true
      }
    }

    if (hasValidTranscript && proc.transcriptFile) {
      const parsed = parseSessionJsonl(proc.transcriptFile)
      const cost = computeDetailedCost(
        parsed.metrics.inputTokens,
        parsed.metrics.outputTokens,
        0,
        parsed.metrics.cachedTokens,
        parsed.model
      )
      const contextPercent = computeContextPercent(parsed.metrics.contextLength, parsed.model)

      const color = ptySession?.color || sessionColor(sessionId)
      sessions.push({
        id: sessionId,
        projectPath: proc.cwd,
        projectName: extractProjectName(proc.cwd),
        summary: parsed.firstPrompt || '',
        firstPrompt: parsed.firstPrompt || '',
        startTime: parsed.startTime || new Date().toISOString(),
        durationMinutes: parsed.durationMinutes || 0,
        status: 'active',
        model: parsed.model,
        cost,
        contextPercent,
        tokens: parsed.metrics,
        toolCounts: {},
        userMessageCount: 0,
        assistantMessageCount: 0,
        pid: proc.pid,
        color,
        title: ptySession?.title || '',
        label: ptySession?.label || '',
        managed: !!ptySession,
        isThinking: ptySession?.isThinking || false,
        completionCount: parsed.completionCount
      })
    } else {
      const newColor = ptySession?.color || sessionColor(sessionId)
      sessions.push({
        id: sessionId,
        projectPath: proc.cwd,
        projectName: extractProjectName(proc.cwd),
        summary: '',
        firstPrompt: '',
        startTime: new Date().toISOString(),
        durationMinutes: 0,
        status: 'active',
        model: 'claude-sonnet-4-6',
        cost: 0,
        contextPercent: 0,
        tokens: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, contextLength: 0 },
        toolCounts: {},
        userMessageCount: 0,
        assistantMessageCount: 0,
        pid: proc.pid,
        color: newColor,
        title: ptySession?.title || '',
        label: ptySession?.label || '',
        managed: !!ptySession,
        isThinking: ptySession?.isThinking || false,
        completionCount: 0
      })
    }
  }

  // 1a. Deduplicate: if multiple detected processes resolved to the same PTY session,
  // keep only the first (managed) one and discard the rest.
  const seenPtyIds = new Set<string>()
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i]!
    if (!s.managed || !s.pid) continue
    const pty = ptyManager.getByPid(s.pid)
    if (!pty) continue
    if (seenPtyIds.has(pty.ptyId)) {
      sessions.splice(i, 1) // remove duplicate
    } else {
      seenPtyIds.add(pty.ptyId)
    }
  }

  // 1b. Ensure all PTY-managed sessions appear even if process detection missed them
  // (e.g. claude process hasn't started yet right after spawn)
  const matchedPtyIds = new Set(
    sessions.filter(s => s.managed).map(s => {
      const pty = ptyManager.getByPid(s.pid!) || (s.pid ? ptyManager.getByPid(s.pid) : undefined)
      return pty?.ptyId
    }).filter(Boolean)
  )

  for (const pty of ptyManager.getAllSessions()) {
    if (matchedPtyIds.has(pty.ptyId)) continue
    // Check if any session already matched this PTY by window ID
    const alreadyMatched = sessions.some(s => s.managed && ptyManager.getByPid(s.pid!)?.ptyId === pty.ptyId)
    if (alreadyMatched) continue

    const sessionId = `pty-${pty.ptyId}`
    if (seenIds.has(sessionId)) continue
    seenIds.add(sessionId)

    sessions.push({
      id: sessionId,
      projectPath: pty.cwd,
      projectName: extractProjectName(pty.cwd),
      summary: '',
      firstPrompt: '',
      startTime: new Date(pty.createdAt).toISOString(),
      durationMinutes: 0,
      status: 'active',
      model: 'claude-sonnet-4-6',
      cost: 0,
      contextPercent: 0,
      tokens: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, contextLength: 0 },
      toolCounts: {},
      userMessageCount: 0,
      assistantMessageCount: 0,
      pid: pty.pid,
      color: pty.color,
      title: pty.title || '',
      label: pty.label || '',
      managed: true,
      isThinking: pty.isThinking || false,
      completionCount: 0
    })
  }

  // 2. Historical sessions — from session-meta files (limit to recent 20 for speed)
  if (fs.existsSync(SESSION_META_DIR)) {
    try {
      const files = fs.readdirSync(SESSION_META_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => ({
          name: f,
          mtime: fs.statSync(path.join(SESSION_META_DIR, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 20)

      for (const file of files) {
        try {
          const filePath = path.join(SESSION_META_DIR, file.name)
          const raw = fs.readFileSync(filePath, 'utf-8')
          const meta: SessionMeta = JSON.parse(raw)

          if (seenIds.has(meta.session_id)) continue

          const enriched = enrichFromJsonl(meta)

          sessions.push({
            id: meta.session_id,
            projectPath: meta.project_path,
            projectName: extractProjectName(meta.project_path),
            summary: meta.summary || '',
            firstPrompt: meta.first_prompt || '',
            startTime: meta.start_time,
            durationMinutes: meta.duration_minutes || 0,
            status: 'historical',
            model: enriched.model,
            cost: enriched.cost,
            contextPercent: enriched.contextPercent,
            tokens: enriched.tokens,
            toolCounts: meta.tool_counts || {},
            userMessageCount: meta.user_message_count || 0,
            assistantMessageCount: meta.assistant_message_count || 0,
            color: sessionColor(meta.session_id)
          })
        } catch {
          // Skip malformed files
        }
      }
    } catch { /* skip */ }
  }

  // Sort: active first, then by start_time descending
  sessions.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1
    if (b.status === 'active' && a.status !== 'active') return 1
    return new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  })

  cachedSessions = sessions
  cacheTimestamp = Date.now()
  return sessions
}

/** Return the last cached result synchronously (for non-critical reads like context menus) */
export function getCachedSessions(): SessionState[] {
  return cachedSessions
}

/** Invalidate the cache (e.g. after local-only changes like label/color updates) */
export function invalidateCache(): void {
  cacheTimestamp = 0
}

interface EnrichedData {
  tokens: TokenMetrics
  model: string
  cost: number
  contextPercent: number
}

function enrichFromJsonl(meta: SessionMeta): EnrichedData {
  const encodedPath = meta.project_path.replace(/\//g, '-')
  const projectDir = path.join(PROJECTS_DIR, encodedPath)

  if (fs.existsSync(projectDir)) {
    const transcriptFiles = findTranscriptFiles(projectDir, meta.session_id)

    if (transcriptFiles.length > 0) {
      const parsed = parseSessionJsonl(transcriptFiles[0]!)

      if (parsed.metrics.totalTokens > 0) {
        const cost = computeDetailedCost(
          parsed.metrics.inputTokens,
          parsed.metrics.outputTokens,
          0,
          parsed.metrics.cachedTokens,
          parsed.model
        )
        const contextPercent = computeContextPercent(parsed.metrics.contextLength, parsed.model)

        return {
          tokens: parsed.metrics,
          model: parsed.model,
          cost,
          contextPercent
        }
      }
    }
  }

  // Fallback to metadata-only data
  const tokens: TokenMetrics = {
    inputTokens: meta.input_tokens || 0,
    outputTokens: meta.output_tokens || 0,
    cachedTokens: 0,
    totalTokens: (meta.input_tokens || 0) + (meta.output_tokens || 0),
    contextLength: 0
  }
  const model = 'claude-sonnet-4-6'

  return {
    tokens,
    model,
    cost: computeSessionCost(tokens, model),
    contextPercent: 0
  }
}
