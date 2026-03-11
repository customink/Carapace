# Carapace

Visual menu-bar app for managing Claude Code sessions. Built with Electron + React + xterm.js.

## Quick Start

```bash
npm install          # also runs electron-rebuild for node-pty
npm run dev          # dev mode with hot reload
npm run build        # production build to /out
npx electron out/main/index.js  # run production build
```

## Architecture

Three Electron contexts connected via IPC:

```
Main Process (Node.js)          Preload (bridge)        Renderer (React)
├── index.ts (app entry)        ├── index.ts            ├── App.tsx (router)
├── windows/                    └── terminal.ts         ├── components/
│   ├── orb.ts (floating orb)                           │   ├── orb/FloatingOrb.tsx
│   ├── panel.ts (session list)                         │   └── sessions/
│   ├── terminal.ts (per-session)                       │       ├── SessionList.tsx
│   └── prompt.ts (options dialog)                      │       ├── SessionCard.tsx
├── services/                                           │       └── ContextBar.tsx
│   ├── pty-manager.ts                                  ├── hooks/useSessions.ts
│   ├── session-spawner.ts                              ├── terminal-main.ts (xterm.js)
│   ├── session-discovery.ts                            └── styles/globals.css
│   ├── process-detector.ts
│   ├── session-monitor.ts
│   ├── terminal-focus.ts
│   ├── cost-calculator.ts
│   ├── context-tracker.ts
│   ├── jsonl-parser.ts
│   ├── settings-reader.ts
│   └── usage-fetcher.ts
├── ipc/
│   ├── channels.ts
│   └── handlers.ts
└── shared/ (types + constants, used by all contexts)
    ├── types/session.ts
    ├── constants/colors.ts, pricing.ts, paths.ts
    └── utils/format.ts
```

## Key Concepts

### Windows
- **Orb** (160x160, transparent, always-on-top): Floating circle showing session count. Mini-orbs orbit it, one per active session. Click to toggle panel, right-click for context menu, click mini-orb to focus that terminal.
- **Panel** (380x650, vibrancy popover): Shows session list with metrics. Auto-hides on blur.
- **Terminal** (900x600, resizable): BrowserWindow with xterm.js + node-pty. Each session gets its own window with a colored titlebar/background tint.
- **Prompt** (420x340, frameless): Session options dialog (title, folder, color, skip-permissions).

### Session Lifecycle
1. User creates session via orb click/context menu
2. `spawnClaudeSession()` → creates terminal window + PTY
3. PTY spawns login shell (`zsh -l -i`), then `exec claude` after 500ms
4. Data flows: xterm.js ↔ IPC ↔ node-pty ↔ Claude CLI
5. Session discovery (`ps aux` + `lsof`) detects Claude processes
6. JSONL transcripts in `~/.claude/projects/` are parsed for metrics
7. `chokidar` watches JSONL files → pushes updates to all windows
8. Window close → PTY killed → dock visibility updated

### Attention Bell
When Claude finishes responding in an unfocused terminal:
- Bell arms when user sends input to PTY
- After output stops for 3s (and window not focused), plays Glass.aiff once
- Mini-orb shows pulsing bell emoji
- Cleared when user focuses the terminal window
- Won't re-ring until user sends new input and Claude responds again

### Color System
8-color palette in `shared/constants/colors.ts`. Colors are assigned at spawn time and stored in the PTY manager. Session discovery checks PTY manager first for embedded session colors, falls back to hash-based assignment for external sessions. FloatingOrb reads `session.color` directly.

### IPC Channels
Defined in `ipc/channels.ts`. Key patterns:
- `invoke` for request/response (sessions:list, credentials:get, etc.)
- `send` for fire-and-forget (panel:toggle, session:create, etc.)
- `webContents.send` for push from main → renderer (sessions:updated, session:attention, terminal:data)

## Build Config (electron.vite.config.ts)
- **MPA mode** (`appType: 'mpa'`) — two HTML entry points: index.html (orb/panel) + terminal.html
- **Two preloads**: index.ts (main UI API) + terminal.ts (terminal-specific API)
- **Externalized native modules**: `node-pty`, `chokidar` (not bundled, loaded at runtime)
- **Path alias**: `@shared` → `src/shared`

## External Data
- `~/.claude/.credentials.json` — API auth token
- `~/.claude/settings.json` — allowed tools, plugins
- `~/.claude/projects/` — JSONL session transcripts (watched by chokidar)
- `~/.claude/usage-data/session-meta/` — historical session metadata
- `https://api.claude.ai/api/usage` — rate limit usage (cached 3min)

## Common Tasks

**Add a new IPC channel**: Define in `ipc/channels.ts`, handle in `ipc/handlers.ts` or `index.ts`, expose in preload, consume in renderer.

**Add a new window**: Create factory in `windows/`, add preload if needed, add renderer entry in `electron.vite.config.ts`.

**Modify session metrics**: Parser is in `jsonl-parser.ts`, cost in `cost-calculator.ts`, types in `shared/types/session.ts`.

**Change orb appearance**: `FloatingOrb.tsx` for layout/behavior, `globals.css` for base styles.

## Workflow

**After every code change**, kill existing instances, rebuild, and restart the app so the user can test it:
```bash
pkill -f "electron out/main/index.js" 2>/dev/null; npm run build && npx electron out/main/index.js
```
