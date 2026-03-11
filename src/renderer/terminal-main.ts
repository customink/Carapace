import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { SNIPPET_ICONS } from '@shared/constants/snippet-icons'
import type { Snippet } from '@shared/types/snippet'

declare global {
  interface Window {
    carapaceTerminal: {
      sendData: (data: string) => void
      resize: (cols: number, rows: number) => void
      onData: (callback: (data: string) => void) => () => void
      onExit: (callback: (code: number) => void) => () => void
      getSessionInfo: () => Promise<{ color: string; ptyId: string }>
      saveClipboardImage: (buffer: ArrayBuffer) => Promise<string>
      shellSendData: (data: string) => void
      shellResize: (cols: number, rows: number) => void
      onShellData: (callback: (data: string) => void) => () => void
      onShellExit: (callback: (code: number) => void) => () => void
      toggleNotes: () => void
      onNotesClosed: (callback: () => void) => () => void
      toggleSkills: () => void
      onSkillsClosed: (callback: () => void) => () => void
      onTypeCommand: (callback: (command: string) => void) => () => void
      openFolder: () => void
      toggleSkillBrowser: () => void
      onSkillBrowserClosed: (callback: () => void) => () => void
      toggleModelSelector: () => void
      onModelSelectorClosed: (callback: () => void) => () => void
      getSnippets: () => Promise<Snippet[]>
      showSnippetDialog: () => void
      snippetContextMenu: (id: string) => void
      onSnippetsUpdated: (callback: (snippets: Snippet[]) => void) => () => void
      slackCompose: () => void
      onTitleUpdated: (callback: (title: string) => void) => () => void
      onColorUpdated: (callback: (color: string) => void) => () => void
    }
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  }
}

function tintedBackground(hex: string, tint = 0.08): string {
  const { r, g, b } = hexToRgb(hex)
  const tr = Math.round(r * tint).toString(16).padStart(2, '0')
  const tg = Math.round(g * tint).toString(16).padStart(2, '0')
  const tb = Math.round(b * tint).toString(16).padStart(2, '0')
  return `#${tr}${tg}${tb}`
}

function setupCopyPaste(terminal: Terminal, sendData: (data: string) => void) {
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true

    if (event.metaKey && event.key === 'c') {
      if (terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection())
        return false
      }
      return true
    }

    if (event.metaKey && event.key === 'v') {
      navigator.clipboard.readText().then(text => {
        sendData(text)
      })
      return false
    }

    return true
  })
}

function setupDragDrop(element: HTMLElement, sendData: (data: string) => void, focusFn: () => void) {
  element.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  element.addEventListener('drop', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.dataTransfer?.files.length) return
    const paths = Array.from(e.dataTransfer.files)
      .map(f => (f as any).path as string)
      .filter(Boolean)
    if (paths.length > 0) {
      const escaped = paths.map(p => p.includes(' ') ? `"${p}"` : p).join(' ')
      sendData(escaped)
    }
    focusFn()
  })
}

