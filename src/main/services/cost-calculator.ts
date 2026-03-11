import { getPricing } from '@shared/constants/pricing'
import type { TokenMetrics } from '@shared/types/session'

export function computeSessionCost(metrics: TokenMetrics, model: string): number {
  const pricing = getPricing(model)
  return (
    metrics.inputTokens * pricing.input +
    metrics.outputTokens * pricing.output +
    metrics.cachedTokens * pricing.cacheRead
  )
}

export function computeDetailedCost(
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
  model: string
): number {
  const pricing = getPricing(model)
  return (
    inputTokens * pricing.input +
    outputTokens * pricing.output +
    cacheWriteTokens * pricing.cacheWrite +
    cacheReadTokens * pricing.cacheRead
  )
}
