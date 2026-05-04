import { homedir } from 'os'
import { join } from 'path'

const HOME = homedir()

export const CLAUDE_DIR = join(HOME, '.claude')
export const SESSION_META_DIR = join(CLAUDE_DIR, 'usage-data', 'session-meta')
export const PROJECTS_DIR = join(CLAUDE_DIR, 'projects')
export const HISTORY_FILE = join(CLAUDE_DIR, 'history.jsonl')
export const CREDENTIALS_FILE = join(CLAUDE_DIR, '.credentials.json')
export const SETTINGS_FILE = join(CLAUDE_DIR, 'settings.json')
export const IDE_DIR = join(CLAUDE_DIR, 'ide')
export const CCSTATUSLINE_CACHE = join(HOME, '.cache', 'ccstatusline', 'usage.json')
export const CARAPACE_CACHE_DIR = join(HOME, '.cache', 'carapace')
export const CARAPACE_USAGE_CACHE = join(CARAPACE_CACHE_DIR, 'usage.json')
export const STACKS_FILE = join(CLAUDE_DIR, 'stacks.json')
