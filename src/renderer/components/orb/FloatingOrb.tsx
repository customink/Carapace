import { useRef, useCallback, useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSessions } from "../../hooks/useSessions";
import { sessionColor } from "@shared/constants/colors";

const DRAG_THRESHOLD = 4;

/** Darken a hex color to match the terminal titlebar tint */
function darkenColor(hex: string, factor = 0.45): string {
  const h = hex.replace("#", "");
  const r = Math.round(parseInt(h.substring(0, 2), 16) * factor);
  const g = Math.round(parseInt(h.substring(2, 4), 16) * factor);
  const b = Math.round(parseInt(h.substring(4, 6), 16) * factor);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

const MAIN_ORB_SIZE = 70;
const CENTER_X = 190; // main orb — 120px left margin added for token counter space
const CENTER_Y = 140; // centered in 380px window
const PILL_LEFT = CENTER_X + MAIN_ORB_SIZE / 2 + 12; // right edge of orb + gap
const PILL_HEIGHT = 26;
const PILL_GAP = 6;
const PILL_MAX_WIDTH = 300;

// Gauge arc — hugs the left side of the orb.
// Angles use standard math (0°=right, 90°=up); -sin maps to SVG screen space.
// 135° = upper-left (full/green), 225° = lower-left (empty/red).
// Fill starts at top and drains downward as tokens are consumed.
// sweep-flag=1 (CW in SVG) selects the left-side arc.
const GAUGE_R = 48;
const GAUGE_SW = 8;
const GAUGE_START = 225;
const GAUGE_END = 135;
const GAUGE_SPAN = GAUGE_START - GAUGE_END; // 90°

function gaugePoint(angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [
    CENTER_X + GAUGE_R * Math.cos(rad),
    CENTER_Y - GAUGE_R * Math.sin(rad),
  ];
}

function gaugeArcPath(startDeg: number, endDeg: number): string {
  const [x1, y1] = gaugePoint(startDeg);
  const [x2, y2] = gaugePoint(endDeg);
  const span = Math.abs(startDeg - endDeg);
  return `M ${x1} ${y1} A ${GAUGE_R} ${GAUGE_R} 0 ${span > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

function gaugeColor(pct: number): string {
  const c = Math.max(0, Math.min(1, pct));
  return `hsl(${120 - c * 120},75%,55%)`;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return `${n}`;
}

// Outer session-token gauge — same arc LENGTH as inner, centered on 180° (left of orb).
// Arc length equality: GAUGE2_R × θ2 = GAUGE_R × θ1  →  θ2 = 90° × (48/R2)
// +2px extra spacing over previous: inner outer-edge=52, desired outer inner-edge=57 → GAUGE2_R=61
const GAUGE2_R = 61;
const GAUGE2_SW = 8; // matches GAUGE_SW
// Angular span that gives the same arc length as the inner gauge at this radius
const GAUGE2_SPAN = (GAUGE_SPAN * GAUGE_R) / GAUGE2_R; // ≈ 70.8°
// Both arcs centered at 180° (directly left of orb)
const GAUGE2_START = 180 + GAUGE2_SPAN / 2; // ≈ 215.4°
const GAUGE2_END = 180 - GAUGE2_SPAN / 2;   // ≈ 144.6°
const SEGMENT_GAP_HALF = 1.0; // degrees trimmed from interior ends between adjacent segments
const CYCLE_BTN_R = 11; // 22px button — fits 14px icons with 4px margin
// Cycle button sits just below the bottom endpoint of the outer arc
const CYCLE_BTN_X = Math.round(CENTER_X + GAUGE2_R * Math.cos((GAUGE2_START * Math.PI) / 180));
const CYCLE_BTN_Y = Math.round(CENTER_Y - GAUGE2_R * Math.sin((GAUGE2_START * Math.PI) / 180)) + 20;
// Max tooltip width keeps it fully left of the outer gauge arc (including outline)
const TOOLTIP_MAX_W = Math.floor(CENTER_X - GAUGE2_R - (GAUGE2_SW + 2) / 2 - 12);

function gauge2Point(angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [CENTER_X + GAUGE2_R * Math.cos(rad), CENTER_Y - GAUGE2_R * Math.sin(rad)];
}

function gauge2ArcPath(startDeg: number, endDeg: number): string {
  const [x1, y1] = gauge2Point(startDeg);
  const [x2, y2] = gauge2Point(endDeg);
  const span = Math.abs(startDeg - endDeg);
  if (span < 0.5) return "";
  return `M ${x1} ${y1} A ${GAUGE2_R} ${GAUGE2_R} 0 ${span > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

// Gauge mode cycling: 0=tokens/session  1=cost/session  2=tokens/model  3=cost/model
const GAUGE_MODE_LABELS = ['Tokens / Session', 'Cost / Session', 'Tokens / Model', 'Cost / Model'];

// Fused icon concepts:
//   Session modes (0,1): person figure — circle head + symbol body
//   Model  modes (2,3): CPU chip outline — rect + side pins + symbol inside
const _is: React.CSSProperties = { display: 'block' };
const GAUGE_MODE_ICONS: React.ReactNode[] = [
  // 0: Tokens/Session — person whose body IS a lightning bolt
  <svg viewBox="0 0 14 14" width="14" height="14" style={_is}>
    <circle cx="7" cy="2.5" r="2" fill="rgba(255,255,255,0.92)"/>
    <path d="M7.5 4.5L5 9H7L4.5 13L9.5 8.5H7.5Z" fill="rgba(255,255,255,0.92)"/>
  </svg>,
  // 1: Cost/Session — person whose body IS a dollar sign
  <svg viewBox="0 0 14 14" width="14" height="14" style={_is}>
    <circle cx="7" cy="2" r="2" fill="rgba(255,255,255,0.92)"/>
    <text x="7" y="12" textAnchor="middle" fontSize="10" fontWeight="700"
      fill="rgba(255,255,255,0.92)" fontFamily="-apple-system,sans-serif">$</text>
  </svg>,
  // 2: Tokens/Model — CPU chip with lightning bolt inside
  <svg viewBox="0 0 14 14" width="14" height="14" style={_is}>
    <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" fill="none"
      stroke="rgba(255,255,255,0.80)" strokeWidth="1.2"/>
    <line x1="0.5" y1="5.5" x2="2.5" y2="5.5" stroke="rgba(255,255,255,0.65)" strokeWidth="1"/>
    <line x1="0.5" y1="9"   x2="2.5" y2="9"   stroke="rgba(255,255,255,0.65)" strokeWidth="1"/>
    <line x1="11.5" y1="5.5" x2="13.5" y2="5.5" stroke="rgba(255,255,255,0.65)" strokeWidth="1"/>
    <line x1="11.5" y1="9"   x2="13.5" y2="9"   stroke="rgba(255,255,255,0.65)" strokeWidth="1"/>
    <path d="M7.5 4L5 7.5H7L5 10.5L9.5 7H7.5Z" fill="rgba(255,255,255,0.92)"/>
  </svg>,
  // 3: Cost/Model — CPU chip with dollar sign inside
  <svg viewBox="0 0 14 14" width="14" height="14" style={_is}>
    <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" fill="none"
      stroke="rgba(255,255,255,0.80)" strokeWidth="1.2"/>
    <line x1="0.5" y1="5.5" x2="2.5" y2="5.5" stroke="rgba(255,255,255,0.65)" strokeWidth="1"/>
    <line x1="0.5" y1="9"   x2="2.5" y2="9"   stroke="rgba(255,255,255,0.65)" strokeWidth="1"/>
    <line x1="11.5" y1="5.5" x2="13.5" y2="5.5" stroke="rgba(255,255,255,0.65)" strokeWidth="1"/>
    <line x1="11.5" y1="9"   x2="13.5" y2="9"   stroke="rgba(255,255,255,0.65)" strokeWidth="1"/>
    <text x="7" y="9.5" textAnchor="middle" fontSize="7" fontWeight="700"
      fill="rgba(255,255,255,0.92)" fontFamily="-apple-system,sans-serif">$</text>
  </svg>,
];

// Return a versioned display name: "claude-sonnet-4-6" → "Sonnet 4.6"
function modelFamily(model: string): string {
  if (!model) return 'Other';
  const match = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (match) {
    const name = match[1]!.charAt(0).toUpperCase() + match[1]!.slice(1);
    return `${name} ${match[2]}.${match[3]}`;
  }
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku')) return 'Haiku';
  return 'Other';
}

// Color based on model family prefix — handles versioned names like "Sonnet 4.6"
function modelColor(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('opus')) return '#A78BFA';
  if (l.includes('sonnet')) return '#60A5FA';
  if (l.includes('haiku')) return '#34D399';
  return '#9CA3AF';
}

function formatCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.001) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

export function FloatingOrb() {
  const { sessions, activeSessions } = useSessions();
  const isDragging = useRef(false);
  const didDrag = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const [attentionPids, setAttentionPids] = useState<Set<number>>(new Set());
  const [thinkingPids, setThinkingPids] = useState<Set<number>>(new Set());
  const [hoveredPillId, setHoveredPillId] = useState<string | null>(null);
  const [gaugeHovered, setGaugeHovered] = useState(false);
  const [orbHovered, setOrbHovered] = useState(false);
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);
  const [gaugeMode, setGaugeMode] = useState(0); // 0–3: tokens/session, cost/session, tokens/model, cost/model
  const [cycleBtnHovered, setCycleBtnHovered] = useState(false);
  const thinkingInitialized = useRef(false);
  const [dailyTokenGoal, setDailyTokenGoal] = useState(0);
  const [dailyTokens, setDailyTokens] = useState(0);
  const [dailyBreakdown, setDailyBreakdown] = useState<any[]>([]);

  // Load app settings, daily token count, and per-session breakdown on mount; subscribe to updates
  useEffect(() => {
    const api = window.carapace as any;
    api?.getAppSettings?.().then((s: any) => setDailyTokenGoal(s?.dailyTokenGoal ?? 0));
    api?.getDailyTokens?.().then((t: number) => setDailyTokens(t ?? 0));
    api?.getDailySessionBreakdown?.().then((b: any[]) => setDailyBreakdown(b ?? []));
    const unsubSettings = api?.onSettingsUpdated?.((s: any) =>
      setDailyTokenGoal(s?.dailyTokenGoal ?? 0),
    );
    const unsubTokens = api?.onDailyTokensUpdated?.((t: number) => setDailyTokens(t));
    const unsubBreakdown = api?.onDailyBreakdownUpdated?.((b: any[]) => setDailyBreakdown(b ?? []));
    return () => {
      unsubSettings?.();
      unsubTokens?.();
      unsubBreakdown?.();
    };
  }, []);

  // Only show sessions spawned by Carapace on the orb
  const managedSessions = activeSessions.filter((s) => s.managed);
  const count = managedSessions.length;

  // Initialize thinkingPids from session data on first load
  useEffect(() => {
    if (!thinkingInitialized.current && activeSessions.length > 0) {
      thinkingInitialized.current = true;
      const initial = new Set<number>();
      for (const session of activeSessions) {
        if (session.pid && session.isThinking) initial.add(session.pid);
      }
      if (initial.size > 0) setThinkingPids(initial);
    }
  }, [activeSessions]);

  // Listen for attention and thinking notifications from main process
  useEffect(() => {
    const api = window.carapace;
    if (!api) return;

    const unsubAttention = api.onSessionAttention?.((pid: number) => {
      setAttentionPids((prev) => {
        const next = new Set(prev);
        next.add(pid);
        return next;
      });
    });

    const unsubClear = api.onSessionAttentionClear?.((pid: number) => {
      setAttentionPids((prev) => {
        const next = new Set(prev);
        next.delete(pid);
        return next;
      });
    });

    const unsubThinking = api.onSessionThinking?.(
      (pid: number, isThinking: boolean) => {
        setThinkingPids((prev) => {
          const next = new Set(prev);
          if (isThinking) next.add(pid);
          else next.delete(pid);
          return next;
        });
      },
    );

    return () => {
      unsubAttention?.();
      unsubClear?.();
      unsubThinking?.();
    };
  }, []);

  // Sort sessions by startTime descending (newest first = top of arc)
  const sortedSessions = useMemo(() => {
    return [...managedSessions].sort(
      (a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    );
  }, [managedSessions]);

  const pills = useMemo(() => {
    const sessionSlice = sortedSessions.slice(0, 8);
    const n = sessionSlice.length;
    if (n === 0) return [];

    // Pills arc around the right side of the orb.
    // Distribute along an arc from -spreadAngle to +spreadAngle (0 = 3 o'clock).
    // New pills appear above existing ones (lowest index = topmost).
    const arcRadius = MAIN_ORB_SIZE / 2 + 16; // distance from orb center to pill left edge
    const perPill = n <= 5 ? 16 : 20; // more spacing after 5 pills
    const spreadAngle = Math.min(n * perPill, 80); // degrees, grows with count, max 80°
    const stepDeg = n > 1 ? (spreadAngle * 2) / (n - 1) : 0;

    // Find hovered index for spread effect
    const hovIdx = sessionSlice.findIndex((s) => s.id === hoveredPillId);

    return sessionSlice.map((session, i) => {
      // Base angle: top to bottom (negative = above center, positive = below)
      let angleDeg = n > 1 ? -spreadAngle + stepDeg * i : 0;

      // Push neighbors apart when one pill is hovered — distance-based falloff
      if (hovIdx >= 0 && i !== hovIdx) {
        const diff = i - hovIdx;
        const sign = diff > 0 ? 1 : -1;
        const distance = Math.abs(diff);
        const push = sign * (10 / distance); // closer neighbors push more
        angleDeg += push;
      }

      const angleRad = (angleDeg * Math.PI) / 180;

      // Position along the arc
      const px = CENTER_X + Math.cos(angleRad) * arcRadius;
      const py = CENTER_Y + Math.sin(angleRad) * arcRadius - PILL_HEIGHT / 2;

      const name = session.title || session.firstPrompt || "Claude Code";
      const displayName = name.length > 28 ? name.slice(0, 26) + "..." : name;
      const label = session.label ? `${session.label} ` : "";
      return {
        id: session.id,
        color: darkenColor(session.color),
        rawColor: session.color,
        pid: session.pid,
        needsAttention: session.pid ? attentionPids.has(session.pid) : false,
        isThinking: session.pid ? thinkingPids.has(session.pid) : false,
        contextPercent: Math.round(session.contextPercent),
        name: `${label}${displayName}`,
        x: px,
        y: py,
      };
    });
  }, [sortedSessions, count, attentionPids, thinkingPids, hoveredPillId]);

  // Gauge segments — backed by daily-tokens-store (ground truth for all sessions today).
  // dailyBreakdown contains every claudeSessionId seen today with tokens, cost, model, color, name.
  // Cross-reference with live sessions[] to pick up the most current color/title.
  const gaugeSegments = useMemo(() => {
    if (dailyBreakdown.length === 0) return [];

    // Build a lookup from claudeSessionId → live SessionState for richer metadata
    const liveById = new Map(sessions.map((s) => [s.id, s]));

    const isCost = gaugeMode === 1 || gaugeMode === 3;
    let items: Array<{ id: string; color: string; value: number; label: string; metric: string }>;

    if (gaugeMode === 0 || gaugeMode === 1) {
      // Per-session: use breakdown entries directly
      items = dailyBreakdown
        .filter((e) => e.tokens > 0)
        .map((e) => {
          const live = liveById.get(e.sessionId);
          // Color: live session color (most current) → stored color from history → hash fallback
          const color = (live?.color || e.color || sessionColor(e.sessionId)) as string;
          // Name priority: preset/stack title (live) → history title → folder name from enrichment
          const label = (live?.title || e.name || live?.projectName || 'Claude Code') as string;
          const value = isCost ? (e.cost ?? 0) : e.tokens;
          const metric = isCost
            ? formatCost(e.cost ?? 0)
            : `${formatTokenCount(e.tokens)} tokens`;
          return { id: e.sessionId, color, value, label, metric };
        })
        .sort((a, b) => b.value - a.value);
    } else {
      // Per-model: aggregate breakdown by model family
      const groups = new Map<string, { tokens: number; cost: number }>();
      for (const e of dailyBreakdown) {
        const family = modelFamily(e.model || '');
        const g = groups.get(family) ?? { tokens: 0, cost: 0 };
        groups.set(family, { tokens: g.tokens + e.tokens, cost: g.cost + (e.cost ?? 0) });
      }
      items = Array.from(groups.entries())
        .map(([family, data]) => {
          const value = gaugeMode === 2 ? data.tokens : data.cost;
          const metric = gaugeMode === 2
            ? `${formatTokenCount(data.tokens)} tokens`
            : formatCost(data.cost);
          return { id: family, color: modelColor(family), value, label: family, metric };
        })
        .sort((a, b) => b.value - a.value);
    }

    items = items.filter((i) => i.value > 0);
    const total = items.reduce((sum, i) => sum + i.value, 0);
    if (total === 0) return [];

    let cur = GAUGE2_START;
    const last = items.length - 1;
    return items
      .map((item, idx) => {
        const pct = item.value / total;
        const span = pct * GAUGE2_SPAN;
        const segStart = cur;
        const segEnd = cur - span;
        cur = segEnd;
        const midAngle = (segStart + segEnd) / 2;
        const [midX, midY] = gauge2Point(midAngle);
        const rawLabel = item.label.length > 24 ? item.label.slice(0, 22) + '…' : item.label;
        return {
          id: item.id,
          color: item.color,
          ds: segStart,
          de: segEnd,
          midX,
          midY,
          name: rawLabel,
          metric: item.metric,
          valid: segStart - segEnd >= 0.5,
        };
      })
      .filter((s) => s.valid);
  }, [dailyBreakdown, sessions, gaugeMode]);

  const handleMainMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    didDrag.current = false;
    dragStart.current = { x: e.screenX, y: e.screenY };

    let rafId = 0;
    let latestX = e.screenX;
    let latestY = e.screenY;
    let dragStartedWithMain = false;

    const cleanup = () => {
      isDragging.current = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onBlur);
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = Math.abs(ev.screenX - dragStart.current.x);
      const dy = Math.abs(ev.screenY - dragStart.current.y);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        if (!didDrag.current) {
          didDrag.current = true;
          if (!dragStartedWithMain) {
            window.carapace?.dragStart(
              dragStart.current.x,
              dragStart.current.y,
            );
            dragStartedWithMain = true;
          }
        }
      }
      latestX = ev.screenX;
      latestY = ev.screenY;
      if (!rafId && dragStartedWithMain) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          window.carapace?.dragMove(latestX, latestY);
        });
      }
    };

    const onMouseUp = (ev: MouseEvent) => {
      const wasClick = !didDrag.current;
      const wasDragging = dragStartedWithMain;
      cleanup();
      if (wasDragging) {
        window.carapace?.dragMove(latestX, latestY);
        window.carapace?.dragEnd();
      }
      if (wasClick) {
        window.carapace?.createSession({ cmd: ev.metaKey, ctrl: ev.ctrlKey });
      }
    };

    // When the orb window loses focus (e.g. a new terminal opens after launching a preset),
    // the mouseup event never fires on this document. Clean up so the stale onMouseMove
    // listener can't fire dragStart on the next interaction.
    const onBlur = () => {
      if (dragStartedWithMain) window.carapace?.dragCancel();
      cleanup();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onBlur);
  }, []);

  const handlePillClick = useCallback(
    (e: React.MouseEvent, pid: number | undefined) => {
      e.stopPropagation();
      if (pid) {
        setAttentionPids((prev) => {
          const next = new Set(prev);
          next.delete(pid);
          return next;
        });
        window.carapace?.focusSession(pid);
      }
    },
    [],
  );

  const handlePillContextMenu = useCallback(
    (e: React.MouseEvent, pid: number | undefined) => {
      e.preventDefault();
      e.stopPropagation();
      if (pid) {
        window.carapace?.miniOrbContextMenu(pid);
      }
    },
    [],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    window.carapace?.showContextMenu();
  }, []);

  // Hit-test: only capture mouse events when cursor is over a visible element
  const lastIgnored = useRef(true);
  const handleHitTest = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging.current) return;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const PAD = 6;

      // Check main orb (circle hit test)
      const mainR = MAIN_ORB_SIZE / 2 + PAD;
      const dxMain = mx - CENTER_X;
      const dyMain = my - CENTER_Y;
      let over = dxMain * dxMain + dyMain * dyMain <= mainR * mainR;

      // Check pills (rectangle hit test)
      if (!over) {
        over = pills.some((pill) => {
          return (
            mx >= pill.x - PAD &&
            mx <= pill.x + PILL_MAX_WIDTH + PAD &&
            my >= pill.y - PAD &&
            my <= pill.y + PILL_HEIGHT + PAD
          );
        });
      }

      // Check budget gauge arc (left side of orb)
      if (!over && dailyTokenGoal > 0) {
        const dx = mx - CENTER_X;
        const dy = my - CENTER_Y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const inBand =
          dist >= GAUGE_R - GAUGE_SW / 2 - PAD &&
          dist <= GAUGE_R + GAUGE_SW / 2 + PAD;
        if (inBand && dx < 10) over = true;
      }

      // Check outer session-token gauge arc
      if (!over) {
        const dx = mx - CENTER_X;
        const dy = my - CENTER_Y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const inBand2 =
          dist >= GAUGE2_R - GAUGE2_SW / 2 - PAD &&
          dist <= GAUGE2_R + GAUGE2_SW / 2 + PAD;
        if (inBand2 && dx < 10) over = true;
      }

      // Check cycle button
      if (!over) {
        const dx = mx - CYCLE_BTN_X;
        const dy = my - CYCLE_BTN_Y;
        if (dx * dx + dy * dy <= (CYCLE_BTN_R + PAD) * (CYCLE_BTN_R + PAD)) over = true;
      }

      const shouldIgnore = !over;
      if (shouldIgnore !== lastIgnored.current) {
        lastIgnored.current = shouldIgnore;
        window.carapace?.setIgnoreMouseEvents(shouldIgnore);
      }
    },
    [pills, dailyTokenGoal],
  );

  return (
    <div
      className="w-full h-full relative"
      onContextMenu={handleContextMenu}
      onMouseMove={handleHitTest}
      onMouseEnter={() => window.carapace?.orbMouseEnter()}
      onMouseLeave={() => {
        window.carapace?.orbMouseLeave();
        if (!lastIgnored.current) {
          lastIgnored.current = true;
          window.carapace?.setIgnoreMouseEvents(true);
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
              height: PILL_HEIGHT,
              borderRadius: PILL_HEIGHT / 2,
              padding: "0 10px 0 4px",
              background: `${pill.color}cc`,
              boxShadow: pill.needsAttention
                ? `0 0 12px ${pill.rawColor}, 0 0 4px rgba(255,255,255,0.3)`
                : `0 2px 8px rgba(0,0,0,0.3), 0 0 6px ${pill.rawColor}30`,
              backdropFilter: "blur(8px)",
              gap: 6,
            }}
            initial={{ left: pill.x - 20, top: pill.y, opacity: 0 }}
            animate={{
              left: pill.x,
              top: pill.y,
              opacity: 1,
              scale: pill.needsAttention ? [1, 1.05, 1] : 1,
              zIndex: pill.id === hoveredPillId ? 10 : 1,
            }}
            exit={{ left: pill.x - 20, top: pill.y, opacity: 0 }}
            transition={
              pill.needsAttention
                ? {
                    scale: {
                      duration: 0.6,
                      repeat: Infinity,
                      ease: "easeInOut",
                    },
                    type: "spring",
                    stiffness: 400,
                    damping: 25,
                  }
                : { type: "spring", stiffness: 400, damping: 25 }
            }
            whileHover={{ scale: 1.12, x: 6 }}
            onHoverStart={() => setHoveredPillId(pill.id)}
            onHoverEnd={() =>
              setHoveredPillId((prev) => (prev === pill.id ? null : prev))
            }
            onClick={(e) => handlePillClick(e, pill.pid)}
            onContextMenu={(e) => handlePillContextMenu(e, pill.pid)}
          >
            {/* Colored dot */}
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: `linear-gradient(135deg, ${pill.rawColor}, ${pill.color})`,
                flexShrink: 0,
                boxShadow: `0 0 6px ${pill.rawColor}60`,
              }}
            />

            {/* Bell or name */}
            {pill.needsAttention ? (
              <span style={{ fontSize: 12, lineHeight: 1 }}>🔔</span>
            ) : (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: 1,
                  color: "#fff",
                  textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 200,
                }}
              >
                {pill.name}
              </span>
            )}

            {/* Context % */}
            {pill.contextPercent > 0 && !pill.needsAttention && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.5)",
                  marginLeft: 2,
                  flexShrink: 0,
                }}
              >
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
                  borderRadius: "50%",
                  border: "2px solid transparent",
                  borderTopColor: "#fff",
                  borderRightColor: "#fff",
                  flexShrink: 0,
                  marginLeft: 2,
                }}
              />
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Daily token gauge — left arc around orb, drains top→bottom as tokens are consumed */}
      {dailyTokenGoal > 0 &&
        (() => {
          const pct = Math.min(1, dailyTokens / dailyTokenGoal);
          // fillAngle: top endpoint of remaining fill. pct=0 → full arc; pct=1 → nothing.
          const fillAngle = GAUGE_END + pct * GAUGE_SPAN;
          const color = gaugeColor(pct);
          const pctLabel = Math.round(pct * 100);
          const title = `${dailyTokens.toLocaleString()} / ${dailyTokenGoal.toLocaleString()} tokens today (${pctLabel}% consumed)`;
          const hasFill = pct < 1;

          const showCounter = (orbHovered || gaugeHovered) && dailyTokens > 0;

          return (
            <svg
              className="absolute"
              style={{
                left: 0,
                top: 0,
                width: "100%",
                height: "100%",
                overflow: "visible",
              }}
            >
              <title>{title}</title>

              {/* Invisible wide hit area for hover detection */}
              <path
                d={gaugeArcPath(GAUGE_START, GAUGE_END)}
                fill="none"
                stroke="rgba(0,0,0,0)"
                strokeWidth={GAUGE_SW + 16}
                strokeLinecap="round"
                onMouseEnter={() => setGaugeHovered(true)}
                onMouseLeave={() => setGaugeHovered(false)}
              />

              {/* Track outline — visible on light backgrounds */}
              <path
                d={gaugeArcPath(GAUGE_START, GAUGE_END)}
                fill="none"
                stroke="rgba(140,155,180,0.22)"
                strokeWidth={GAUGE_SW + 2}
                strokeLinecap="round"
                style={{ pointerEvents: "none" }}
              />
              {/* Track */}
              <path
                d={gaugeArcPath(GAUGE_START, GAUGE_END)}
                fill="none"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth={GAUGE_SW}
                strokeLinecap="round"
                style={{
                  filter: gaugeHovered
                    ? "drop-shadow(0 0 7px rgba(210,220,240,0.55))"
                    : "none",
                  transition: "filter 0.2s ease",
                }}
              />

              {/* Fill — remaining budget, drains top→bottom */}
              {hasFill && (
                <path
                  d={gaugeArcPath(GAUGE_START, fillAngle)}
                  fill="none"
                  stroke={color}
                  strokeWidth={GAUGE_SW}
                  strokeLinecap="round"
                  style={{
                    filter: gaugeHovered
                      ? `drop-shadow(0 0 3px ${color}88) drop-shadow(0 0 10px ${color}77)`
                      : `drop-shadow(0 0 3px ${color}88)`,
                    transition: "filter 0.2s ease",
                  }}
                />
              )}
            </svg>
          );
        })()}

      {/* Session-token gauge — outer arc, colored segments per session by totalTokens */}
      <svg
        className="absolute"
        style={{ left: 0, top: 0, width: "100%", height: "100%", overflow: "visible" }}
      >
        {/* Track outline — visible on light backgrounds */}
        <path
          d={gauge2ArcPath(GAUGE2_START, GAUGE2_END)}
          fill="none"
          stroke="rgba(140,155,180,0.22)"
          strokeWidth={GAUGE2_SW + 2}
          strokeLinecap="round"
          style={{ pointerEvents: "none" }}
        />
        {/* Track */}
        <path
          d={gauge2ArcPath(GAUGE2_START, GAUGE2_END)}
          fill="none"
          stroke="rgba(255,255,255,0.20)"
          strokeWidth={GAUGE2_SW}
          strokeLinecap="round"
          style={{ pointerEvents: "none" }}
        />

        {/* Gauge segments */}
        {gaugeSegments.map((seg) => (
          <g key={seg.id}>
            {/* Invisible wide hit target */}
            <path
              d={gauge2ArcPath(seg.ds, seg.de)}
              fill="none"
              stroke="transparent"
              strokeWidth={GAUGE2_SW + 14}
              strokeLinecap="butt"
              style={{ cursor: "default" }}
              onMouseEnter={() => setHoveredSegmentId(seg.id)}
              onMouseLeave={() => setHoveredSegmentId(null)}
            />
            {/* Colored segment */}
            <path
              d={gauge2ArcPath(seg.ds, seg.de)}
              fill="none"
              stroke={seg.color}
              strokeWidth={GAUGE2_SW}
              strokeLinecap="butt"
              style={{
                pointerEvents: "none",
                filter:
                  hoveredSegmentId === seg.id
                    ? `drop-shadow(0 0 5px ${seg.color}bb) drop-shadow(0 0 10px ${seg.color}77)`
                    : `drop-shadow(0 0 3px ${seg.color}55)`,
                opacity: hoveredSegmentId && hoveredSegmentId !== seg.id ? 0.4 : 1,
                transition: "filter 0.15s ease, opacity 0.15s ease",
              }}
            />
          </g>
        ))}

        {/* Rounded caps at the two outer arc endpoints — painted over butt segment ends */}
        {gaugeSegments.length > 0 && (() => {
          const first = gaugeSegments[0];
          const last = gaugeSegments[gaugeSegments.length - 1];
          const [sx, sy] = gauge2Point(GAUGE2_START);
          const [ex, ey] = gauge2Point(GAUGE2_END);
          return (
            <>
              <circle cx={sx} cy={sy} r={GAUGE2_SW / 2} fill={first.color}
                style={{ pointerEvents: "none",
                  filter: hoveredSegmentId === first.id
                    ? `drop-shadow(0 0 5px ${first.color}bb)`
                    : `drop-shadow(0 0 3px ${first.color}55)`,
                  opacity: hoveredSegmentId && hoveredSegmentId !== first.id ? 0.4 : 1,
                  transition: "filter 0.15s ease, opacity 0.15s ease" }} />
              <circle cx={ex} cy={ey} r={GAUGE2_SW / 2} fill={last.color}
                style={{ pointerEvents: "none",
                  filter: hoveredSegmentId === last.id
                    ? `drop-shadow(0 0 5px ${last.color}bb)`
                    : `drop-shadow(0 0 3px ${last.color}55)`,
                  opacity: hoveredSegmentId && hoveredSegmentId !== last.id ? 0.4 : 1,
                  transition: "filter 0.15s ease, opacity 0.15s ease" }} />
            </>
          );
        })()}
      </svg>

      {/* Tooltip for hovered gauge segment */}
      <AnimatePresence>
        {hoveredSegmentId &&
          (() => {
            const seg = gaugeSegments.find((s) => s.id === hoveredSegmentId);
            if (!seg) return null;
            // Anchor to the left wall — never let it touch the gauge arcs
            const tipTop = Math.max(4, Math.min(seg.midY - 22, 280));
            return (
              <motion.div
                key="seg-tooltip"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.1 }}
                style={{
                  position: "absolute",
                  left: 4,
                  top: tipTop,
                  background: "rgba(0,0,0,0.82)",
                  backdropFilter: "blur(8px)",
                  borderRadius: 6,
                  padding: "4px 8px",
                  pointerEvents: "none",
                  border: `1px solid ${seg.color}50`,
                  minWidth: 72,
                  maxWidth: TOOLTIP_MAX_W,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#fff",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {seg.name}
                </div>
                <div style={{ fontSize: 12, fontWeight: 500, color: "#fff", opacity: 0.75, whiteSpace: "nowrap" }}>
                  {seg.metric}
                </div>
              </motion.div>
            );
          })()}
      </AnimatePresence>

      {/* Cycle button — shows current mode icon, cycles on click */}
      <motion.div
        style={{
          position: "absolute",
          left: CYCLE_BTN_X - CYCLE_BTN_R,
          top: CYCLE_BTN_Y - CYCLE_BTN_R,
          width: CYCLE_BTN_R * 2,
          height: CYCLE_BTN_R * 2,
          borderRadius: "50%",
          background: "rgba(30,30,50,0.75)",
          border: "1.5px solid rgba(255,255,255,0.40)",
          boxShadow: "0 0 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(4px)",
          overflow: "hidden",
        }}
        whileHover={{
          background: "rgba(80,80,120,0.85)",
          borderColor: "rgba(255,255,255,0.70)",
          boxShadow: "0 0 14px rgba(124,58,237,0.45), 0 0 6px rgba(255,255,255,0.2)",
        }}
        whileTap={{ scale: 0.88 }}
        transition={{ duration: 0.12 }}
        onClick={() => setGaugeMode((m) => ((m + 1) % 4) as 0 | 1 | 2 | 3)}
        onMouseEnter={() => setCycleBtnHovered(true)}
        onMouseLeave={() => setCycleBtnHovered(false)}
      >
        {GAUGE_MODE_ICONS[gaugeMode]}
      </motion.div>

      {/* Mode tooltip — floats below the cycle button on hover */}
      <AnimatePresence>
        {cycleBtnHovered && (
          <motion.div
            key="mode-tooltip"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            style={{
              position: "absolute",
              left: CYCLE_BTN_X - 50,
              top: CYCLE_BTN_Y + CYCLE_BTN_R + 5,
              background: "rgba(0,0,0,0.82)",
              backdropFilter: "blur(8px)",
              borderRadius: 6,
              padding: "4px 8px",
              pointerEvents: "none",
              whiteSpace: "nowrap",
              fontSize: 11,
              fontWeight: 500,
              color: "rgba(255,255,255,0.9)",
              border: "1px solid rgba(255,255,255,0.15)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}
          >
            {GAUGE_MODE_LABELS[gaugeMode]}
          </motion.div>
        )}
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
            background:
              "radial-gradient(circle, rgba(124,58,237,0.35) 0%, transparent 70%)",
          }}
          animate={{
            scale: [1, 1.4, 1],
            opacity: [0.5, 0, 0.5],
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: "easeInOut",
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
          background: "linear-gradient(135deg, #7C3AED, #2563EB)",
          boxShadow:
            count > 0
              ? "0 0 28px rgba(124, 58, 237, 0.5), 0 4px 20px rgba(0,0,0,0.4)"
              : "0 4px 20px rgba(0,0,0,0.4)",
        }}
        whileHover={{
          boxShadow:
            "0 0 40px rgba(124, 58, 237, 0.7), 0 0 20px rgba(37, 99, 235, 0.5), 0 4px 20px rgba(0,0,0,0.4)",
        }}
        transition={{ duration: 0.2 }}
        onHoverStart={() => setOrbHovered(true)}
        onHoverEnd={() => setOrbHovered(false)}
        onMouseDown={handleMainMouseDown}
      >
        {/* Highlight */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.2) 0%, transparent 60%)",
          }}
        />

        {/* Active session count */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="text-white font-bold text-[26px] leading-none
                           drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]"
          >
            {count}
          </span>
        </div>
      </motion.div>

      {/* Token counter — below the orb, slides up on hover */}
      <AnimatePresence>
        {(orbHovered || gaugeHovered) &&
          dailyTokenGoal > 0 &&
          dailyTokens > 0 &&
          (() => {
            const pct = Math.min(1, dailyTokens / dailyTokenGoal);
            const color = gaugeColor(pct);
            return (
              <motion.div
                key="token-counter"
                initial={{ y: -6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -6, opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                style={{
                  position: "absolute",
                  left: CENTER_X - 38,
                  top: CENTER_Y + MAIN_ORB_SIZE / 2 + 8,
                  pointerEvents: "none",
                  background: "rgba(0,0,0,0.78)",
                  backdropFilter: "blur(8px)",
                  borderRadius: 8,
                  padding: "4px 10px",
                  lineHeight: 1.3,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color,
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatTokenCount(dailyTokens)}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.45)",
                    whiteSpace: "nowrap",
                  }}
                >
                  / {formatTokenCount(dailyTokenGoal)}
                </div>
              </motion.div>
            );
          })()}
      </AnimatePresence>
    </div>
  );
}
