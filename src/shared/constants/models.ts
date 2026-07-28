export interface ModelOption {
  /** Value passed to `claude --model`. An alias or a full model ID. */
  id: string
  label: string
  description: string
}

/**
 * Models offered in the session model dropdown.
 *
 * `claude --model` takes either an alias for the latest model in a family
 * ('opus', 'sonnet', 'fable') or a full ID ('claude-opus-5'). Aliases are listed first
 * because they keep following the latest release; pinned IDs are for reproducibility.
 *
 * There is no CLI command that enumerates models, so this list is maintained by hand —
 * the dropdown also accepts a typed-in value for anything not listed here.
 */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: '', label: 'Default', description: "Whatever the Claude CLI is configured to use" },

  { id: 'opus', label: 'Opus (latest)', description: 'Alias — always the newest Opus' },
  { id: 'sonnet', label: 'Sonnet (latest)', description: 'Alias — always the newest Sonnet' },
  { id: 'haiku', label: 'Haiku (latest)', description: 'Alias — always the newest Haiku' },
  { id: 'fable', label: 'Fable (latest)', description: 'Alias — most capable, highest cost' },

  { id: 'claude-fable-5', label: 'Fable 5', description: 'Most capable; for the hardest long-horizon work' },
  { id: 'claude-opus-5', label: 'Opus 5', description: 'Complex agentic coding and deep reasoning' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', description: 'Near-Opus quality on coding, lower cost' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', description: 'Fastest and cheapest' },

  { id: 'claude-opus-4-8', label: 'Opus 4.8', description: 'Previous-generation Opus' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', description: 'Older Opus' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', description: 'Previous-generation Sonnet' },
]

/** True when the value is safe to interpolate into the `claude --model` argument. */
export function isValidModelId(model: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(model)
}
