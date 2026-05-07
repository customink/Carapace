import { createServer, IncomingMessage, ServerResponse } from 'http'
import * as ptyManager from './pty-manager'

export const HOOK_PORT = 7799

let server: ReturnType<typeof createServer> | null = null

interface StopPayload {
  session_id?: string
  transcript_path?: string
  stop_hook_active?: boolean
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

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.writeHead(200)
  res.end()

  if (req.method !== 'POST') return

  const body = await readBody(req)
  let payload: Record<string, unknown> = {}
  try { payload = JSON.parse(body) } catch { return }

  const url = req.url || ''

  if (url === '/hook/stop') {
    const { session_id } = payload as StopPayload
    if (!session_id) return
    const session = findSessionByClaudeId(session_id)
    if (!session) return
    ptyManager.fireBell(session.pid)
    ptyManager.clearThinking(session.pid)
    return
  }

  if (url === '/hook/pretooluse') {
    const { session_id } = payload as ToolPayload
    if (!session_id) return
    const session = findSessionByClaudeId(session_id)
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
