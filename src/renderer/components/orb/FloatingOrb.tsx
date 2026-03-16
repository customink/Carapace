import { useRef, useCallback, useMemo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSessions } from '../../hooks/useSessions'

const DRAG_THRESHOLD = 4

function darkenColor(hex: string, factor = 0.45): string {
  const h = hex.replace('#', '')
  const r = Math.round(parseInt(h.substring(0, 2), 16) * factor)
  const g = Math.round(parseInt(h.substring(2, 4), 16) * factor)
  const b = Math.round(parseInt(h.substring(4, 6), 16) * factor)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

const MAIN_ORB_SIZE = 70
const CENTER_X = 70
const CENTER_Y = 190
const PILL_LEFT = CENTER_X + MAIN_ORB_SIZE / 2 + 14
const PILL_HEIGHT = 28
const PILL_GAP = 8
const VISIBLE_COUNT = 3 // max pills visible at once

export function FloatingOrb() {
  const { activeSessions } = useSessions()
  const isDragging = useRef(false)
  const didDrag = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const [attentionPids, setAttentionPids] = useState<Set<number>>(new Set())
  const [thinkingPids, setThinkingPids] = useState<Set<number>>(new Set())
  const thinkingInitialized = useRef(false)
  const [scrollOffset, setScrollOffset] = useState(0)

  const managedSessions = activeSessions.filter(s => s.managed)
  const count = managedSessions.length

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

  useEffect(() => {
    const api = window.carapace
    if (!api) return

    const unsubAttention = api.onSessionAttention?.((pid: number) => {
      setAttentionPids(prev => { const next = new Set(prev); next.add(pid); return next })
    })
    const unsubClear = api.onSessionAttentionClear?.((pid: number) => {
      setAttentionPids(prev => { const next = new Set(prev); next.delete(pid); return next })
    })
    const unsubThinking = api.onSessionThinking?.((pid: number, isThinking: boolean) => {
      setThinkingPids(prev => {
        const next = new Set(prev)
        if (isThinking) next.add(pid); else next.delete(pid)
        return next
      })
    })

    return () => { unsubAttention?.(); unsubClear?.(); unsubThinking?.() }
  }, [])

  // Sort newest first
  const sortedSessions = useMemo(() => {
    return [...managedSessions].sort((a, b) =>
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    )
  }, [managedSessions])

  // Reset scroll when session count changes
  useEffect(() => {
    setScrollOffset(prev => Math.min(prev, Math.max(0, sortedSessions.length - VISIBLE_COUNT)))
  }, [sortedSessions.length])

  const canScrollUp = scrollOffset > 0
  const canScrollDown = scrollOffset + VISIBLE_COUNT < sortedSessions.length
  const visibleSessions = sortedSessions.slice(scrollOffset, scrollOffset + VISIBLE_COUNT)

  // Pill data for visible sessions
  const pills = useMemo(() => {
    const totalHeight = visibleSessions.length * PILL_HEIGHT + (visibleSessions.length - 1) * PILL_GAP
    const startY = CENTER_Y - totalHeight / 2

    return visibleSessions.map((session, i) => {
      const name = session.title || session.firstPrompt || 'Claude Code'
      const displayName = name.length > 24 ? name.slice(0, 22) + '...' : name
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
        y: startY + i * (PILL_HEIGHT + PILL_GAP),
      }
    })
  }, [visibleSessions, attentionPids, thinkingPids])

  // Arrow positions
  const arrowX = PILL_LEFT + 60
  const pillsTop = pills.length > 0 ? pills[0].y : CENTER_Y
  const pillsBottom = pills.length > 0 ? pills[pills.length - 1].y + PILL_HEIGHT : CENTER_Y
  const arrowUpY = pillsTop - 18
  const arrowDownY = pillsBottom + 4

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
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) didDrag.current = true
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
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
      window.carapace?.dragMove(latestX, latestY)
      window.carapace?.dragEnd()
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      if (!didDrag.current) window.carapace?.createSession()
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  const handlePillClick = useCallback((e: React.MouseEvent, pid: number | undefined) => {
    e.stopPropagation()
    if (pid) {
      setAttentionPids(prev => { const next = new Set(prev); next.delete(pid); return next })
      window.carapace?.focusSession(pid)
    }
  }, [])

  const handlePillContextMenu = useCallback((e: React.MouseEvent, pid: number | undefined) => {
    e.preventDefault()
    e.stopPropagation()
    if (pid) window.carapace?.miniOrbContextMenu(pid)
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    window.carapace?.showContextMenu()
  }, [])

  // Hit-test for click-through transparency
  const lastIgnored = useRef(true)
  const handleHitTest = useCallback((e: React.MouseEvent) => {
    if (isDragging.current) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const PAD = 6

    // Main orb
    const mainR = MAIN_ORB_SIZE / 2 + PAD
    const dxMain = mx - CENTER_X
    const dyMain = my - CENTER_Y
    let over = (dxMain * dxMain + dyMain * dyMain) <= mainR * mainR

    // Pills
    if (!over) {
      over = pills.some(pill =>
        mx >= pill.x - PAD && mx <= pill.x + 280 + PAD
        && my >= pill.y - PAD && my <= pill.y + PILL_HEIGHT + PAD
      )
    }

    // Scroll arrows
    if (!over && (canScrollUp || canScrollDown)) {
      if (canScrollUp && mx >= arrowX - 14 && mx <= arrowX + 14 && my >= arrowUpY - 4 && my <= arrowUpY + 16) over = true
      if (canScrollDown && mx >= arrowX - 14 && mx <= arrowX + 14 && my >= arrowDownY - 4 && my <= arrowDownY + 16) over = true
    }

    const shouldIgnore = !over
    if (shouldIgnore !== lastIgnored.current) {
      lastIgnored.current = shouldIgnore
      window.carapace?.setIgnoreMouseEvents(shouldIgnore)
    }
  }, [pills, canScrollUp, canScrollDown, arrowX, arrowUpY, arrowDownY])

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
      {/* Scroll up arrow */}
      {canScrollUp && (
        <div
          className="absolute cursor-pointer"
          style={{
            left: arrowX - 10,
            top: arrowUpY,
            color: 'rgba(255,255,255,0.5)',
            fontSize: 14,
            lineHeight: 1,
            textAlign: 'center',
            width: 20,
          }}
          onClick={() => setScrollOffset(prev => Math.max(0, prev - 1))}
        >
          ▲
        </div>
      )}

      {/* Session pills */}
      <AnimatePresence mode="popLayout">
        {pills.map((pill) => (
          <motion.div
            key={pill.id}
            className="absolute cursor-pointer flex items-center"
            layout
            style={{
              height: PILL_HEIGHT,
              borderRadius: PILL_HEIGHT / 2,
              padding: '0 10px 0 5px',
              background: `${pill.color}cc`,
              boxShadow: pill.needsAttention
                ? `0 0 12px ${pill.rawColor}, 0 0 4px rgba(255,255,255,0.3)`
                : `0 2px 8px rgba(0,0,0,0.3), 0 0 6px ${pill.rawColor}30`,
              backdropFilter: 'blur(8px)',
              gap: 6,
            }}
            initial={{ left: pill.x - 20, top: pill.y, opacity: 0 }}
            animate={{
              left: pill.x,
              top: pill.y,
              opacity: 1,
              scale: pill.needsAttention ? [1, 1.05, 1] : 1,
              zIndex: 1,
            }}
            exit={{ left: pill.x - 20, top: pill.y, opacity: 0 }}
            transition={pill.needsAttention
              ? { scale: { duration: 0.6, repeat: Infinity, ease: 'easeInOut' }, type: 'spring', stiffness: 300, damping: 25 }
              : { type: 'spring', stiffness: 300, damping: 25 }
            }
            whileHover={{ scale: 1.08, x: 4, zIndex: 10 }}
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
                maxWidth: 180,
              }}>
                {pill.name}
              </span>
            )}

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

            {pill.isThinking && !pill.needsAttention && (
              <span
                className="inline-block animate-spin"
                style={{
                  width: 10, height: 10,
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

      {/* Scroll down arrow */}
      {canScrollDown && (
        <div
          className="absolute cursor-pointer"
          style={{
            left: arrowX - 10,
            top: arrowDownY,
            color: 'rgba(255,255,255,0.5)',
            fontSize: 14,
            lineHeight: 1,
            textAlign: 'center',
            width: 20,
          }}
          onClick={() => setScrollOffset(prev => Math.min(sortedSessions.length - VISIBLE_COUNT, prev + 1))}
        >
          ▼
        </div>
      )}

      {/* Pulse ring */}
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
          animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
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
        <div className="absolute inset-0 rounded-full"
             style={{ background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.2) 0%, transparent 60%)' }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white font-bold text-[26px] leading-none drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
            {count}
          </span>
        </div>
      </motion.div>
    </div>
  )
}
