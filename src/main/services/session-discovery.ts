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

/**
 * Discover all sessions: active (from running processes + JSONL) and
 * historical (from session-meta files).
 */
export function discoverSessions(): SessionState[] {
  const sessions: SessionState[] = []
  const seenIds = new Set<string>()

  // 1. Active sessions — each running Claude PID is a unique session
  const activeProcesses = detectActiveProcesses()
  const usedSessionIds = new Set<string>()

  for (const proc of activeProcesses) {
    // Assign a unique ID: use JSONL sessionId if available and not already taken,
    // otherwise fall back to a PID-based ID (handles new sessions without JSONL
    // and multiple sessions sharing the same CWD)
    let sessionId: string
    if (proc.sessionId && !usedSessionIds.has(proc.sessionId)) {
      sessionId = proc.sessionId
    } else {
      sessionId = `pid-${proc.pid}`
    }
    usedSessionIds.add(sessionId)
    seenIds.add(sessionId)

    // Check both PID and PPID against PTY manager — node-pty's pty.pid is the
    // wrapper process, but the actual claude process is its child (different PID)
    const ptySession = ptyManager.getByPid(proc.pid) || ptyManager.getByPid(proc.ppid)

    // Check if we have a valid transcript for this session
    let hasValidTranscript = false
    if (proc.transcriptFile && fs.existsSync(proc.transcriptFile)) {
      // For managed sessions, only use the JSONL if it was created after the PTY
      // (otherwise it's a stale file from a previous session in the same CWD)
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

      // Use embedded PTY color if available, otherwise fall back to hash-based color
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
        managed: !!ptySession
      })
    } else {
      // Process exists but no transcript found (brand new session)
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
        managed: !!ptySession
      })
    }
  }

  // 2. Historical sessions — from session-meta files
  if (fs.existsSync(SESSION_META_DIR)) {
    const files = fs.readdirSync(SESSION_META_DIR).filter(f => f.endsWith('.json'))

    for (const file of files) {
      try {
        const filePath = path.join(SESSION_META_DIR, file)
        const raw = fs.readFileSync(filePath, 'utf-8')
        const meta: SessionMeta = JSON.parse(raw)

        // Skip if already found as active
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
  }

  // Sort: active first, then by start_time descending
  sessions.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1
    if (b.status === 'active' && a.status !== 'active') return 1
    return new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  })

  return sessions
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
