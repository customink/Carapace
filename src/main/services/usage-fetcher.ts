import * as fs from 'fs'
import * as https from 'https'
import * as path from 'path'
import { CCSTATUSLINE_CACHE, CARAPACE_CACHE_DIR, CARAPACE_USAGE_CACHE } from '@shared/constants/paths'
import { readAccessToken } from './settings-reader'
import type { UsageData } from '@shared/types/session'

const CACHE_MAX_AGE_MS = 180_000 // 3 minutes
const RATE_LIMIT_MS = 30_000 // 30 seconds between API calls

let lastFetchTime = 0

interface ApiResponse {
  five_hour?: { utilization?: number; resets_at?: string }
  seven_day?: { utilization?: number; resets_at?: string }
  extra_usage?: {
    is_enabled?: boolean
    monthly_limit?: number
    used_credits?: number
    utilization?: number
  }
}

function readCacheFile(filePath: string): UsageData | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    if (Date.now() - stat.mtimeMs > CACHE_MAX_AGE_MS) return null
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    return parseApiResponse(data)
  } catch {
    return null
  }
}

function parseApiResponse(data: ApiResponse): UsageData {
  return {
    fiveHour: data.five_hour ? {
      utilization: data.five_hour.utilization ?? 0,
      resetsAt: data.five_hour.resets_at ?? null
    } : null,
    sevenDay: data.seven_day ? {
      utilization: data.seven_day.utilization ?? 0,
      resetsAt: data.seven_day.resets_at ?? null
    } : null,
    extraUsage: data.extra_usage ? {
      isEnabled: data.extra_usage.is_enabled ?? false,
      monthlyLimit: data.extra_usage.monthly_limit ?? 0,
      usedCredits: data.extra_usage.used_credits ?? 0,
      utilization: data.extra_usage.utilization ?? 0
    } : null
  }
}

function writeCacheFile(data: ApiResponse): void {
  try {
    fs.mkdirSync(CARAPACE_CACHE_DIR, { recursive: true })
    fs.writeFileSync(CARAPACE_USAGE_CACHE, JSON.stringify(data), 'utf-8')
  } catch {
    // Cache write failure is non-critical
  }
}

/**
 * Fetch usage data from Anthropic API, following ccstatusline's pattern.
 * Checks ccstatusline's cache first to avoid duplicate API calls.
 */
export async function fetchUsageData(): Promise<UsageData | null> {
  // 1. Check ccstatusline's cache first (reuse if fresh)
  const ccCache = readCacheFile(CCSTATUSLINE_CACHE)
  if (ccCache) return ccCache

  // 2. Check our own cache
  const ourCache = readCacheFile(CARAPACE_USAGE_CACHE)
  if (ourCache) return ourCache

  // 3. Rate limit check
  if (Date.now() - lastFetchTime < RATE_LIMIT_MS) return null

  // 4. Fetch from Anthropic API
  const token = readAccessToken()
  if (!token) return null

  lastFetchTime = Date.now()

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.claude.ai',
      path: '/api/usage',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 10_000
    }

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => {
        try {
          const data: ApiResponse = JSON.parse(body)
          writeCacheFile(data)
          resolve(parseApiResponse(data))
        } catch {
          resolve(null)
        }
      })
    })

    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.end()
  })
}
