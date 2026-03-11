import * as fs from 'fs'
import * as path from 'path'
import type { TokenMetrics } from '@shared/types/session'

interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface TranscriptLine {
  type?: string
  isSidechain?: boolean
  isApiErrorMessage?: boolean
  timestamp?: string
  model?: string
  message?: {
    role?: string
    content?: unknown
    usage?: Usage
    stop_reason?: string
  }
}

export interface ParsedSession {
  metrics: TokenMetrics
  model: string
  lastActivity: string | null
  stopReason: string | null
  firstPrompt: string | null
  startTime: string | null
  durationMinutes: number
}

function parseJsonlLine(line: string): TranscriptLine | null {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

// ─── Parse cache: avoid re-parsing unchanged files ───
const parseCache = new Map<string, { mtime: number; size: number; result: ParsedSession }>()

/**
 * Parse a session JSONL file following ccstatusline's getTokenMetrics() pattern.
 * Sums usage across all assistant messages.
 * Context length from the most recent main-chain (non-sidechain) assistant message.
 * Results are cached and only re-parsed when the file changes.
 */
export function parseSessionJsonl(transcriptPath: string): ParsedSession {
  const empty: ParsedSession = {
    metrics: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, contextLength: 0 },
    model: 'claude-sonnet-4-6',
    lastActivity: null,
    stopReason: null
  }

  if (!fs.existsSync(transcriptPath)) return empty

  // Check cache by mtime + size
  try {
    const stat = fs.statSync(transcriptPath)
    const cached = parseCache.get(transcriptPath)
    if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) {
      return cached.result
    }
  } catch { /* continue to parse */ }

  let content: string
  try {
    content = fs.readFileSync(transcriptPath, 'utf-8')
  } catch {
    return empty
  }

  const lines = content.split('\n').filter(l => l.trim())

  let inputTokens = 0
  let outputTokens = 0
  let cachedTokens = 0
  let contextLength = 0
  let model = 'claude-sonnet-4-6'
  let lastActivity: string | null = null
  let stopReason: string | null = null

  let mostRecentMainChainTimestamp: Date | null = null
  let firstPrompt: string | null = null
  let startTime: string | null = null

  for (const line of lines) {
    const data = parseJsonlLine(line)
    if (!data) continue

    // Track timestamps
    if (data.timestamp) {
      if (!startTime) startTime = data.timestamp
      lastActivity = data.timestamp
    }

    // Extract first user prompt
    if (!firstPrompt && data.message?.role === 'user' && data.message.content) {
      const content = data.message.content
      if (typeof content === 'string') {
        firstPrompt = content.slice(0, 200)
      } else if (Array.isArray(content)) {
        const textBlock = content.find((b: { type?: string; text?: string }) => b.type === 'text' && b.text)
        if (textBlock?.text) firstPrompt = textBlock.text.slice(0, 200)
      }
    }

    // Track model
    if (data.model) {
      model = data.model
    }

    // Sum token usage from assistant messages
    if (data.message?.usage) {
      const usage = data.message.usage
      inputTokens += usage.input_tokens || 0
      outputTokens += usage.output_tokens || 0
      cachedTokens += (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)

      // Context length from most recent main-chain entry (not sidechain, not API error)
      if (data.isSidechain !== true && !data.isApiErrorMessage && data.timestamp) {
        const entryTime = new Date(data.timestamp)
        if (!mostRecentMainChainTimestamp || entryTime > mostRecentMainChainTimestamp) {
          mostRecentMainChainTimestamp = entryTime
          contextLength =
            (usage.input_tokens || 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0)
        }
      }

      // Track stop reason
      if (data.message.stop_reason) {
        stopReason = data.message.stop_reason
      }
    }
  }

  // Compute duration from start to last activity
  let durationMinutes = 0
  if (startTime && lastActivity) {
    durationMinutes = Math.round((new Date(lastActivity).getTime() - new Date(startTime).getTime()) / 60000)
  }

  const result: ParsedSession = {
    metrics: {
      inputTokens,
      outputTokens,
      cachedTokens,
      totalTokens: inputTokens + outputTokens + cachedTokens,
      contextLength
    },
    model,
    lastActivity,
    stopReason,
    firstPrompt,
    startTime,
    durationMinutes
  }

  // Store in cache
  try {
    const stat = fs.statSync(transcriptPath)
    parseCache.set(transcriptPath, { mtime: stat.mtimeMs, size: stat.size, result })
    // Evict old entries to prevent memory leak
    if (parseCache.size > 50) {
      const firstKey = parseCache.keys().next().value
      if (firstKey) parseCache.delete(firstKey)
    }
  } catch { /* ok */ }

  return result
}

/**
 * Extract the last assistant response text from a JSONL transcript.
 */
export function getLastAssistantResponse(transcriptPath: string): string | null {
  if (!fs.existsSync(transcriptPath)) return null

  let content: string
  try {
    content = fs.readFileSync(transcriptPath, 'utf-8')
  } catch {
    return null
  }

  const lines = content.split('\n').filter(l => l.trim())
  let lastResponse: string | null = null

  for (const line of lines) {
    const data = parseJsonlLine(line)
    if (!data) continue
    if (data.isSidechain) continue
    if (data.message?.role !== 'assistant') continue

    const msgContent = data.message.content
    if (typeof msgContent === 'string' && msgContent.trim()) {
      lastResponse = msgContent
    } else if (Array.isArray(msgContent)) {
      const textParts = msgContent
        .filter((b: { type?: string; text?: string }) => b.type === 'text' && b.text)
        .map((b: { text: string }) => b.text)
      if (textParts.length > 0) {
        lastResponse = textParts.join('\n')
      }
    }
  }

  return lastResponse
}

/**
 * Find the main transcript JSONL file for a session directory.
 * Sessions are stored at: ~/.claude/projects/[encoded-path]/[uuid].jsonl
 * OR with subagents at: ~/.claude/projects/[encoded-path]/[uuid]/subagents/agent-*.jsonl
 */
export function findTranscriptFiles(projectDir: string, sessionId: string): string[] {
  const files: string[] = []

  // Check direct JSONL file
  const directFile = path.join(projectDir, `${sessionId}.jsonl`)
  if (fs.existsSync(directFile)) {
    files.push(directFile)
  }

  // Check subagents directory
  const subagentsDir = path.join(projectDir, sessionId, 'subagents')
  if (fs.existsSync(subagentsDir)) {
    try {
      const entries = fs.readdirSync(subagentsDir)
      for (const entry of entries) {
        if (entry.endsWith('.jsonl')) {
          files.push(path.join(subagentsDir, entry))
        }
      }
    } catch {
      // Skip if can't read
    }
  }

  return files
}
