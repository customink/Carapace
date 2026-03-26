import * as fs from 'fs'
import * as path from 'path'
import { PROJECTS_DIR } from '@shared/constants/paths'
import { findTranscriptFiles } from './jsonl-parser'
import { loadNotes } from './session-history'
import { loadPromptHistory } from './prompt-history'
import * as ptyManager from './pty-manager'

export interface CarapaceContextPackage {
  version: 1
  exportedAt: string
  metadata: {
    title: string
    folder: string
    color: string
    label: string
    bypass: boolean
    shellTabNames: string[]
    claudeSessionId: string
  }
  notes: string
  promptHistory: string[]
  transcripts: {
    main: string // base64-encoded JSONL
    subagents: Record<string, string> // filename → base64
  }
}

/**
 * Package a running session's conversation context for sharing.
 * Returns null if the session has no claudeSessionId yet (no conversation started).
 */
export function exportContext(pid: number): CarapaceContextPackage | null {
  const session = ptyManager.getByPid(pid)
  if (!session || !session.claudeSessionId) return null

  const encodedCwd = session.cwd.replace(/\//g, '-')
  const projectDir = path.join(PROJECTS_DIR, encodedCwd)
  const transcriptFiles = findTranscriptFiles(projectDir, session.claudeSessionId)

  if (transcriptFiles.length === 0) return null

  // Separate main transcript from subagent transcripts
  const mainFile = transcriptFiles.find(f => path.basename(f) === `${session.claudeSessionId}.jsonl`)
  const subagentFiles = transcriptFiles.filter(f => f !== mainFile)

  let mainContent = ''
  if (mainFile) {
    mainContent = Buffer.from(fs.readFileSync(mainFile)).toString('base64')
  }

  const subagents: Record<string, string> = {}
  for (const sf of subagentFiles) {
    const name = path.basename(sf)
    subagents[name] = Buffer.from(fs.readFileSync(sf)).toString('base64')
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    metadata: {
      title: session.title || '',
      folder: session.cwd,
      color: session.color || '',
      label: session.label || '',
      bypass: true,
      shellTabNames: session.shellTabNames || [],
      claudeSessionId: session.claudeSessionId,
    },
    notes: loadNotes(session.ptyId),
    promptHistory: loadPromptHistory(session.ptyId),
    transcripts: {
      main: mainContent,
      subagents,
    },
  }
}

/**
 * Import a shared context package: places JSONL files in the correct
 * project directory so `claude --resume` can find them.
 * Returns the claudeSessionId to use for resuming.
 */
export function importContext(pkg: CarapaceContextPackage, targetCwd: string): string {
  const encodedCwd = targetCwd.replace(/\//g, '-')
  const projectDir = path.join(PROJECTS_DIR, encodedCwd)
  const sessionId = pkg.metadata.claudeSessionId

  // Ensure project directory exists
  fs.mkdirSync(projectDir, { recursive: true })

  // Write main transcript
  if (pkg.transcripts.main) {
    const mainPath = path.join(projectDir, `${sessionId}.jsonl`)
    fs.writeFileSync(mainPath, Buffer.from(pkg.transcripts.main, 'base64'))
  }

  // Write subagent transcripts
  if (pkg.transcripts.subagents && Object.keys(pkg.transcripts.subagents).length > 0) {
    const subagentsDir = path.join(projectDir, sessionId, 'subagents')
    fs.mkdirSync(subagentsDir, { recursive: true })
    for (const [filename, content] of Object.entries(pkg.transcripts.subagents)) {
      fs.writeFileSync(path.join(subagentsDir, filename), Buffer.from(content, 'base64'))
    }
  }

  return sessionId
}
