export function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return count.toString()
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1m'
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

export function extractProjectName(projectPath: string): string {
  const parts = projectPath.split('/')
  return parts[parts.length - 1] || projectPath
}

/** Convert model ID like "claude-opus-4-6" to display name like "Opus 4.6" */
export function formatModelName(model: string): string {
  // Match patterns like claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001
  const match = model.match(/claude-(\w+)-(\d+)-(\d+)/)
  if (match) {
    const name = match[1]!.charAt(0).toUpperCase() + match[1]!.slice(1)
    return `${name} ${match[2]}.${match[3]}`
  }
  return model
}

/** Capitalize effort level for display */
export function formatEffortLevel(effort: string): string {
  if (!effort) return 'Default'
  return effort.charAt(0).toUpperCase() + effort.slice(1).toLowerCase()
}
