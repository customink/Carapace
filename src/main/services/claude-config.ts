import * as fs from 'fs'
import { join } from 'path'
import { CLAUDE_DIR } from '@shared/constants/paths'

const CLAUDE_JSON = join(CLAUDE_DIR, '.claude.json')

/**
 * Pre-accept the Claude Code trust dialog by writing to ~/.claude/.claude.json.
 * This prevents the trust prompt from appearing when spawning background sessions.
 * Inspired by Warp's prepare_claude_environment_config() approach.
 */
export function ensureTrustAccepted(): void {
  try {
    let config: Record<string, unknown> = {}
    try {
      config = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf-8'))
    } catch { /* file doesn't exist yet — start fresh */ }

    if (config.hasCompletedOnboarding === true && config.hasTrustDialogAccepted === true) return

    config.hasCompletedOnboarding = true
    config.hasTrustDialogAccepted = true
    fs.writeFileSync(CLAUDE_JSON, JSON.stringify(config, null, 2))
  } catch (err) {
    console.warn('[claude-config] Could not pre-accept trust dialog:', (err as Error).message)
  }
}
