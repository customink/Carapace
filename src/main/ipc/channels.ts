// Type-safe IPC channel definitions
export const IPC_CHANNELS = {
  // Session queries
  SESSIONS_LIST: 'sessions:list',
  SESSIONS_UPDATED: 'sessions:updated',

  // Settings queries
  CREDENTIALS_GET: 'credentials:get',
  SETTINGS_GET: 'settings:get',

  // Usage data
  USAGE_GET: 'usage:get',
  USAGE_UPDATED: 'usage:updated',

  // Session creation
  SESSION_CREATE: 'session:create',
  SESSION_CREATE_BYPASS: 'session:create-bypass',

  // Session focus
  SESSION_FOCUS: 'session:focus',

  // Session creation with title
  SESSION_CREATE_TITLED: 'session:create-titled',

  // Context menu
  ORB_CONTEXT_MENU: 'orb:context-menu',

  // Mini-orb context menu
  MINI_ORB_CONTEXT_MENU: 'mini-orb:context-menu',

  // Attention notifications
  SESSION_ATTENTION: 'session:attention',
  SESSION_ATTENTION_CLEAR: 'session:attention-clear',

  // Snippets
  SNIPPETS_LIST: 'snippets:list',
  SNIPPETS_UPDATED: 'snippets:updated',
  SNIPPET_DIALOG: 'snippet:show-dialog',
  SNIPPET_CONTEXT_MENU: 'snippet:context-menu',

  // Slack
  SLACK_COMPOSE: 'slack:compose',

  // Terminal title
  TERMINAL_TITLE_UPDATED: 'terminal:title-updated',

  // Thinking state (Claude actively generating)
  SESSION_THINKING: 'session:thinking'
} as const
