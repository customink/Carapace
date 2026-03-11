import { useEffect, useState, useRef } from 'react'
import type { SessionState } from '../../shared/types/session'

const api = typeof window !== 'undefined' ? window.carapace : undefined

export function useSessions() {
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastPushTime = useRef(0)

  const refresh = async () => {
    if (!api) {
      setError('Not running in Electron')
      setLoading(false)
      return
    }
    try {
      const result = await api.getSessions()
      setSessions(result as SessionState[])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()

    // Low-frequency backup poll (30s) — push updates handle real-time.
    // Only poll if we haven't received a push update recently.
    const interval = setInterval(() => {
      if (Date.now() - lastPushTime.current > 15_000) {
        refresh()
      }
    }, 30_000)

    // Listen for push updates from main process
    let unsubscribe: (() => void) | undefined
    if (api?.onSessionsUpdated) {
      unsubscribe = api.onSessionsUpdated((updated) => {
        lastPushTime.current = Date.now()
        setSessions(updated as SessionState[])
      })
    }

    return () => {
      clearInterval(interval)
      unsubscribe?.()
    }
  }, [])

  const activeSessions = sessions.filter(s => s.status === 'active')
  const recentSessions = sessions.slice(0, 30)

  return { sessions, activeSessions, recentSessions, loading, error, refresh }
}
