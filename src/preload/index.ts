import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../main/ipc/channels'

const api = {
  getSessions: () => ipcRenderer.invoke(IPC_CHANNELS.SESSIONS_LIST),
  getCredentials: () => ipcRenderer.invoke(IPC_CHANNELS.CREDENTIALS_GET),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  getUsage: () => ipcRenderer.invoke(IPC_CHANNELS.USAGE_GET),

  createSession: () => ipcRenderer.send(IPC_CHANNELS.SESSION_CREATE),
  createSessionBypass: () => ipcRenderer.send(IPC_CHANNELS.SESSION_CREATE_BYPASS),
  showContextMenu: () => ipcRenderer.send(IPC_CHANNELS.ORB_CONTEXT_MENU),
  focusSession: (pid: number) => ipcRenderer.send(IPC_CHANNELS.SESSION_FOCUS, pid),
  miniOrbContextMenu: (pid: number) => ipcRenderer.send(IPC_CHANNELS.MINI_ORB_CONTEXT_MENU, pid),

  dragStart: (screenX: number, screenY: number) => ipcRenderer.send('orb:drag-start', screenX, screenY),
  dragMove: (screenX: number, screenY: number) => ipcRenderer.send('orb:drag-move', screenX, screenY),
  dragEnd: () => ipcRenderer.send('orb:drag-end'),

  orbMouseEnter: () => ipcRenderer.send('orb:mouse-enter'),
  orbMouseLeave: () => ipcRenderer.send('orb:mouse-leave'),

  onSessionsUpdated: (callback: (sessions: unknown[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessions: unknown[]) => callback(sessions)
    ipcRenderer.on(IPC_CHANNELS.SESSIONS_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SESSIONS_UPDATED, handler)
  },

  onSessionAttention: (callback: (pid: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, pid: number) => callback(pid)
    ipcRenderer.on(IPC_CHANNELS.SESSION_ATTENTION, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SESSION_ATTENTION, handler)
  },

  onSessionAttentionClear: (callback: (pid: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, pid: number) => callback(pid)
    ipcRenderer.on(IPC_CHANNELS.SESSION_ATTENTION_CLEAR, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SESSION_ATTENTION_CLEAR, handler)
  },

  onSessionThinking: (callback: (pid: number, isThinking: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, pid: number, isThinking: boolean) => callback(pid, isThinking)
    ipcRenderer.on(IPC_CHANNELS.SESSION_THINKING, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SESSION_THINKING, handler)
  }
}

contextBridge.exposeInMainWorld('carapace', api)

export type CarapaceAPI = typeof api
