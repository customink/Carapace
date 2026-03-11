import { contextBridge, ipcRenderer } from 'electron'

const terminalApi = {
  sendData: (data: string) => ipcRenderer.send('terminal:input', data),
  resize: (cols: number, rows: number) => ipcRenderer.send('terminal:resize', cols, rows),

  onData: (callback: (data: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: string) => callback(data)
    ipcRenderer.on('terminal:data', handler)
    return () => { ipcRenderer.removeListener('terminal:data', handler) }
  },

  onExit: (callback: (code: number) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, code: number) => callback(code)
    ipcRenderer.on('terminal:exit', handler)
    return () => { ipcRenderer.removeListener('terminal:exit', handler) }
  },

  getSessionInfo: () => ipcRenderer.invoke('terminal:session-info'),

  saveClipboardImage: (buffer: ArrayBuffer) =>
    ipcRenderer.invoke('terminal:save-clipboard-image', Buffer.from(buffer)),

  // Companion shell tab
  shellSendData: (data: string) => ipcRenderer.send('terminal:shell-input', data),
  shellResize: (cols: number, rows: number) => ipcRenderer.send('terminal:shell-resize', cols, rows),

  onShellData: (callback: (data: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: string) => callback(data)
    ipcRenderer.on('terminal:shell-data', handler)
    return () => { ipcRenderer.removeListener('terminal:shell-data', handler) }
  },

  onShellExit: (callback: (code: number) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, code: number) => callback(code)
    ipcRenderer.on('terminal:shell-exit', handler)
    return () => { ipcRenderer.removeListener('terminal:shell-exit', handler) }
  },

  // Notes
  toggleNotes: () => ipcRenderer.send('terminal:toggle-notes'),

  onNotesClosed: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('terminal:notes-closed', handler)
    return () => { ipcRenderer.removeListener('terminal:notes-closed', handler) }
  },

  // Skills
  toggleSkills: () => ipcRenderer.send('terminal:toggle-skills'),

  onSkillsClosed: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('terminal:skills-closed', handler)
    return () => { ipcRenderer.removeListener('terminal:skills-closed', handler) }
  },

  onTypeCommand: (callback: (command: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, command: string) => callback(command)
    ipcRenderer.on('terminal:type-command', handler)
    return () => { ipcRenderer.removeListener('terminal:type-command', handler) }
  },

  // Open folder
  openFolder: () => ipcRenderer.send('terminal:open-folder'),

  // Skill browser
  toggleSkillBrowser: () => ipcRenderer.send('terminal:toggle-skillbrowser'),

  onSkillBrowserClosed: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('terminal:skillbrowser-closed', handler)
    return () => { ipcRenderer.removeListener('terminal:skillbrowser-closed', handler) }
  },

  // Model selector
  toggleModelSelector: () => ipcRenderer.send('terminal:toggle-modelselector'),

  onModelSelectorClosed: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('terminal:modelselector-closed', handler)
    return () => { ipcRenderer.removeListener('terminal:modelselector-closed', handler) }
  },

  // Snippets
  getSnippets: () => ipcRenderer.invoke('snippets:list'),
  showSnippetDialog: () => ipcRenderer.send('snippet:show-dialog'),
  snippetContextMenu: (id: string) => ipcRenderer.send('snippet:context-menu', id),

  // GitHub
  getGitHubUrl: () => ipcRenderer.invoke('terminal:github-url'),
  openGitHub: () => ipcRenderer.send('terminal:open-github'),

  // Slack
  slackCompose: () => ipcRenderer.send('slack:compose'),

  // Title updates
  onTitleUpdated: (callback: (title: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, title: string) => callback(title)
    ipcRenderer.on('terminal:title-updated', handler)
    return () => { ipcRenderer.removeListener('terminal:title-updated', handler) }
  },

  // Color updates
  onColorUpdated: (callback: (color: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, color: string) => callback(color)
    ipcRenderer.on('terminal:color-updated', handler)
    return () => { ipcRenderer.removeListener('terminal:color-updated', handler) }
  },

  onSnippetsUpdated: (callback: (snippets: any[]) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, snippets: any[]) => callback(snippets)
    ipcRenderer.on('snippets:updated', handler)
    return () => { ipcRenderer.removeListener('snippets:updated', handler) }
  },
}

contextBridge.exposeInMainWorld('carapaceTerminal', terminalApi)

export type TerminalAPI = typeof terminalApi
