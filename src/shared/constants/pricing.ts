export interface ModelPricing {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  contextLimit: number
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': {
    input: 15 / 1_000_000,
    output: 75 / 1_000_000,
    cacheWrite: 18.75 / 1_000_000,
    cacheRead: 1.5 / 1_000_000,
    contextLimit: 200_000
  },
  'claude-sonnet-4-6': {
    input: 3 / 1_000_000,
    output: 15 / 1_000_000,
    cacheWrite: 3.75 / 1_000_000,
    cacheRead: 0.3 / 1_000_000,
    contextLimit: 200_000
  },
  'claude-haiku-4-5-20251001': {
    input: 0.8 / 1_000_000,
    output: 4 / 1_000_000,
    cacheWrite: 1 / 1_000_000,
    cacheRead: 0.08 / 1_000_000,
    contextLimit: 200_000
  }
}

// Fallback for unknown models
export const DEFAULT_PRICING: ModelPricing = MODEL_PRICING['claude-sonnet-4-6']!

export function getPricing(model: string): ModelPricing {
  // Match by prefix for version variants
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key) || key.startsWith(model)) {
      return pricing
    }
  }
  // Check for model family names
  if (model.includes('opus')) return MODEL_PRICING['claude-opus-4-6']!
  if (model.includes('haiku')) return MODEL_PRICING['claude-haiku-4-5-20251001']!
  if (model.includes('sonnet')) return MODEL_PRICING['claude-sonnet-4-6']!
  return DEFAULT_PRICING
}

export function getContextLimit(model: string): number {
  return getPricing(model).contextLimit
}
