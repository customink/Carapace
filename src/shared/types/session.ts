export interface SessionMeta {
  session_id: string
  project_path: string
  start_time: string
  duration_minutes: number
  user_message_count: number
  assistant_message_count: number
  tool_counts: Record<string, number>
  languages: Record<string, number>
  input_tokens: number
  output_tokens: number
  first_prompt: string
  summary: string
  uses_mcp: boolean
  uses_web_search: boolean
  lines_added: number
  lines_removed: number
  files_modified: number
}

export interface TokenMetrics {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  totalTokens: number
  contextLength: number
}

export interface UsageData {
  fiveHour: { utilization: number; resetsAt: string | null } | null
  sevenDay: { utilization: number; resetsAt: string | null } | null
  extraUsage: {
    isEnabled: boolean
    monthlyLimit: number
    usedCredits: number
    utilization: number
  } | null
}

export type SessionStatus = 'active' | 'idle' | 'historical'

export interface SessionState {
  id: string
  projectPath: string
  projectName: string
  summary: string
  firstPrompt: string
  startTime: string
  durationMinutes: number
  status: SessionStatus
  model: string
  cost: number
  contextPercent: number
  tokens: TokenMetrics
  toolCounts: Record<string, number>
  userMessageCount: number
  assistantMessageCount: number
  pid?: number
  color: string
  /** User-given session title from options dialog */
  title?: string
  /** Custom label for mini-orb (single letter or emoji) */
  label?: string
  /** true when session was spawned by Carapace (has a PTY in pty-manager) */
  managed?: boolean
}

export interface CredentialsInfo {
  subscriptionType: string
  rateLimitTier: string
  hasAccessToken: boolean
}

export interface SettingsInfo {
  allowedTools: string[]
  plugins: Record<string, boolean>
}
