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
const CENTER_X = 70   // main orb on the left
const CENTER_Y = 150  // vertically centered in 300px window
const PILL_LEFT = 130  // pills start to the right of the orb
const PILL_TOP = 30    // first pill top offset
const PILL_HEIGHT = 26
const PILL_GAP = 6
const PILL_MAX_WIDTH = 300

export function FloatingOrb() {
  const { activeSessions } = useSessions()
  const isDragging = useRef(false)
  const didDrag = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const [attentionPids, setAttentionPids] = useState<Set<number>>(new Set())
  const [thinkingPids, setThinkingPids] = useState<Set<number>>(new Set())
  const thinkingInitialized = useRef(false)

  // Only show sessions spawned by Carapace on the orb
  const managedSessions = activeSessions.filter(s => s.managed)
  const count = managedSessions.length

  // Initialize thinkingPids from session data on first load
  useEffect(() => {
    if (!thinkingInitialized.current && activeSessions.length > 0) {
      thinkingInitialized.current = true
      const initial = new Set<number>()
      for (const session of activeSessions) {
        if (session.pid && session.isThinking) initial.add(session.pid)
      }
      if (initial.size > 0) setThinkingPids(initial)
    }
  }, [activeSessions])

  // Listen for attention and thinking notifications from main process
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

    const unsubThinking = api.onSessionThinking?.((pid: number, isThinking: boolean) => {
      setThinkingPids(prev => {
        const next = new Set(prev)
        if (isThinking) next.add(pid)
        else next.delete(pid)
        return next
      })
    })

    return () => {
      unsubAttention?.()
      unsubClear?.()
      unsubThinking?.()
    }
  }, [])

  // Sort sessions by startTime ascending (oldest first = top)
  const sortedSessions = useMemo(() => {
    return [...managedSessions].sort((a, b) =>
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    )
  }, [managedSessions])

  const pills = useMemo(() => {
    return sortedSessions.slice(0, 8).map((session, i) => {
      const name = session.title || session.firstPrompt || 'Claude Code'
      // Truncate long names
      const displayName = name.length > 28 ? name.slice(0, 26) + '...' : name
      const label = session.label ? `${session.label} ` : ''
      return {
        id: session.id,
        color: darkenColor(session.color),
        rawColor: session.color,
        pid: session.pid,
        needsAttention: session.pid ? attentionPids.has(session.pid) : false,
        isThinking: session.pid ? thinkingPids.has(session.pid) : false,
        contextPercent: Math.round(session.contextPercent),
        name: `${label}${displayName}`,
        x: PILL_LEFT,
        y: PILL_TOP + i * (PILL_HEIGHT + PILL_GAP),
      }
    })
  }, [sortedSessions, count, attentionPids, thinkingPids])

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
      window.carapace?.dragMove(latestX, latestY)
      window.carapace?.dragEnd()
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)

      if (!didDrag.current) {
        window.carapace?.createSession()
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  const handlePillClick = useCallback((e: React.MouseEvent, pid: number | undefined) => {
    e.stopPropagation()
    if (pid) {
      setAttentionPids(prev => {
        const next = new Set(prev)
        next.delete(pid)
        return next
      })
      window.carapace?.focusSession(pid)
    }
  }, [])

  const handlePillContextMenu = useCallback((e: React.MouseEvent, pid: number | undefined) => {
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

  // Hit-test: only capture mouse events when cursor is over a visible element
  const lastIgnored = useRef(true)
  const handleHitTest = useCallback((e: React.MouseEvent) => {
    if (isDragging.current) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const PAD = 6

    // Check main orb (circle hit test)
    const mainR = MAIN_ORB_SIZE / 2 + PAD
    const dxMain = mx - CENTER_X
    const dyMain = my - CENTER_Y
    let over = (dxMain * dxMain + dyMain * dyMain) <= mainR * mainR

    // Check pills (rectangle hit test)
    if (!over) {
      over = pills.some(pill => {
        return mx >= pill.x - PAD && mx <= pill.x + PILL_MAX_WIDTH + PAD
            && my >= pill.y - PAD && my <= pill.y + PILL_HEIGHT + PAD
      })
    }

    const shouldIgnore = !over
    if (shouldIgnore !== lastIgnored.current) {
      lastIgnored.current = shouldIgnore
      window.carapace?.setIgnoreMouseEvents(shouldIgnore)
    }
  }, [pills])

  return (
    <div
      className="w-full h-full relative"
      onContextMenu={handleContextMenu}
      onMouseMove={handleHitTest}
      onMouseEnter={() => window.carapace?.orbMouseEnter()}
      onMouseLeave={() => {
        window.carapace?.orbMouseLeave()
        if (!lastIgnored.current) {
          lastIgnored.current = true
          window.carapace?.setIgnoreMouseEvents(true)
        }
      }}
    >
      {/* Session pills — stacked vertically to the right of the orb */}
      <AnimatePresence>
        {pills.map((pill) => (
          <motion.div
            key={pill.id}
            className="absolute cursor-pointer flex items-center"
            style={{
              left: pill.x,
              top: pill.y,
              height: PILL_HEIGHT,
              borderRadius: PILL_HEIGHT / 2,
              padding: '0 10px 0 4px',
              background: `${pill.color}cc`,
              boxShadow: pill.needsAttention
                ? `0 0 12px ${pill.rawColor}, 0 0 4px rgba(255,255,255,0.3)`
                : `0 2px 8px rgba(0,0,0,0.3), 0 0 6px ${pill.rawColor}30`,
              backdropFilter: 'blur(8px)',
              gap: 6,
            }}
            initial={{ x: -20, opacity: 0 }}
            animate={{
              x: 0,
              opacity: 1,
              scale: pill.needsAttention ? [1, 1.05, 1] : 1,
            }}
            exit={{ x: -20, opacity: 0 }}
            transition={pill.needsAttention
              ? { scale: { duration: 0.6, repeat: Infinity, ease: 'easeInOut' }, type: 'spring', stiffness: 400, damping: 25 }
              : { type: 'spring', stiffness: 400, damping: 25 }
            }
            whileHover={{ scale: 1.04, brightness: 1.1 }}
            onClick={(e) => handlePillClick(e, pill.pid)}
            onContextMenu={(e) => handlePillContextMenu(e, pill.pid)}
          >
            {/* Colored dot */}
            <div style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${pill.rawColor}, ${pill.color})`,
              flexShrink: 0,
              boxShadow: `0 0 6px ${pill.rawColor}60`,
            }} />

            {/* Bell or name */}
            {pill.needsAttention ? (
              <span style={{ fontSize: 12, lineHeight: 1 }}>🔔</span>
            ) : (
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1,
                color: '#fff',
                textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 200,
              }}>
                {pill.name}
              </span>
            )}

            {/* Context % */}
            {pill.contextPercent > 0 && !pill.needsAttention && (
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.5)',
                marginLeft: 2,
                flexShrink: 0,
              }}>
                {pill.contextPercent}%
              </span>
            )}

            {/* Thinking spinner */}
            {pill.isThinking && !pill.needsAttention && (
              <span
                className="inline-block animate-spin"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  border: '2px solid transparent',
                  borderTopColor: '#fff',
                  borderRightColor: '#fff',
                  flexShrink: 0,
                  marginLeft: 2,
                }}
              />
            )}
          </motion.div>
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

      {/* Main orb */}
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