async function init() {
  const params = new URLSearchParams(window.location.search)
  let color = params.get('color') || '#7C3AED'
  const title = params.get('title') || 'Claude Code'
  const hasShellTab = params.get('shellTab') === '1'

  try {
    const info = await window.carapaceTerminal.getSessionInfo()
    color = info.color
  } catch { /* use URL params */ }

  // Set titlebar
  const titlebar = document.getElementById('titlebar')!
  titlebar.textContent = title
  titlebar.style.backgroundColor = tintedBackground(color, 0.15)

  // Set body background
  document.body.style.background = tintedBackground(color)

  // Sidebar background
  const sidebar = document.getElementById('sidebar')!
  sidebar.style.backgroundColor = tintedBackground(color, 0.1)

  // Tab bar background
  const tabbar = document.getElementById('tabbar')!
  tabbar.style.backgroundColor = tintedBackground(color, 0.12)

  const bgColor = tintedBackground(color)
  const theme = {
    background: bgColor,
    cursor: color,
    cursorAccent: '#000000',
    foreground: '#e2e8f0',
    selectionBackground: color + '40',
  }

  // ─── Claude terminal ───
  const claudeFit = new FitAddon()
  const claudeTerminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: 13,
    fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
    theme,
    allowProposedApi: true,
  })

  claudeTerminal.loadAddon(claudeFit)
  claudeTerminal.loadAddon(new WebLinksAddon())
  claudeTerminal.open(document.getElementById('terminal')!)
  claudeFit.fit()

  window.carapaceTerminal.resize(claudeTerminal.cols, claudeTerminal.rows)

  claudeTerminal.onData((data) => {
    window.carapaceTerminal.sendData(data)
  })

  window.carapaceTerminal.onData((data) => {
    claudeTerminal.write(data)
  })

  window.carapaceTerminal.onExit(() => {
    claudeTerminal.write('\r\n\x1b[90m[Session ended]\x1b[0m\r\n')
  })

  setupCopyPaste(claudeTerminal, (data) => window.carapaceTerminal.sendData(data))
  setupDragDrop(document.getElementById('terminal')!, (data) => window.carapaceTerminal.sendData(data), () => claudeTerminal.focus())

  // Paste images from clipboard
  document.addEventListener('paste', async (e) => {
    if (!e.clipboardData) return
    const imageItem = Array.from(e.clipboardData.items).find(
      item => item.type.startsWith('image/')
    )
    if (!imageItem) return
    e.preventDefault()
    const blob = imageItem.getAsFile()
    if (!blob) return
    const buffer = await blob.arrayBuffer()
    const filePath = await window.carapaceTerminal.saveClipboardImage(buffer)
    // Send to whichever terminal is active
    if (activeTab === 'claude') {
      window.carapaceTerminal.sendData(filePath)
      claudeTerminal.focus()
    } else if (shellTerminal) {
      window.carapaceTerminal.shellSendData(filePath)
      shellTerminal.focus()
    }
  })

  // ─── Shell tab (optional) ───
  let shellTerminal: Terminal | null = null
  let shellFit: FitAddon | null = null
  let activeTab: 'claude' | 'shell' = 'claude'

  if (hasShellTab) {
    tabbar.classList.add('visible')

    shellFit = new FitAddon()
    shellTerminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      theme,
      allowProposedApi: true,
    })

    shellTerminal.loadAddon(shellFit)
    shellTerminal.loadAddon(new WebLinksAddon())
    shellTerminal.open(document.getElementById('shell-terminal')!)

    shellTerminal.onData((data) => {
      window.carapaceTerminal.shellSendData(data)
    })

    window.carapaceTerminal.onShellData((data) => {
      shellTerminal!.write(data)
    })

    window.carapaceTerminal.onShellExit(() => {
      shellTerminal!.write('\r\n\x1b[90m[Shell exited]\x1b[0m\r\n')
    })

    setupCopyPaste(shellTerminal, (data) => window.carapaceTerminal.shellSendData(data))
    setupDragDrop(document.getElementById('shell-terminal')!, (data) => window.carapaceTerminal.shellSendData(data), () => shellTerminal!.focus())

    // Tab switching
    const claudeTab = document.getElementById('tab-claude')!
    const shellTab = document.getElementById('tab-shell')!
    const claudePane = document.getElementById('terminal')!
    const shellPane = document.getElementById('shell-terminal')!

    function switchTab(tab: 'claude' | 'shell') {
      activeTab = tab
      claudeTab.classList.toggle('active', tab === 'claude')
      shellTab.classList.toggle('active', tab === 'shell')
      claudePane.classList.toggle('active', tab === 'claude')
      shellPane.classList.toggle('active', tab === 'shell')

      if (tab === 'claude') {
        claudeFit.fit()
        window.carapaceTerminal.resize(claudeTerminal.cols, claudeTerminal.rows)
        claudeTerminal.focus()
      } else {
        shellFit!.fit()
        window.carapaceTerminal.shellResize(shellTerminal!.cols, shellTerminal!.rows)
        shellTerminal!.focus()
      }
    }

    claudeTab.addEventListener('click', () => switchTab('claude'))
    shellTab.addEventListener('click', () => switchTab('shell'))

    // Keyboard shortcut: Cmd+Shift+] and Cmd+Shift+[ to switch tabs
    document.addEventListener('keydown', (e) => {
      if (e.metaKey && e.shiftKey && e.key === ']') {
        e.preventDefault()
        switchTab(activeTab === 'claude' ? 'shell' : 'claude')
      }
      if (e.metaKey && e.shiftKey && e.key === '[') {
        e.preventDefault()
        switchTab(activeTab === 'claude' ? 'shell' : 'claude')
      }
    })
  }

  // ─── Sidebar drawers (only one open at a time) ───
  const notesBtn = document.getElementById('notes-btn')!
  const skillsBtn = document.getElementById('skills-btn')!
  const skillbrowserBtn = document.getElementById('skillbrowser-btn')!
  const modelBtn = document.getElementById('model-btn')!
  let notesOpen = false
  let skillsOpen = false
  let skillbrowserOpen = false
  let modelSelectorOpen = false

  function closeOtherDrawers(except: 'notes' | 'skills' | 'skillbrowser' | 'modelselector') {
    if (except !== 'notes' && notesOpen) {
      notesOpen = false
      notesBtn.classList.remove('active')
      window.carapaceTerminal.toggleNotes()
    }
    if (except !== 'skills' && skillsOpen) {
      skillsOpen = false
      skillsBtn.classList.remove('active')
      window.carapaceTerminal.toggleSkills()
    }
    if (except !== 'skillbrowser' && skillbrowserOpen) {
      skillbrowserOpen = false
      skillbrowserBtn.classList.remove('active')
      window.carapaceTerminal.toggleSkillBrowser()
    }
    if (except !== 'modelselector' && modelSelectorOpen) {
      modelSelectorOpen = false
      modelBtn.classList.remove('active')
      window.carapaceTerminal.toggleModelSelector()
    }
  }

  notesBtn.addEventListener('click', () => {
    if (!notesOpen) closeOtherDrawers('notes')
    notesOpen = !notesOpen
    notesBtn.classList.toggle('active', notesOpen)
    window.carapaceTerminal.toggleNotes()
  })

  skillsBtn.addEventListener('click', () => {
    if (!skillsOpen) closeOtherDrawers('skills')
    skillsOpen = !skillsOpen
    skillsBtn.classList.toggle('active', skillsOpen)
    window.carapaceTerminal.toggleSkills()
  })

  skillbrowserBtn.addEventListener('click', () => {
    if (!skillbrowserOpen) closeOtherDrawers('skillbrowser')
    skillbrowserOpen = !skillbrowserOpen
    skillbrowserBtn.classList.toggle('active', skillbrowserOpen)
    window.carapaceTerminal.toggleSkillBrowser()
  })

  window.carapaceTerminal.onNotesClosed(() => {
    notesOpen = false
    notesBtn.classList.remove('active')
  })

  window.carapaceTerminal.onSkillsClosed(() => {
    skillsOpen = false
    skillsBtn.classList.remove('active')
  })

  window.carapaceTerminal.onSkillBrowserClosed(() => {
    skillbrowserOpen = false
    skillbrowserBtn.classList.remove('active')
  })

  modelBtn.addEventListener('click', () => {
    if (!modelSelectorOpen) closeOtherDrawers('modelselector')
    modelSelectorOpen = !modelSelectorOpen
    modelBtn.classList.toggle('active', modelSelectorOpen)
    window.carapaceTerminal.toggleModelSelector()
  })

  window.carapaceTerminal.onModelSelectorClosed(() => {
    modelSelectorOpen = false
    modelBtn.classList.remove('active')
  })

  // When a command is selected from any panel, type it into the active terminal
  window.carapaceTerminal.onTypeCommand((command: string) => {
    if (activeTab === 'claude') {
      window.carapaceTerminal.sendData(command)
      claudeTerminal.focus()
    } else if (shellTerminal) {
      window.carapaceTerminal.shellSendData(command)
      shellTerminal.focus()
    }
  })

  // ─── Open folder ───
  document.getElementById('openfolder-btn')!.addEventListener('click', () => {
    window.carapaceTerminal.openFolder()
  })

  // ─── Title updates from main process ───
  window.carapaceTerminal.onTitleUpdated((newTitle: string) => {
    titlebar.textContent = newTitle
  })

  // ─── Color updates from main process ───
  window.carapaceTerminal.onColorUpdated((newColor: string) => {
    color = newColor
    const newBg = tintedBackground(newColor)
    document.body.style.background = newBg
    titlebar.style.backgroundColor = tintedBackground(newColor, 0.15)
    sidebar.style.backgroundColor = tintedBackground(newColor, 0.1)
    tabbar.style.backgroundColor = tintedBackground(newColor, 0.12)
    const newTheme = {
      background: newBg,
      cursor: newColor,
      cursorAccent: '#000000',
      foreground: '#e2e8f0',
      selectionBackground: newColor + '40',
    }
    claudeTerminal.options.theme = newTheme
    if (shellTerminal) shellTerminal.options.theme = newTheme
  })

  // ─── Slack ───
  document.getElementById('slack-btn')!.addEventListener('click', () => {
    window.carapaceTerminal.slackCompose()
  })

  // ─── Custom snippets ───
  const snippetContainer = document.getElementById('custom-snippets')!

  function renderSnippets(snippets: Snippet[]) {
    snippetContainer.innerHTML = ''

    if (snippets.length > 0) {
      const sep = document.createElement('div')
      sep.className = 'snippet-separator'
      snippetContainer.appendChild(sep)
    }

    for (const snippet of snippets) {
      const btn = document.createElement('button')
      btn.className = 'sidebar-btn'
      btn.title = snippet.label
      btn.textContent = SNIPPET_ICONS[snippet.icon] || SNIPPET_ICONS.bookmark
      btn.style.fontSize = '15px'

      btn.addEventListener('click', () => {
        if (activeTab === 'claude') {
          window.carapaceTerminal.sendData(snippet.prompt)
          claudeTerminal.focus()
        } else if (shellTerminal) {
          window.carapaceTerminal.shellSendData(snippet.prompt)
          shellTerminal.focus()
        }
      })

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        window.carapaceTerminal.snippetContextMenu(snippet.id)
      })

      snippetContainer.appendChild(btn)
    }
  }

  // Load initial snippets
  window.carapaceTerminal.getSnippets().then(renderSnippets)

  // Listen for snippet updates
  window.carapaceTerminal.onSnippetsUpdated(renderSnippets)

  // Add snippet button
  document.getElementById('add-snippet-btn')!.addEventListener('click', () => {
    window.carapaceTerminal.showSnippetDialog()
  })

  // Handle window resize
  const handleResize = () => {
    if (activeTab === 'claude') {
      claudeFit.fit()
      window.carapaceTerminal.resize(claudeTerminal.cols, claudeTerminal.rows)
    } else if (shellTerminal && shellFit) {
      shellFit.fit()
      window.carapaceTerminal.shellResize(shellTerminal.cols, shellTerminal.rows)
    }
  }

  window.addEventListener('resize', handleResize)

  // Focus active terminal
  claudeTerminal.focus()
}

init()
