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

/** Render a 3D orb with specular highlights to a canvas data URL (matches dock icon style) */
const orbCache = new Map<string, string>()
function renderOrbDataUrl(hexColor: string, size: number): string {
  const key = `${hexColor}-${size}`
  const cached = orbCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const h = hexColor.replace('#', '')
  const cr = parseInt(h.substring(0, 2), 16)
  const cg = parseInt(h.substring(2, 4), 16)
  const cb = parseInt(h.substring(4, 6), 16)

  const cx = size / 2, cy = size / 2
  const radius = size * 0.48
  const imgData = ctx.createImageData(size, size)
  const d = imgData.data

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist <= radius + 1.5) {
        const t = Math.min(1, dist / radius)
        const hlDist = Math.sqrt((dx / radius + 0.3) ** 2 + (dy / radius + 0.35) ** 2)
        const specular = Math.max(0, 1 - hlDist * 1.1) ** 5 * 0.85
        const diffuse = Math.max(0, 1 - t * 0.7)
        const edge = 1 - t ** 3 * 0.6
        const light = (0.5 + diffuse * 0.5) * edge + specular
        const aa = Math.min(1, Math.max(0, radius + 1.5 - dist))

        d[idx]     = Math.min(255, Math.round(cr * light + specular * 200))
        d[idx + 1] = Math.min(255, Math.round(cg * light + specular * 180))
        d[idx + 2] = Math.min(255, Math.round(cb * light + specular * 220))
        d[idx + 3] = Math.round(255 * aa)
      }
    }
  }

  ctx.putImageData(imgData, 0, 0)
  const url = canvas.toDataURL('image/png')
  orbCache.set(key, url)
  return url
}

