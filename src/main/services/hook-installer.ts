import * as fs from 'fs'
import { SETTINGS_FILE } from '@shared/constants/paths'
import { HOOK_PORT } from './hook-server'

const STOP_CMD = `data=$(cat); curl -sf "http://127.0.0.1:${HOOK_PORT}/hook/stop" -H "Content-Type: application/json" -d "$data" 2>/dev/null; true`
const PRETOOLUSE_CMD = `data=$(cat); curl -sf "http://127.0.0.1:${HOOK_PORT}/hook/pretooluse" -H "Content-Type: application/json" -d "$data" 2>/dev/null; true`
const HOOK_MARKER = `/hook/`

function hasCarapaceHook(hookList: unknown[]): boolean {
  return hookList.some((entry: any) =>
    Array.isArray(entry?.hooks) &&
    entry.hooks.some((h: any) => typeof h?.command === 'string' && h.command.includes(HOOK_MARKER))
  )
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

    if (!hasCarapaceHook(settings.hooks.Stop || [])) {
      settings.hooks.Stop = [...(settings.hooks.Stop || []), makeHookEntry(STOP_CMD)]
    }

    if (!hasCarapaceHook(settings.hooks.PreToolUse || [])) {
      settings.hooks.PreToolUse = [...(settings.hooks.PreToolUse || []), makeHookEntry(PRETOOLUSE_CMD)]
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

    for (const eventType of ['Stop', 'PreToolUse']) {
      if (!Array.isArray(settings.hooks?.[eventType])) continue
      settings.hooks[eventType] = settings.hooks[eventType].filter((entry: any) =>
        !Array.isArray(entry?.hooks) ||
        !entry.hooks.some((h: any) => typeof h?.command === 'string' && h.command.includes(HOOK_MARKER))
      )
      if (settings.hooks[eventType].length === 0) delete settings.hooks[eventType]
    }

    if (settings.hooks && Object.keys(settings.hooks).length === 0) {
      delete settings.hooks
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
    console.log('[hooks] Claude Code hooks removed')
  } catch { /* settings file may not exist — ignore */ }
}
