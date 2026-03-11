import * as fs from 'fs'
import { CREDENTIALS_FILE, SETTINGS_FILE } from '@shared/constants/paths'
import type { CredentialsInfo, SettingsInfo } from '@shared/types/session'

export function readCredentials(): CredentialsInfo {
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf-8')
    const data = JSON.parse(raw)
    const oauth = data?.claudeAiOauth
    return {
      subscriptionType: oauth?.subscriptionType || 'unknown',
      rateLimitTier: oauth?.rateLimitTier || 'unknown',
      hasAccessToken: !!oauth?.accessToken
    }
  } catch {
    return {
      subscriptionType: 'unknown',
      rateLimitTier: 'unknown',
      hasAccessToken: false
    }
  }
}

export function readAccessToken(): string | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf-8')
    const data = JSON.parse(raw)
    return data?.claudeAiOauth?.accessToken || null
  } catch {
    return null
  }
}

export function readSettings(): SettingsInfo {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8')
    const data = JSON.parse(raw)
    return {
      allowedTools: data?.permissions?.allow || [],
      plugins: data?.enabledPlugins || {}
    }
  } catch {
    return {
      allowedTools: [],
      plugins: {}
    }
  }
}
