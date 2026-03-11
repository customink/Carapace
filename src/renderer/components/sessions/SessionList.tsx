import { motion, AnimatePresence } from 'framer-motion'
import type { SessionState } from '../../../shared/types/session'
import { SessionCard } from './SessionCard'

interface SessionListProps {
  sessions: SessionState[]
  activeSessions: SessionState[]
  recentSessions: SessionState[]
}

export function SessionList({ activeSessions }: SessionListProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2">
        <span className="text-[12px] font-semibold text-text-primary">Active Sessions</span>
        <span className="text-[11px] text-text-muted">{activeSessions.length}</span>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
        <AnimatePresence mode="popLayout">
          {activeSessions.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12 text-text-muted text-[12px]"
            >
              No active sessions
            </motion.div>
          ) : (
            activeSessions.map((session, i) => (
              <SessionCard key={session.id} session={session} index={i} />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
