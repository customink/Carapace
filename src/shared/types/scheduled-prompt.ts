export interface ScheduledPrompt {
  id: string
  name: string
  hour: number       // 0-23
  minute: number     // 0-59
  cwd: string
  prompt: string
  presetId?: string  // optional preset for session config
  enabled: boolean
}
