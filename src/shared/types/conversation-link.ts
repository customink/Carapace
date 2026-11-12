export type ConversationLinkKind = 'pr' | 'jira' | 'artifact' | 'file'

/** A GitHub PR, Jira ticket, claude.ai Artifact or local file/folder mentioned in a conversation */
export interface ConversationLink {
  kind: ConversationLinkKind
  /** Canonical URL — the dedupe key. For `file`, the absolute path */
  url: string
  /** Short display label: `owner/repo#123`, `KEY-123`, an artifact's title or ID, or a file/folder name */
  label: string
  /** ISO timestamp of the first mention */
  firstSeen: string
  /** Secondary text: the Jira ticket title, or a file's parent folder (`~/Desktop`) */
  title?: string
}
