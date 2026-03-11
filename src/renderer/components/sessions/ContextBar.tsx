import { motion } from 'framer-motion'

interface ContextBarProps {
  percent: number
}

export function ContextBar({ percent }: ContextBarProps) {
  const clamped = Math.min(100, Math.max(0, percent))

  // Color gradient: green -> yellow -> red
  const getColor = (p: number) => {
    if (p < 60) return '#10B981'  // green
    if (p < 80) return '#F59E0B'  // yellow
    return '#EF4444'               // red
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: getColor(clamped) }}
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
      <span className="text-[10px] font-mono text-text-muted w-8 text-right">
        {Math.round(clamped)}%
      </span>
    </div>
  )
}
