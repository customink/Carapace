import { getContextLimit } from '@shared/constants/pricing'

export function computeContextPercent(contextLength: number, model: string): number {
  const limit = getContextLimit(model)
  if (limit === 0) return 0
  return Math.min(100, (contextLength / limit) * 100)
}
