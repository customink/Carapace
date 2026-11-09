import { parsePullRequestUrl } from './pr-resolver'
import type { ConversationLinkKind } from '@shared/types/conversation-link'

export interface ExtractedLink {
  kind: ConversationLinkKind
  url: string
  label: string
}

const URL_RE = /https?:\/\/[^\s<>"'`|]+/gi
// Markdown/prose punctuation that commonly trails a URL but is never part of these links
const TRAILING_PUNCT_RE = /[).,;:!?\]*_>}]+$/
const JIRA_KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/

/** Canonical `https://<site>.atlassian.net/browse/KEY-123`, or null if this isn't a Jira ticket link. */
export function parseJiraUrl(input: string): ExtractedLink | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  if (!/^[a-z0-9-]+\.atlassian\.net$/.test(host)) return null

  // /browse/KEY-1, /jira/software/.../issues/KEY-1, or any board view with ?selectedIssue=KEY-1
  const fromPath = url.pathname.match(/\/(?:browse|issues)\/([A-Za-z][A-Za-z0-9]+-\d+)/)?.[1]
  const key = (fromPath || url.searchParams.get('selectedIssue') || '').toUpperCase()
  if (!JIRA_KEY_RE.test(key)) return null

  return { kind: 'jira', url: `https://${host}/browse/${key}`, label: key }
}

// A bare ticket key: not glued to other word characters or hyphens (so `foo-AC-1` and
// `AC-1-2` don't count). Only keys whose project has a learned site become links.
const BARE_JIRA_KEY_RE = /(?<![A-Za-z0-9-])([A-Z][A-Z0-9]{1,9}-\d{1,7})(?![A-Za-z0-9-])/g

/** Bare Jira-shaped keys (`AC-877`) mentioned in text, deduped. Resolution to a URL is the caller's. */
export function extractJiraKeys(text: string): string[] {
  return [...new Set([...text.matchAll(BARE_JIRA_KEY_RE)].map(m => m[1]!))]
}

/** All GitHub PR and Jira ticket links in a block of text, canonicalised and deduped. */
export function extractLinks(text: string): ExtractedLink[] {
  const found = new Map<string, ExtractedLink>()
  for (const raw of text.match(URL_RE) || []) {
    const candidate = raw.replace(TRAILING_PUNCT_RE, '')
    const pr = parsePullRequestUrl(candidate)
    if (pr) {
      found.set(pr.url, { kind: 'pr', url: pr.url, label: `${pr.owner}/${pr.repo}#${pr.number}` })
      continue
    }
    const jira = parseJiraUrl(candidate)
    if (jira) found.set(jira.url, jira)
  }
  return [...found.values()]
}

/**
 * The human-visible text of one transcript line: user prompts and assistant replies only.
 * Tool calls, tool output, thinking, sidechains and meta entries are skipped — one
 * `gh pr list` would otherwise flood the list with PRs nobody actually mentioned.
 */
export function messageText(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return ''
  const e = entry as { type?: string; isSidechain?: boolean; isMeta?: boolean; message?: { content?: unknown } }
  if (e.type !== 'user' && e.type !== 'assistant') return ''
  if (e.isSidechain || e.isMeta) return ''
  const content = e.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { type: 'text'; text: string } => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
}
