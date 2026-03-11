import { useCallback } from 'react'
import { motion } from 'framer-motion'
import type { SessionState } from '../../../shared/types/session'
import { formatCost, formatTokens, formatDuration } from '../../../shared/utils/format'
import { ContextBar } from './ContextBar'

interface SessionCardProps {
  session: SessionState
  index: number
}

function ModelChip({ model }: { model: string }) {
  let label = model
  let color = 'bg-brand/20 text-brand'

  if (model.includes('opus')) {
    label = 'opus'
    color = 'bg-brand/20 text-purple-400'
  } else if (model.includes('sonnet')) {
    label = 'sonnet'
    color = 'bg-brand-blue/20 text-blue-400'
  } else if (model.includes('haiku')) {
    label = 'haiku'
    color = 'bg-success/20 text-emerald-400'
  }

  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${color}`}>
      {label}
    </span>
  )
}

export function SessionCard({ session, index }: SessionCardProps) {
  const handleClick = useCallback(() => {
    if (session.pid) {
      window.carapace?.focusSession(session.pid)
    }
  }, [session.pid])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      className="bg-surface rounded-xl p-3 cursor-pointer
                 hover:bg-surface-hover transition-colors duration-150
                 border border-white/[0.04]"
      onClick={handleClick}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1.5">
        {/* Color dot matching orbiting mini-orb */}
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{
            backgroundColor: session.color,
            boxShadow: `0 0 6px ${session.color}60`
          }}
        />
        <span className="text-[13px] font-semibold text-text-primary truncate flex-1">
          {session.projectName}
        </span>
        <ModelChip model={session.model} />
      </div>

      {/* Summary */}
      {session.summary && (
        <p className="text-[11px] text-text-secondary truncate mb-2 pl-5">
          {session.summary}
        </p>
      )}

      {/* Metrics row */}
      <div className="flex items-center gap-3 text-[11px] pl-5">
        <span className={`font-mono font-medium ${
          session.cost >= 5 ? 'text-warning' :
          session.cost >= 1 ? 'text-yellow-400' :
          'text-success'
        }`}>
          {formatCost(session.cost)}
        </span>
        <span className="text-text-muted">
          {formatTokens(session.tokens.totalTokens)} tok
        </span>
        <span className="text-text-muted">
          {formatDuration(session.durationMinutes)}
        </span>
        {session.status === 'active' && (
          <span className="text-success text-[10px] font-medium ml-auto">LIVE</span>
        )}
      </div>

      {/* Context bar */}
      {session.contextPercent > 0 && (
        <div className="mt-2 pl-5">
          <ContextBar percent={session.contextPercent} />
        </div>
      )}
    </motion.div>
  )
}
