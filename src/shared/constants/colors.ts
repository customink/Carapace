/** Color palette for active session orbs. Each session gets a unique color. */
export const SESSION_COLORS = [
  '#3B6EE8', // navy blue
  '#10B981', // green
  '#F97316', // orange
  '#E879F9', // fuchsia
  '#06B6D4', // cyan
  '#F43F5E', // rose
  '#A78BFA', // violet
  '#FBBF24', // amber
  '#14B8A6', // teal
  '#FB7185', // coral
] as const

/** Emoji for each session color, matching palette order */
const COLOR_EMOJIS: Record<string, string> = {
  '#3B6EE8': '💙',
  '#10B981': '💚',
  '#F97316': '🧡',
  '#E879F9': '🩷',
  '#06B6D4': '🩵',
  '#F43F5E': '❤️',
  '#A78BFA': '💜',
  '#FBBF24': '💛',
  '#14B8A6': '🩵',
  '#FB7185': '🩷',
}

/** Get the emoji matching a session color */
export function colorEmoji(hex: string): string {
  return COLOR_EMOJIS[hex] ?? '⬤'
}

/** Assign a stable color to a session based on its ID */
export function sessionColor(sessionId: string): string {
  let hash = 0
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash + sessionId.charCodeAt(i)) | 0
  }
  return SESSION_COLORS[Math.abs(hash) % SESSION_COLORS.length]!
}
