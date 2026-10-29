import { createServer, IncomingMessage, ServerResponse } from 'http'
import * as ptyManager from './pty-manager'
import { updateHistoryEntry, isValidSessionId, isMainTranscript } from './session-history'

export const HOOK_PORT = 7799

let server: ReturnType<typeof createServer> | null = null

interface StopPayload {
  session_id?: string
  transcript_path?: string
  stop_hook_active?: boolean
}

interface SessionStartPayload {
  session_id?: string
  transcript_path?: string
  source?: string // startup | resume | clear | compact
}

interface ToolPayload {
  session_id?: string
  tool_name?: string
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(''))
  })
}

function findSessionByClaudeId(sessionId: string): ptyManager.PtySession | undefined {
  return ptyManager.getAllSessions().find(s => s.claudeSessionId === sessionId)
}

/**
 * The PTY named by the X-Carapace-Pty header — but only if the hook's parent is that
 * PTY's own claude process (`exec` keeps the PTY's PID). A `claude` run from inside a
 * session's Bash tool inherits CARAPACE_PTY_ID too, and must not be mistaken for it.
 */
function sessionFromHeaders(req: IncomingMessage): ptyManager.PtySession | undefined {
  const ptyId = req.headers['x-carapace-pty']
  const ppid = Number(req.headers['x-carapace-ppid'])
  if (typeof ptyId !== 'string' || !ptyId) return undefined
  const session = ptyManager.getByPtyId(ptyId)
  return session && session.pid === ppid ? session : undefined
}

function findSession(req: IncomingMessage, sessionId: string): ptyManager.PtySession | undefined {
  return sessionFromHeaders(req) || findSessionByClaudeId(sessionId)
}

/**
 * Claude Code switches to a new session ID on /clear and on an in-session /resume.
 * Overwrite the stored ID so revive reopens the conversation the user was actually
 * in, not the one from before the switch. (`startup` carries nothing new: the ID was
 * assigned at spawn via --session-id / --resume.)
 */
function bindSessionId(req: IncomingMessage, payload: SessionStartPayload): void {
  const { session_id, transcript_path, source } = payload
  if (source !== 'clear' && source !== 'resume') return
  // Teammates/subagents inherit the env; only the main transcript identifies the conversation
  if (!isValidSessionId(session_id) || !isMainTranscript(transcript_path, session_id)) return
  const session = sessionFromHeaders(req)
  if (!session || session.claudeSessionId === session_id) return
  console.log(`[hooks] ${session.ptyId} → session ${session_id} (${source})`)
  session.claudeSessionId = session_id
  updateHistoryEntry(session.ptyId, { claudeSessionId: session_id })
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.writeHead(200)
  res.end()

  if (req.method !== 'POST') return

  const body = await readBody(req)
  let payload: Record<string, unknown> = {}
  try { payload = JSON.parse(body) } catch { return }

  const url = req.url || ''

  if (url === '/hook/sessionstart') {
    bindSessionId(req, payload as SessionStartPayload)
    return
  }

  if (url === '/hook/stop') {
    const { session_id } = payload as StopPayload
    if (!session_id) return
    const session = findSession(req, session_id)
    if (!session) return
    ptyManager.fireBell(session.pid)
    ptyManager.clearThinking(session.pid)
    return
  }

  if (url === '/hook/pretooluse') {
    const { session_id } = payload as ToolPayload
    if (!session_id) return
    const session = findSession(req, session_id)
    if (!session) return
    ptyManager.rearmThinking(session.pid)
    return
  }
}

export function startHookServer(): void {
  if (server) return
  server = createServer((req, res) => {
    handleRequest(req, res).catch(() => {})
  })
  server.listen(HOOK_PORT, '127.0.0.1', () => {
    console.log(`[hooks] Server listening on 127.0.0.1:${HOOK_PORT}`)
  })
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[hooks] Port ${HOOK_PORT} already in use — hook server not started`)
    } else {
      console.error('[hooks] Server error:', err.message)
    }
  })
}

export function stopHookServer(): void {
  if (server) {
    server.close()
    server = null
  }
}
