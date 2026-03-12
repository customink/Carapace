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
│   ├── prompt.ts (options dialog)                      │       ├── SessionCard.tsx
│   ├── drawer-base.ts (shared drawer logic)            │       └── ContextBar.tsx
│   ├── notes.ts                                        ├── hooks/useSessions.ts
│   ├── skills.ts                                       ├── terminal-main.ts (xterm.js)
│   ├── skill-browser.ts                                └── styles/globals.css
│   ├── file-tree.ts
│   ├── prompt-history.ts
│   ├── image-gallery.ts
│   ├── model-selector.ts
│   ├── snippet-dialog.ts
│   └── slack-compose.ts
├── services/
│   ├── pty-manager.ts
│   ├── session-spawner.ts
│   ├── session-discovery.ts
│   ├── session-history.ts
│   ├── process-detector.ts
│   ├── session-monitor.ts
│   ├── terminal-focus.ts
│   ├── cost-calculator.ts
│   ├── context-tracker.ts
│   ├── jsonl-parser.ts
│   ├── settings-reader.ts
│   ├── usage-fetcher.ts
│   ├── snippet-store.ts
│   ├── prompt-history.ts
│   └── app-settings-store.ts
├── ipc/
│   ├── channels.ts
│   └── handlers.ts
└── shared/ (types + constants, used by all contexts)
    ├── types/session.ts, snippet.ts
    ├── constants/colors.ts, pricing.ts, paths.ts, snippet-icons.ts
    └── utils/format.ts
```

## Key Concepts

### Windows
- **Orb** (210x210, transparent, always-on-top): Floating circle showing session count. Mini-orbs orbit it, one per active session. Click to toggle panel, right-click for context menu, click mini-orb to focus that terminal. Uses `setIgnoreMouseEvents(true, { forward: true })` for click-through transparency — only the visible orb and mini-orb circles capture clicks; surrounding transparent area passes through. Hit-testing is done in `FloatingOrb.tsx` via circular distance checks on `mousemove`.
- **Panel** (380x650, vibrancy popover): Shows session list with metrics. Auto-hides on blur.
- **Terminal** (900x600, resizable): BrowserWindow with xterm.js + node-pty. Each session gets its own window with a colored titlebar/background tint.
- **Prompt** (420x340, frameless): Session options dialog (title, folder, color, skip-permissions).
- **Drawer windows**: Sidebar tools (notes, skills, file tree, image gallery, etc.) use a shared `drawer-base.ts` that creates child BrowserWindows anchored to the parent terminal. Each drawer uses `createDrawerWindow()` for consistent styling and cleanup.

### Session Lifecycle
1. User creates session via orb click/context menu
2. `spawnClaudeSession()` → creates terminal window + PTY
3. PTY spawns login shell (`zsh -l -i`), then `exec claude` after 500ms
4. Data flows: xterm.js ↔ IPC ↔ node-pty ↔ Claude CLI
5. Session discovery (`ps aux` + `lsof`) detects Claude processes
6. JSONL transcripts in `~/.claude/projects/` are parsed for metrics
7. `chokidar` watches JSONL files → pushes updates to all windows
8. Window close → all PTYs killed (Claude + shell tabs) → dock visibility updated

### Multi-Shell Tabs
Terminal windows support multiple shell tabs alongside the Claude tab:
- Tabs are created dynamically via `terminal:create-shell-tab` IPC → creates a new PTY via `pty-manager.createShellPty()`
- Each shell tab has a unique `shellPtyId`; all shell IPC includes this ID for routing
- Data routing: `terminal:shell-data` and `terminal:shell-exit` include `(shellPtyId, data)` — renderer routes to correct xterm instance
- Tab names and count persist in `SessionHistoryEntry.shellTabNames` and are passed to the terminal window via URL params for reliable restoration on revive
- Right-click tab titles for inline rename (contentEditable); Enter saves, Escape cancels
- Renderer manages all shell tab state in `terminal-main.ts` (ShellTab interface with terminal, fitAddon, paneEl, tabEl)

### Attention Bell
When Claude finishes responding in an unfocused terminal:
- Bell arms when user sends input to PTY
- Bell fires ONLY on JSONL `stop_reason: "end_turn"` (completion count increase in `handlers.ts`)
- Does NOT fire on `stop_reason: "tool_use"` — instead re-arms the thinking spinner
- Mini-orb shows pulsing bell emoji
- Cleared when user focuses the terminal window
- Won't re-ring until user sends new input and Claude responds again

### Sidebar
- Buttons are reorderable via drag-and-drop; order persisted in `~/.claude/usage-data/carapace-sidebar-order.json`
- Right-click sidebar background → native checkbox menu to toggle icon visibility
- Settings format: `{ order: string[] | null, hidden: string[] }`
- Sidebar IPC: `sidebar:get-settings`, `sidebar:save-order`, `sidebar:save-hidden`, `sidebar:visibility-menu`, `sidebar:visibility-changed`

### Color System
8-color palette in `shared/constants/colors.ts`. Colors are assigned at spawn time and stored in the PTY manager. Session discovery checks PTY manager first for embedded session colors, falls back to hash-based assignment for external sessions. FloatingOrb reads `session.color` directly.

### IPC Channels
Defined in `ipc/channels.ts`. Key patterns:
- `invoke` for request/response (sessions:list, credentials:get, terminal:create-shell-tab, etc.)
- `send` for fire-and-forget (panel:toggle, session:create, terminal:shell-input, etc.)
- `webContents.send` for push from main → renderer (sessions:updated, session:attention, terminal:shell-data)
- Shell tab IPC always includes `shellPtyId` as first arg for routing

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
- `~/.claude/usage-data/carapace-session-history.json` — session revival data (title, folder, color, label, shellTabNames)
- `~/.claude/usage-data/carapace-sidebar-order.json` — sidebar button order + hidden state
- `~/.claude/usage-data/carapace-images/` — global image gallery (order.json + image files)
- `https://api.claude.ai/api/usage` — rate limit usage (cached 3min)

## Common Tasks

**Add a new IPC channel**: Define in `ipc/channels.ts`, handle in `ipc/handlers.ts` or `session-spawner.ts`, expose in preload, consume in renderer.

**Add a new window**: Create factory in `windows/`, add preload if needed, add renderer entry in `electron.vite.config.ts`.

**Add a new drawer/sidebar tool**: Use `drawer-base.ts` (`createDrawerWindow`, `loadDrawerHtml`). Add toggle IPC in `session-spawner.ts`, button in `terminal.html`, state + handler in `terminal-main.ts`, preload method in `terminal.ts`.

**Modify session metrics**: Parser is in `jsonl-parser.ts`, cost in `cost-calculator.ts`, types in `shared/types/session.ts`.

**Change orb appearance**: `FloatingOrb.tsx` for layout/behavior, `globals.css` for base styles. Orb hit-testing for click-through is in the `handleHitTest` callback.

## Workflow

**After every code change**, kill existing instances, rebuild, and restart the app so the user can test it:
```bash
pkill -f "electron out/main/index.js" 2>/dev/null; npm run build && npx electron out/main/index.js
```
