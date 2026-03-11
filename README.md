# Carapace

Visual menu-bar app for managing Claude Code sessions. Built with Electron + React + xterm.js.

![macOS](https://img.shields.io/badge/platform-macOS-lightgrey)

## Features

- **Floating Orb** — Always-on-top widget showing active session count with orbiting mini-orbs per session
- **Session Management** — Spawn, focus, arrange, and revive Claude Code sessions
- **Terminal Windows** — Full xterm.js terminals with colored theming per session
- **Dynamic Titles** — Window titles show session name, model, and effort level
- **Sidebar Tools** — Notes, slash commands, skill browser, model selector, folder picker, Slack sharing, and custom quick snippets
- **Mini-Orb Customization** — Right-click mini-orbs to set custom letters, emojis, or colors
- **Model Selector** — Drawer panel to switch Claude models by pasting `/model` commands
- **Slack Integration** — Share the last Claude response to Slack with one click
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

## Dependencies

### Runtime

| Package | Description |
|---------|-------------|
| [electron](https://www.electronjs.org/) | Desktop app framework (Chromium + Node.js) |
| [node-pty](https://github.com/nickvdp/node-pty) | Native pseudoterminal bindings for spawning shell/CLI processes |
| [@xterm/xterm](https://xtermjs.org/) | Terminal emulator UI component |
| [@xterm/addon-fit](https://www.npmjs.com/package/@xterm/addon-fit) | Auto-fit terminal to container dimensions |
| [@xterm/addon-web-links](https://www.npmjs.com/package/@xterm/addon-web-links) | Clickable URL detection in terminal output |
| [react](https://react.dev/) | UI component library |
| [react-dom](https://react.dev/) | React DOM renderer |
| [framer-motion](https://www.framer.com/motion/) | Animation library for orb/mini-orb transitions |
| [chokidar](https://github.com/paulmillr/chokidar) | File system watcher for JSONL transcript changes |
| [date-fns](https://date-fns.org/) | Date utility functions |
| [zustand](https://zustand-demo.pmnd.rs/) | Lightweight state management |

### Development

| Package | Description |
|---------|-------------|
| [electron-vite](https://electron-vite.org/) | Vite-based build tooling for Electron apps |
| [vite](https://vitejs.dev/) | Frontend build tool and dev server |
| [@vitejs/plugin-react](https://www.npmjs.com/package/@vitejs/plugin-react) | React Fast Refresh and JSX transform for Vite |
| [typescript](https://www.typescriptlang.org/) | Static type checking |
| [tailwindcss](https://tailwindcss.com/) | Utility-first CSS framework |
| [@tailwindcss/vite](https://www.npmjs.com/package/@tailwindcss/vite) | Tailwind CSS integration for Vite |
| [@types/node](https://www.npmjs.com/package/@types/node) | TypeScript type definitions for Node.js |
| [@types/react](https://www.npmjs.com/package/@types/react) | TypeScript type definitions for React |
| [@types/react-dom](https://www.npmjs.com/package/@types/react-dom) | TypeScript type definitions for React DOM |
| [electron-rebuild](https://github.com/nickvdp/electron-rebuild) | Rebuilds native Node modules (node-pty) for Electron's Node version |

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
│   ├── settings.ts                                     ├── hooks/useSessions.ts
│   ├── model-selector.ts                               ├── terminal-main.ts (xterm.js)
│   └── slack-compose.ts                                └── styles/globals.css
├── services/
│   ├── pty-manager.ts
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
