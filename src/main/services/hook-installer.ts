import * as fs from 'fs'
import { SETTINGS_FILE } from '@shared/constants/paths'
import { HOOK_PORT } from './hook-server'

// Each hook forwards CARAPACE_PTY_ID (set in the PTY env, inherited by hook commands)
// and $PPID (the claude process) so hook-server knows exactly which terminal the
// event came from — and can reject a nested `claude` that inherited the env var.
function hookCmd(route: string): string {
  return `data=$(cat); curl -sf "http://127.0.0.1:${HOOK_PORT}/hook/${route}" -H "Content-Type: application/json" -H "X-Carapace-Pty: $CARAPACE_PTY_ID" -H "X-Carapace-Ppid: $PPID" -d "$data" 2>/dev/null; true`
}

const HOOK_COMMANDS: Record<string, string> = {
  SessionStart: hookCmd('sessionstart'),
  Stop: hookCmd('stop'),
  PreToolUse: hookCmd('pretooluse'),
}
const HOOK_MARKER = `/hook/`

function isCarapaceEntry(entry: any): boolean {
  return Array.isArray(entry?.hooks) &&
    entry.hooks.some((h: any) => typeof h?.command === 'string' && h.command.includes(HOOK_MARKER))
}

function makeHookEntry(command: string) {
  return { hooks: [{ type: 'command', command }] }
}

export function installHooks(): void {
  try {
    let settings: any = {}
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
    } catch { /* fresh install — start with empty object */ }

    if (!settings.hooks) settings.hooks = {}

    // Replace rather than skip existing Carapace entries, so installs from older
    // versions pick up command changes (e.g. the X-Carapace-Pty header).
    for (const [eventType, command] of Object.entries(HOOK_COMMANDS)) {
      const others = (settings.hooks[eventType] || []).filter((entry: any) => !isCarapaceEntry(entry))
      settings.hooks[eventType] = [...others, makeHookEntry(command)]
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
    console.log('[hooks] Claude Code hooks installed')
  } catch (err) {
    console.error('[hooks] Failed to install hooks:', (err as Error).message)
  }
}

export function uninstallHooks(): void {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8')
    const settings: any = JSON.parse(raw)

    for (const eventType of Object.keys(HOOK_COMMANDS)) {
      if (!Array.isArray(settings.hooks?.[eventType])) continue
      settings.hooks[eventType] = settings.hooks[eventType].filter((entry: any) => !isCarapaceEntry(entry))
      if (settings.hooks[eventType].length === 0) delete settings.hooks[eventType]
    }

    if (settings.hooks && Object.keys(settings.hooks).length === 0) {
      delete settings.hooks
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
    console.log('[hooks] Claude Code hooks removed')
  } catch { /* settings file may not exist — ignore */ }
}
