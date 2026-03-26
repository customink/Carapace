# Carapace

Visual menu-bar app for managing Claude Code sessions. Built with Electron + React + xterm.js.

## Quick Start

```bash
npm install          # also runs electron-rebuild for node-pty
npm run dev          # dev mode with hot reload
npm run build        # production build to /out
npx electron out/main/index.js  # run production build
npm run dist         # build .dmg + .zip installer (electron-builder)
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
│   ├── preset-dialog.ts
│   ├── schedule-dialog.ts
│   ├── settings.ts
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
│   ├── preset-store.ts
│   ├── schedule-store.ts
│   ├── scheduler.ts
│   ├── icon-generator.ts
│   ├── prompt-history.ts
│   └── app-settings-store.ts
├── ipc/
│   ├── channels.ts
│   └── handlers.ts
└── shared/ (types + constants, used by all contexts)
    ├── types/session.ts, snippet.ts, preset.ts, scheduled-prompt.ts
    ├── constants/colors.ts, pricing.ts, paths.ts, snippet-icons.ts
    └── utils/format.ts
```

## Key Concepts

### Windows
- **Orb** (450x380, transparent, always-on-top): Floating orb showing session count. Session pills arc around it showing full names. Orb center at (70, 140). Click to create session (configurable), right-click for context menu. Uses `setIgnoreMouseEvents(true, { forward: true })` for click-through transparency. Hit-testing in `FloatingOrb.tsx` via circular (orb) + rectangular (pills) checks on `mousemove`.
- **Panel** (380x650, vibrancy popover): Shows session list with metrics. Auto-hides on blur.
- **Terminal** (900x600, resizable): BrowserWindow with xterm.js + node-pty. Each session gets its own window with a colored titlebar/background tint. Starts with `show: false` in constructor; shown via `ready-to-show` event (or kept hidden for scheduled/background sessions).
- **Prompt** (420x340, frameless): Session options dialog (title, folder, color, skip-permissions).
- **Drawer windows**: Sidebar tools use shared `drawer-base.ts` that creates child BrowserWindows anchored to the parent terminal.

### Session Pills (FloatingOrb.tsx)
- Replaced mini-orbs with horizontal pills showing full session names
- Arc around the right side of the orb, spreading ±spreadAngle from 3 o'clock
- Hover pushes neighbors apart (distance-based: `10 / distance` degrees)
- Newest sessions at top (descending sort)
- Each pill shows: colored dot + name + context% + thinking spinner
- Right-click for context menu: Rename, Set Emoji, Change Color, Save as Preset, Close

### Session Lifecycle
1. User creates session via orb click/context menu
2. `spawnClaudeSession()` → creates terminal window + PTY, returns `{ ptyId, win }`
3. PTY spawns login shell (`zsh -l -i`), then `exec claude [--resume sessionId] [--dangerously-skip-permissions]` after 500ms
4. Data flows: xterm.js ↔ IPC ↔ node-pty ↔ Claude CLI
5. Session discovery (`ps aux` + `lsof`) detects Claude processes
6. JSONL transcripts in `~/.claude/projects/` are parsed for metrics
7. `chokidar` watches JSONL files → pushes updates to all windows
8. JSONL watcher captures `claudeSessionId` from filename → saved to history immediately
9. Window close → `destroyPty()` saves session data to history → PTYs killed → dock visibility updated

### Conversation Persistence
- Claude Code session ID captured from JSONL filename by the session monitor in `handlers.ts`
- Saved to `SessionHistoryEntry.claudeSessionId` on TWO paths:
  1. Immediately when first detected (in JSONL watcher) — survives crashes
  2. In `destroyPty()` before session removal — covers all close paths
- On revival: `claude --resume <sessionId>` restores full conversation context
- Works regardless of how session was closed (window X, context menu, Close All, quit)

### Thinking Spinner & Bell System
The spinner/bell went through extensive debugging. Key design decisions:

**Spinner (isThinking)**:
- Arms on Enter press AFTER 8s startup grace period (prevents trust dialog trigger)
- Idle timer (15s) starts immediately on Enter — purely time-based, NOT reset by PTY output
  - Claude Code's status line contains real text that's indistinguishable from response text
  - Any PTY-output-based reset defeats the timer → spinner gets stuck forever