const MAIN_ORB_SIZE = 70
const MINI_ORB_SIZE = 28
const ORBIT_RADIUS = 60
const LABEL_OFFSET = 16 // extra distance beyond mini-orb edge for % label
const CENTER_X = 105 // half of 210 wide
const CENTER_Y = 105 // centered in 210-tall window

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
  // After initialization, thinkingPids is updated ONLY by direct SESSION_THINKING IPC
  // (not from broadcast session data) to avoid stale broadcast keeping spinner on.
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
      // Use Array.from to correctly handle multi-byte emoji as first character
      const firstChar = Array.from(name)[0] || '?'
      const displayLabel = session.label || firstChar.toUpperCase()
      return {
        id: session.id,
        color: darkenColor(session.color),
        rawColor: session.color,
        pid: session.pid,
        needsAttention: session.pid ? attentionPids.has(session.pid) : false,
        isThinking: session.pid ? thinkingPids.has(session.pid) : false,
        contextPercent: Math.round(session.contextPercent),
        initial: displayLabel,
        x: CENTER_X + cos * ORBIT_RADIUS - MINI_ORB_SIZE / 2,
        y: CENTER_Y + sin * ORBIT_RADIUS - MINI_ORB_SIZE / 2,
        labelX: CENTER_X + cos * labelDist,
        labelY: CENTER_Y + sin * labelDist,
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
        window.carapace?.createSession()
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

  // Hit-test: only capture mouse events when cursor is over a visible element
  const lastIgnored = useRef(true)
  const handleHitTest = useCallback((e: React.MouseEvent) => {
    // Don't toggle during drag
    if (isDragging.current) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const PAD = 6 // extra pixels of padding for easier targeting

    // Check main orb (circle hit test)
    const mainR = MAIN_ORB_SIZE / 2 + PAD
    const dxMain = mx - CENTER_X
    const dyMain = my - CENTER_Y
    let over = (dxMain * dxMain + dyMain * dyMain) <= mainR * mainR

    // Check mini-orbs
    if (!over) {
      const miniR = MINI_ORB_SIZE / 2 + PAD
      over = miniOrbs.some(orb => {
        const cx = orb.x + MINI_ORB_SIZE / 2
        const cy = orb.y + MINI_ORB_SIZE / 2
        const dx = mx - cx
        const dy = my - cy
        return (dx * dx + dy * dy) <= miniR * miniR
      })
    }

    const shouldIgnore = !over
    if (shouldIgnore !== lastIgnored.current) {
      lastIgnored.current = shouldIgnore
      window.carapace?.setIgnoreMouseEvents(shouldIgnore)
    }
  }, [miniOrbs])

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
      {/* Static mini-orbs positioned radially */}
      <AnimatePresence>
        {miniOrbs.map((orb) => (
          <motion.div
            key={orb.id}
            className="absolute cursor-pointer flex items-center justify-center"
            style={{
              width: MINI_ORB_SIZE,
              height: MINI_ORB_SIZE,
              left: orb.x,
              top: orb.y,
              backgroundImage: `url(${renderOrbDataUrl(orb.rawColor, MINI_ORB_SIZE * 2)})`,
              backgroundSize: 'cover',
              filter: orb.needsAttention
                ? `drop-shadow(0 0 7px ${orb.rawColor}) drop-shadow(0 0 3px rgba(255,255,255,0.4))`
                : `drop-shadow(0 0 5px ${orb.rawColor}40) drop-shadow(0 1px 3px rgba(0,0,0,0.3))`,
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
            className="absolute pointer-events-none flex items-center gap-[6px]"
            style={{
              left: orb.labelX,
              top: orb.labelY,
              transform: 'translate(-50%, -50%)',
              fontSize: 12,
              fontWeight: 800,
              lineHeight: 1,
              color: '#fff',
              textShadow: `0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7), 0 0 6px ${orb.rawColor}80`,
              letterSpacing: '-0.3px',
              whiteSpace: 'nowrap',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {orb.isThinking && (
              <span
                className="inline-block animate-spin"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  border: '2px solid transparent',
                  borderTopColor: orb.rawColor,
                  borderRightColor: orb.rawColor,
                  flexShrink: 0,
                }}
              />
            )}
            {orb.contextPercent}%
          </motion.span>
        ))}
        {/* Thinking spinner for sessions with 0% context (no label shown yet) */}
        {miniOrbs.filter(o => !o.needsAttention && o.contextPercent === 0 && o.isThinking).map((orb) => (
          <motion.span
            key={`thinking-${orb.id}`}
            className="absolute pointer-events-none"
            style={{
              left: orb.labelX,
              top: orb.labelY,
              transform: 'translate(-50%, -50%)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <span
              className="inline-block animate-spin"
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                border: '2px solid transparent',
                borderTopColor: orb.rawColor,
                borderRightColor: orb.rawColor,
              }}
            />
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

      {/* Main orb — centered in window, 3D rendered */}
      <motion.div
        className="absolute cursor-pointer select-none"
        style={{
          width: MAIN_ORB_SIZE,
          height: MAIN_ORB_SIZE,
          left: CENTER_X - MAIN_ORB_SIZE / 2,
          top: CENTER_Y - MAIN_ORB_SIZE / 2,
          backgroundImage: `url(${renderOrbDataUrl('#7C3AED', MAIN_ORB_SIZE * 2)})`,
          backgroundSize: 'cover',
          filter: count > 0
            ? 'drop-shadow(0 0 14px rgba(124, 58, 237, 0.5)) drop-shadow(0 4px 10px rgba(0,0,0,0.4))'
            : 'drop-shadow(0 4px 10px rgba(0,0,0,0.4))',
        }}
        whileHover={{
          filter: 'drop-shadow(0 0 20px rgba(124, 58, 237, 0.7)) drop-shadow(0 0 10px rgba(37, 99, 235, 0.5)) drop-shadow(0 4px 10px rgba(0,0,0,0.4))',
        }}
        transition={{ duration: 0.2 }}
        onMouseDown={handleMainMouseDown}
      >
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
