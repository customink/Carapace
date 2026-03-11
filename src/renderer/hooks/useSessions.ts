import { useEffect, useState } from 'react'
import type { SessionState } from '../../shared/types/session'

const api = typeof window !== 'undefined' ? window.carapace : undefined

export function useSessions() {
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

    // Poll every 5 seconds for updates
    const interval = setInterval(refresh, 5_000)

    // Also listen for push updates
    let unsubscribe: (() => void) | undefined
    if (api?.onSessionsUpdated) {
      unsubscribe = api.onSessionsUpdated((updated) => {
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