- Max timer (5 min) as absolute safety net, reset by JSONL `tool_use`
- `rearmThinking()` only acts if `bellArmed || isThinking` — prevents old JSONL files from arming idle sessions
- JSONL `end_turn` clears instantly; `tool_use` resets both timers
- Fast 5s polling when any session is thinking (catches missed JSONL events)

**Bell (needsAttention)**:
- Arms on Enter after startup grace period
- Fires on JSONL `end_turn` completion count increase
- Only fires if window is NOT focused
- 30s fallback polling catches missed JSONL events

### Multi-Shell Tabs
- Tab bar always visible (not hidden when no shell tabs)
- Tabs labeled "Tab 1", "Tab 2" etc. (not "Shell")
- Right-click tab titles for inline rename
- Tab names persist across session revival

### Orb Click Actions (Configurable)
Settings → "Orb Click Action" with three rows:
- **Click**: default New Session
- **Cmd+Click**: default New Session (Skip Permissions)
- **Ctrl+Click**: default Bring All Terminals to Front

Options: New Session, New Session (Skip Permissions), Focus Most Recent, Bring All to Front, Launch Preset

### Scheduled Prompts
- `schedule-store.ts`: JSON CRUD at `~/.claude/usage-data/carapace-schedules.json`
- `scheduler.ts`: 60s interval checks, fires once per day per schedule
- When fired:
  1. Terminal spawns with `background: true` (hidden window)
  2. PTY data interceptor watches for trust dialog ("safety check", "trust") → auto-presses Enter
  3. Waits for `Cost:` in PTY output as Claude-ready signal (NOT fixed delay)
  4. Injects prompt via `writeToPty()`
  5. Sets `scheduledBringToFront` flag → window shown on first `end_turn`
- **Critical timing**: interceptor must wait for PTY to be created (async `did-finish-load`). Uses polling every 500ms until `getByPtyId()` returns the session.
- Debug logging to `/tmp/carapace-scheduler.log`

### Dynamic Dock Icon
- `icon-generator.ts`: generates colored orb NativeImages (PNG via raw CRC32+zlib)
- Dock icon changes to match focused terminal's color
- `app.dock.show()` is monkey-patched to call `resetDockIcon()` after every show
- Dock menu (right-click) shows all terminals with colored orb icons
- `app.name = 'Carapace'` set before app ready (dock tooltip shows "Carapace" in packaged app; shows "Electron" when running from source)

### File Tree
- Click a file → inserts path into terminal prompt (auto-quoted if spaces)
- Click a folder → toggles open/close
- → button on every row (visible on hover) → inserts path
- Mousedown stores path via `filetree:drag-set` IPC for cross-window transfer
- Terminal `focus` event queries pending drag path and inserts it
- HTML5 `dragstart` sets `text/plain` data (no `preventDefault`!) + native `startDrag`
- Show hidden files toggle persisted to `~/.claude/usage-data/carapace-filetree-settings.json`

### Terminal Prompt Toolbar
- Floating toolbar at bottom-right of terminal (40% opacity, full on hover)
- Copy button: copies current input buffer to clipboard via `terminal:get-input-buffer`
- Clear button: sends Ctrl+C to cancel entire multi-line prompt
- Cmd+Backspace keyboard shortcut: sends Ctrl+U to delete line

### Sidebar
- Buttons are reorderable via drag-and-drop; order persisted in `~/.claude/usage-data/carapace-sidebar-order.json`
- Right-click sidebar background → native checkbox menu to toggle icon visibility
- Includes: notes, skills, skillbrowser, filetree, model, github, prompthistory, imagegallery, openfolder, savepreset, slack
- "Save as Preset" button in sidebar opens preset dialog pre-filled with current session config

### Color System
8-color palette in `shared/constants/colors.ts`. Colors are assigned at spawn time and stored in the PTY manager.

### IPC Channels
Defined in `ipc/channels.ts`. Key patterns:
- `invoke` for request/response
- `send` for fire-and-forget
- `webContents.send` for push from main → renderer
- Shell tab IPC always includes `shellPtyId` as first arg for routing

## Packaging & Distribution

