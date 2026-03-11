import { watch } from 'chokidar'
import { EventEmitter } from 'events'
import * as path from 'path'
import { PROJECTS_DIR } from '@shared/constants/paths'
import { parseSessionJsonl } from './jsonl-parser'
import { computeDetailedCost } from './cost-calculator'
import { computeContextPercent } from './context-tracker'
import type { ParsedSession } from './jsonl-parser'

export interface SessionUpdate {
  sessionId: string
  projectPath: string
  parsed: ParsedSession
  cost: number
  contextPercent: number
}

export class SessionMonitor extends EventEmitter {
  private watcher: ReturnType<typeof watch> | null = null

  start(): void {
    if (this.watcher) return

    this.watcher = watch(`${PROJECTS_DIR}/**/*.jsonl`, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      }
    })

    this.watcher.on('change', (filePath: string) => {
      this.handleFileChange(filePath)
    })

    this.watcher.on('add', (filePath: string) => {
      this.handleFileChange(filePath)
    })
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  private handleFileChange(filePath: string): void {
    // Extract session ID from path
    // Path format: ~/.claude/projects/[encoded-cwd]/[uuid]/subagents/agent-*.jsonl
    // OR: ~/.claude/projects/[encoded-cwd]/[uuid].jsonl
    const relativePath = path.relative(PROJECTS_DIR, filePath)
    const parts = relativePath.split(path.sep)

    let sessionId: string | null = null
    let projectEncoded: string | null = null

    if (parts.length >= 2) {
      projectEncoded = parts[0] || null

      // Check if second part is a UUID (session directory)
      const possibleUuid = parts[1]
      if (possibleUuid && /^[a-f0-9-]{36}$/.test(possibleUuid)) {
        sessionId = possibleUuid
      } else if (possibleUuid && possibleUuid.endsWith('.jsonl')) {
        // Direct JSONL file: [uuid].jsonl
        sessionId = possibleUuid.replace('.jsonl', '')
      }
    }

    if (!sessionId || !projectEncoded) return

    // Parse the changed file
    const parsed = parseSessionJsonl(filePath)

    // Compute cost from detailed metrics
    const cost = computeDetailedCost(
      parsed.metrics.inputTokens,
      parsed.metrics.outputTokens,
      0, // cache write approximation handled in cachedTokens
      parsed.metrics.cachedTokens,
      parsed.model
    )

    const contextPercent = computeContextPercent(parsed.metrics.contextLength, parsed.model)

    // Decode project path from encoded directory name
    const projectPath = '/' + (projectEncoded || '').replace(/-/g, '/')

    const update: SessionUpdate = {
      sessionId,
      projectPath,
      parsed,
      cost,
      contextPercent
    }

    this.emit('session:updated', update)
  }
}
