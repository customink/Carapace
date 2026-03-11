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
  /** Raw encoded project dir name (e.g. "-Users-ivan-myproject") for exact matching */
  projectEncoded: string
  parsed: ParsedSession
  cost: number
  contextPercent: number
}

export class SessionMonitor extends EventEmitter {
  private watcher: ReturnType<typeof watch> | null = null
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private static DEBOUNCE_MS = 1000

  start(): void {
    if (this.watcher) return

    this.watcher = watch(PROJECTS_DIR, {
      ignoreInitial: true,
      depth: 2,
    })

    const handleEvent = (filePath: string) => {
      if (!filePath.endsWith('.jsonl')) return
      this.debouncedChange(filePath)
    }

    this.watcher.on('change', handleEvent)
    this.watcher.on('add', handleEvent)
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
  }

  /** Debounce per-file: only process each file once per DEBOUNCE_MS window */
  private debouncedChange(filePath: string): void {
    const existing = this.debounceTimers.get(filePath)
    if (existing) clearTimeout(existing)

    this.debounceTimers.set(filePath, setTimeout(() => {
      this.debounceTimers.delete(filePath)
      this.handleFileChange(filePath)
    }, SessionMonitor.DEBOUNCE_MS))
  }

  private handleFileChange(filePath: string): void {
    // Extract session ID from path
    const relativePath = path.relative(PROJECTS_DIR, filePath)
    const parts = relativePath.split(path.sep)

    let sessionId: string | null = null
    let projectEncoded: string | null = null

    if (parts.length >= 2) {
      projectEncoded = parts[0] || null

      const possibleUuid = parts[1]
      if (possibleUuid && /^[a-f0-9-]{36}$/.test(possibleUuid)) {
        sessionId = possibleUuid
      } else if (possibleUuid && possibleUuid.endsWith('.jsonl')) {
        sessionId = possibleUuid.replace('.jsonl', '')
      }
    }

    if (!sessionId || !projectEncoded) return

    const parsed = parseSessionJsonl(filePath)

    const cost = computeDetailedCost(
      parsed.metrics.inputTokens,
      parsed.metrics.outputTokens,
      0,
      parsed.metrics.cachedTokens,
      parsed.model
    )

    const contextPercent = computeContextPercent(parsed.metrics.contextLength, parsed.model)

    const projectPath = (projectEncoded || '').replace(/-/g, '/')

    const update: SessionUpdate = {
      sessionId,
      projectPath,
      projectEncoded: projectEncoded || '',
      parsed,
      cost,
      contextPercent
    }

    this.emit('session:updated', update)
  }
}