- `electron-builder` configured in `package.json` → `build` section
- `npm run dist` produces `.dmg` + `.zip` in `dist/`
- Ad-hoc code signing (`identity: "-"`) → macOS shows "unidentified developer" (right-click → Open to bypass) instead of "damaged"
- App icon generated by `scripts/generate-icon.mjs` (procedural orb PNG → .icns via `iconutil`)
- "Check for Updates" in orb context menu fetches GitHub releases API, compares versions
- GitHub releases at `customink/Carapace` — latest is v0.6.0
- `scripts/fix-gatekeeper.sh` helper for `xattr -cr`

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
- `~/.claude/usage-data/carapace-session-history.json` — session revival data (title, folder, color, label, shellTabNames, claudeSessionId)
- `~/.claude/usage-data/carapace-sidebar-order.json` — sidebar button order + hidden state
- `~/.claude/usage-data/carapace-images/` — global image gallery (order.json + image files)
- `~/.claude/usage-data/carapace-presets.json` — saved session presets
- `~/.claude/usage-data/carapace-schedules.json` — scheduled prompts
- `~/.claude/usage-data/carapace-filetree-settings.json` — file tree show hidden toggle
- `~/.claude/carapace/app-settings.json` — app settings (chime, orb click actions)
- `https://api.claude.ai/api/usage` — rate limit usage (cached 3min)

## OpsLevel Integration
- Service registered as `carapace` in OpsLevel: https://app.opslevel.com/components/carapace
- Owner: Accounts team
- `.customink/catalog.yaml` — service catalog entry (name, tier, tags)
- `.github/CODEOWNERS` — @customink/accounts
- `.github/workflows/stale.yml` — stale issues/PRs workflow
- Current maturity: working toward Bronze
- Remaining manual checks: branch protection, issue tracking tool, service purpose property
- API token is read-only — mutations must be done via OpsLevel UI

## Common Tasks

**Add a new IPC channel**: Define in `ipc/channels.ts`, handle in `ipc/handlers.ts` or `session-spawner.ts`, expose in preload, consume in renderer.

**Add a new window**: Create factory in `windows/`, add preload if needed, add renderer entry in `electron.vite.config.ts`.

**Add a new drawer/sidebar tool**: Use `drawer-base.ts` (`createDrawerWindow`, `loadDrawerHtml`). Add toggle IPC in `session-spawner.ts`, button in `terminal.html`, state + handler in `terminal-main.ts`, preload method in `terminal.ts`.

**Modify session metrics**: Parser is in `jsonl-parser.ts`, cost in `cost-calculator.ts`, types in `shared/types/session.ts`.

**Change orb appearance**: `FloatingOrb.tsx` for layout/behavior, `globals.css` for base styles. Orb hit-testing for click-through is in the `handleHitTest` callback. Orb window size/position in `orb.ts`.

**Create a release**: `npm run dist` builds .dmg/.zip, then `gh release create vX.Y.Z dist/Carapace-*.dmg dist/Carapace-*.zip`

## Workflow

**After every code change**, kill existing instances, rebuild, and restart the app so the user can test it:
```bash
pkill -f "electron out/main/index.js" 2>/dev/null; npm run build && npx electron out/main/index.js
```

**For background running** (survives terminal close):
```bash
nohup npx electron out/main/index.js > /dev/null 2>&1 &
```

## Known Issues & Gotchas

- **Dock tooltip shows "Electron" when running from source** — this is a macOS limitation. The packaged .app shows "Carapace" correctly.
- **Native drag between Electron BrowserWindows is unreliable on macOS** — file tree uses click-to-insert and IPC-based drag as workarounds instead of `startDrag`.
- **`require()` in bundled code** — never use inline `require('./relative-path')` in pty-manager or other bundled files. The relative path resolves differently after bundling. Always use static `import` at the top.
- **PTY creation is async** — `createPty` is called inside `did-finish-load` callback. Any code that needs the PTY (like scheduler interceptors) must poll `getByPtyId()` until it exists.
- **Trust dialog detection** — Claude Code shows a numbered menu ("1. Yes, I trust this folder"). Must strip ANSI escapes and match on "safety check" / "trust" / "enter to confirm". Write Enter directly to `session.pty.write('\r')`, not through `writeToPty()`.
