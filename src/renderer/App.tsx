import { useMemo } from 'react'
import { useSessions } from './hooks/useSessions'
import { SessionList } from './components/sessions/SessionList'
import { FloatingOrb } from './components/orb/FloatingOrb'

function PanelView() {
  const { sessions, activeSessions, recentSessions, loading, error } = useSessions()

  return (
    <div className="h-full flex flex-col bg-black/[0.85] backdrop-blur-xl rounded-2xl overflow-hidden border border-white/[0.06]">
      {/* Header - draggable */}
      <div className="drag-region px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-brand to-brand-blue shadow-[0_0_12px_rgba(124,58,237,0.3)]" />
          <h1 className="text-[14px] font-bold text-text-primary tracking-tight">Carapace</h1>
        </div>
        <div className="flex items-center gap-2 no-drag">
          {activeSessions.length > 0 && (
            <span className="text-[10px] text-success font-mono font-medium">
              {activeSessions.length} live
            </span>
          )}
          <span className="text-[10px] text-text-muted font-mono">
            {sessions.length} total
          </span>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <p className="text-danger text-[12px] text-center">{error}</p>
        </div>
      ) : (
        <SessionList
          sessions={sessions}
          activeSessions={activeSessions}
          recentSessions={recentSessions}
        />
      )}

      {/* Footer */}
      <div className="shrink-0 px-4 py-2 border-t border-white/[0.04] text-[10px] text-text-muted text-center font-mono">
        {sessions.length} sessions tracked
      </div>
    </div>
  )
}

function OrbView() {
  return <FloatingOrb />
}

export default function App() {
  const view = useMemo(() => {
    const hash = window.location.hash
    if (hash === '#/orb') return 'orb'
    if (hash === '#/panel') return 'panel'
    // Default: show panel (for single-window dev mode)
    return 'panel'
  }, [])

  if (view === 'orb') return <OrbView />
  return <PanelView />
}
