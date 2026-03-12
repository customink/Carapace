# Carapace

Visual menu-bar app for managing Claude Code sessions. Built with Electron + React + xterm.js.

![macOS](https://img.shields.io/badge/platform-macOS-lightgrey)

## Features

### Floating Orb
- Always-on-top transparent floating orb showing active session count
- Mini-orbs orbit the main orb, one per active Claude session
- Each mini-orb displays session emoji/letter, color, and context usage percentage
- Click the orb to toggle the session panel; right-click for quick actions
- Click a mini-orb to instantly focus that terminal window
- Right-click mini-orbs to set custom letters, emojis, or colors
- Pulsing bell indicator on mini-orbs when Claude finishes responding in an unfocused window
- Thinking spinner on mini-orbs when Claude is actively responding

### Session Management
- Spawn new Claude Code sessions with custom title, folder, color, and model
- 8-color palette for visually distinguishing sessions
- Skip-permissions mode for trusted sessions
- Session discovery automatically detects running Claude processes
- Revive recent sessions with preserved color, label, emoji, bypass mode, and prompt history
- Real-time session metrics: token usage, cost, context window percentage, duration

### Terminal Windows
- Full terminal emulation powered by xterm.js + node-pty
- Colored titlebar and background tint matching session color
- Dynamic window titles showing session name and active model
- Companion shell tab (Claude + Shell tabs in the same window)
- Clickable links open in your default browser
- Right-click context menu (Copy, Paste, Select All, Clear Terminal)
- Clipboard image paste support

### Attention Bell
- Audible notification (Glass.aiff) when Claude finishes responding in an unfocused terminal
- Bell arms on user input and fires after output stops
- Configurable chime sound and volume
- Visual indicator on mini-orb (pulsing bell emoji)
- Auto-clears when you focus the terminal window
- Polling fallback ensures notifications are never missed

### Sidebar Tools
- **Notes** — Floating notepad per session
- **Slash Commands** — Quick access to built-in Claude commands
- **Skills Browser** — Browse and use user/plugin skills
- **File Tree** — Navigable directory tree of the session's working folder with right-click "Add to prompt"
- **Open Folder** — Open session directory in Finder
- **Model Selector** — Drawer panel to switch Claude models
- **GitHub** — Open the session's Git repo in your browser
- **Prompt History** — Last 20 prompts with one-click re-use, persisted across session revival
- **Share to Slack** — Compose and send session context to Slack
- **Custom Snippets** — Create, edit, and manage quick-paste prompt snippets with custom emoji icons

### Session Panel
- Vibrancy popover showing all active sessions
- Session cards with live metrics (tokens, cost, context %, duration)
- Context bar visualization
- Quick actions: focus, close, or manage sessions

## Quick Start

```bash
./install.sh         # check prerequisites, install deps, build
npx electron out/main/index.js  # run the app
```

Or manually:

```bash
npm install          # also runs electron-rebuild for node-pty
npm run build        # production build to /out
npx electron out/main/index.js  # run production build
npm run dev          # dev mode with hot reload
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
├── index.ts (app entry)        ├── index.ts            ├── App.tsx
├── windows/                    └── terminal.ts         ├── components/
│   ├── orb.ts (floating orb)                           │   └── orb/FloatingOrb.tsx
│   ├── terminal.ts (per-session)                       ├── hooks/useSessions.ts
│   ├── prompt.ts (options dialog)                      ├── terminal-main.ts (xterm.js)
│   ├── snippet-dialog.ts                               └── styles/globals.css
│   ├── settings.ts
│   ├── model-selector.ts
│   ├── file-tree.ts
│   ├── prompt-history.ts
│   └── slack-compose.ts
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
│   ├── prompt-history.ts
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
