import { useRef, useCallback, useMemo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSessions } from '../../hooks/useSessions'

const DRAG_THRESHOLD = 4

/** Darken a hex color to match the terminal titlebar tint */
function darkenColor(hex: string, factor = 0.45): string {
  const h = hex.replace('#', '')
  const r = Math.round(parseInt(h.substring(0, 2), 16) * factor)
  const g = Math.round(parseInt(h.substring(2, 4), 16) * factor)
  const b = Math.round(parseInt(h.substring(4, 6), 16) * factor)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

const MAIN_ORB_SIZE = 70
const MINI_ORB_SIZE = 28
const ORBIT_RADIUS = 60
const LABEL_OFFSET = 16 // extra distance beyond mini-orb edge for % label
const CENTER_X = 105 // half of 210 wide
const CENTER_Y = 75  // shifted up in 150-tall window

export function FloatingOrb() {
  const { activeSessions } = useSessions()
  const isDragging = useRef(false)
  const didDrag = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const [attentionPids, setAttentionPids] = useState<Set<number>>(new Set())

  // Only show sessions spawned by Carapace on the orb
  const managedSessions = activeSessions.filter(s => s.managed)
  const count = managedSessions.length

  // Listen for attention notifications from main process
  useEffect(() => {
    const api = window.carapace
    if (!api) return

    const unsubAttention = api.onSessionAttention?.((pid: number) => {
      setAttentionPids(prev => {
        const next = new Set(prev)
        next.add(pid)
        return next
      })
    })

    const unsubClear = api.onSessionAttentionClear?.((pid: number) => {
      setAttentionPids(prev => {
        const next = new Set(prev)
        next.delete(pid)
        return next
      })
    })

    return () => {
      unsubAttention?.()
      unsubClear?.()
    }
  }, [])

  // Sort sessions by startTime ascending (oldest first = left side)
  const sortedSessions = useMemo(() => {
    return [...managedSessions].sort((a, b) =>
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    )
  }, [managedSessions])

  // Clock positions: 12 slots at 30° each, starting at 9 o'clock (180°)
  // Only the first 12 sessions get a mini-orb (visual limit)
  const CLOCK_POSITIONS = 12
  const SLOT_DEG = 360 / CLOCK_POSITIONS // 30° per slot
  const START_ANGLE = 180 // 9 o'clock

  const miniOrbs = useMemo(() => {
    return sortedSessions.slice(0, CLOCK_POSITIONS).map((session, i) => {
      const angleDeg = START_ANGLE + SLOT_DEG * i
      const angleRad = (angleDeg * Math.PI) / 180
      const cos = Math.cos(angleRad)
      const sin = Math.sin(angleRad)
      // Label positioned along the same radial line, beyond the mini-orb edge
      const labelDist = ORBIT_RADIUS + MINI_ORB_SIZE / 2 + LABEL_OFFSET
      const name = session.title || session.firstPrompt || 'Claude Code'
      return {
        id: session.id,
        color: darkenColor(session.color),
        rawColor: session.color,
        pid: session.pid,
        needsAttention: session.pid ? attentionPids.has(session.pid) : false,
        contextPercent: Math.round(session.contextPercent),
        initial: (name[0] || '?').toUpperCase(),
        x: CENTER_X + cos * ORBIT_RADIUS - MINI_ORB_SIZE / 2,
        y: CENTER_Y + sin * ORBIT_RADIUS - MINI_ORB_SIZE / 2,
        labelX: CENTER_X + cos * labelDist,
        labelY: CENTER_Y + sin * labelDist,
      }
    })
  }, [sortedSessions, count, attentionPids])

  const handleMainMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    isDragging.current = true
    didDrag.current = false
    dragStart.current = { x: e.screenX, y: e.screenY }
    window.carapace?.dragStart(e.screenX, e.screenY)

    let rafId = 0
    let latestX = e.screenX
    let latestY = e.screenY

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const dx = Math.abs(ev.screenX - dragStart.current.x)
      const dy = Math.abs(ev.screenY - dragStart.current.y)
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        didDrag.current = true
      }
      latestX = ev.screenX
      latestY = ev.screenY
      // Batch moves to one per animation frame to avoid IPC flooding
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0
          window.carapace?.dragMove(latestX, latestY)
        })
      }
    }

    const onMouseUp = () => {
      isDragging.current = false
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
      // Send final position before ending drag
      window.carapace?.dragMove(latestX, latestY)
      window.carapace?.dragEnd()
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)

      if (!didDrag.current) {
        window.carapace?.togglePanel()
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  const handleMiniOrbClick = useCallback((e: React.MouseEvent, pid: number | undefined) => {
    e.stopPropagation()
    if (pid) {
      // Clear attention locally immediately for responsive UI
      setAttentionPids(prev => {
        const next = new Set(prev)
        next.delete(pid)
        return next
      })
      window.carapace?.focusSession(pid)
    }
  }, [])

  const handleMiniOrbContextMenu = useCallback((e: React.MouseEvent, pid: number | undefined) => {
    e.preventDefault()
    e.stopPropagation()
    if (pid) {
      window.carapace?.miniOrbContextMenu(pid)
    }
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    window.carapace?.showContextMenu()
  }, [])

  return (
    <div
      className="w-full h-full relative"
      onContextMenu={handleContextMenu}
      onMouseEnter={() => window.carapace?.orbMouseEnter()}
      onMouseLeave={() => window.carapace?.orbMouseLeave()}
    >
      {/* Static mini-orbs positioned radially */}
      <AnimatePresence>
        {miniOrbs.map((orb) => (
          <motion.div
            key={orb.id}
            className="absolute rounded-full cursor-pointer flex items-center justify-center"
            style={{
              width: MINI_ORB_SIZE,
              height: MINI_ORB_SIZE,
              left: orb.x,
              top: orb.y,
              background: orb.color,
              boxShadow: orb.needsAttention
                ? `0 0 14px ${orb.rawColor}, 0 0 6px rgba(255,255,255,0.4)`
                : `0 0 10px ${orb.rawColor}40, 0 2px 6px rgba(0,0,0,0.3)`,
            }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: orb.needsAttention ? [1, 1.2, 1] : 1,
              opacity: 1,
            }}
            exit={{ scale: 0, opacity: 0 }}
            transition={orb.needsAttention
              ? { scale: { duration: 0.6, repeat: Infinity, ease: 'easeInOut' }, type: 'spring', stiffness: 400, damping: 20 }
              : { type: 'spring', stiffness: 400, damping: 20 }
            }
            whileHover={{ scale: 1.35 }}
            onClick={(e) => handleMiniOrbClick(e, orb.pid)}
            onContextMenu={(e) => handleMiniOrbContextMenu(e, orb.pid)}
          >
            {orb.needsAttention ? (
              <span style={{ fontSize: 13, lineHeight: 1, filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.5))' }}>
                🔔
              </span>
            ) : (
              <span style={{
                fontSize: 13,
                fontWeight: 700,
                lineHeight: 1,
                color: '#fff',
                textShadow: '0 1px 2px rgba(0,0,0,0.5)',
              }}>
                {orb.initial}
              </span>
            )}
          </motion.div>
        ))}
        {/* Context % labels positioned along radial line outside mini-orbs */}
        {miniOrbs.filter(o => !o.needsAttention && o.contextPercent > 0).map((orb) => (
          <motion.span
            key={`label-${orb.id}`}
            className="absolute pointer-events-none"
            style={{
              left: orb.labelX,
              top: orb.labelY,
              transform: 'translate(-50%, -50%)',
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1,
              color: '#fff',
              textShadow: `0 0 6px ${orb.rawColor}, 0 0 12px ${orb.rawColor}, 0 0 3px rgba(255,255,255,0.5)`,
              letterSpacing: '-0.3px',
              whiteSpace: 'nowrap',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {orb.contextPercent}%
          </motion.span>
        ))}
      </AnimatePresence>

      {/* Pulse ring behind main orb */}
      {count > 0 && (
        <motion.div
          className="absolute rounded-full"
          style={{
            width: MAIN_ORB_SIZE + 6,
            height: MAIN_ORB_SIZE + 6,
            left: CENTER_X - (MAIN_ORB_SIZE + 6) / 2,
            top: CENTER_Y - (MAIN_ORB_SIZE + 6) / 2,
            background: 'radial-gradient(circle, rgba(124,58,237,0.35) 0%, transparent 70%)'
          }}
          animate={{
            scale: [1, 1.4, 1],
            opacity: [0.5, 0, 0.5]
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
        />
      )}

      {/* Main orb — centered in window */}
      <motion.div
        className="absolute rounded-full cursor-pointer select-none"
        style={{
          width: MAIN_ORB_SIZE,
          height: MAIN_ORB_SIZE,
          left: CENTER_X - MAIN_ORB_SIZE / 2,
          top: CENTER_Y - MAIN_ORB_SIZE / 2,
          background: 'linear-gradient(135deg, #7C3AED, #2563EB)',
          boxShadow: count > 0
            ? '0 0 28px rgba(124, 58, 237, 0.5), 0 4px 20px rgba(0,0,0,0.4)'
            : '0 4px 20px rgba(0,0,0,0.4)'
        }}
        whileHover={{
          boxShadow: '0 0 40px rgba(124, 58, 237, 0.7), 0 0 20px rgba(37, 99, 235, 0.5), 0 4px 20px rgba(0,0,0,0.4)',
        }}
        transition={{ duration: 0.2 }}
        onMouseDown={handleMainMouseDown}
      >
        {/* Highlight */}
        <div className="absolute inset-0 rounded-full"
             style={{
               background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.2) 0%, transparent 60%)'
             }} />

        {/* Active session count */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white font-bold text-[26px] leading-none
                           drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
            {count}
          </span>
        </div>
      </motion.div>

    </div>
  )
}
