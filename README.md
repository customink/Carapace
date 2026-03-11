# Carapace

Visual menu-bar app for managing Claude Code sessions. Built with Electron + React + xterm.js.

![macOS](https://img.shields.io/badge/platform-macOS-lightgrey)

## Features

- **Floating Orb** — Always-on-top widget showing active session count with orbiting mini-orbs per session
- **Session Management** — Spawn, focus, arrange, and revive Claude Code sessions
- **Terminal Windows** — Full xterm.js terminals with colored theming per session
- **Sidebar Tools** — Notes, slash commands, skill browser, folder picker, and custom quick snippets
- **Attention Bell** — Configurable chime when Claude finishes responding in an unfocused terminal
- **Session Metrics** — Live cost, tokens, context %, and duration tracking via JSONL parsing
- **Settings** — Configurable chime sound/volume, session history management

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
│   ├── snippet-dialog.ts                               │       └── ContextBar.tsx
│   └── settings.ts                                     ├── hooks/useSessions.ts
├── services/                                           ├── terminal-main.ts (xterm.js)
│   ├── pty-manager.ts                                  └── styles/globals.css
│   ├── session-spawner.ts
│   ├── session-discovery.ts
│   ├── process-detector.ts
│   ├── session-monitor.ts
│   ├── terminal-focus.ts
│   ├── cost-calculator.ts
│   ├── context-tracker.ts
│   ├── jsonl-parser.ts
│   ├── settings-reader.ts
│   ├── usage-fetcher.ts
│   ├── snippet-store.ts
│   └── app-settings-store.ts
├── ipc/
│   ├── channels.ts
│   └── handlers.ts
└── shared/
    ├── types/session.ts, snippet.ts
    ├── constants/colors.ts, pricing.ts, paths.ts, snippet-icons.ts
    └── utils/format.ts
```

## License

MIT
