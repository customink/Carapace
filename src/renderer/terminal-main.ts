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
      getSessionInfo: () => Promise<{ color: string; ptyId: string; shellTabNames?: string[] }>
      saveClipboardImage: (buffer: ArrayBuffer) => Promise<string>
      createShellTab: () => Promise<string | null>
      closeShellTab: (shellId: string) => void
      updateShellTabNames: (names: string[]) => void
      shellSendData: (shellId: string, data: string) => void
      shellResize: (shellId: string, cols: number, rows: number) => void
      onShellData: (callback: (shellId: string, data: string) => void) => () => void
      onShellExit: (callback: (shellId: string, code: number) => void) => () => void
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
      getGitHubUrl: () => Promise<string | null>
      openGitHub: () => void
      githubContextMenu: () => void
      toggleImageGallery: () => void
      onImageGalleryClosed: (callback: () => void) => () => void
      toggleFileTree: () => void
      onFileTreeClosed: (callback: () => void) => () => void
      togglePromptHistory: () => void
      onPromptHistoryClosed: (callback: () => void) => () => void
      openExternal: (url: string) => void
      getPathForFile: (file: File) => string
      getSidebarSettings: () => Promise<{ order: string[] | null; hidden: string[] }>
      saveSidebarOrder: (order: string[]) => void
      saveSidebarHidden: (hidden: string[]) => void
      showSidebarVisibilityMenu: () => void
      onSidebarVisibilityChanged: (callback: (hidden: string[]) => void) => () => void
      showContextMenu: (hasSelection: boolean) => void
      saveAsPreset: () => void
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
    // Shift+Enter → send CSI u sequence so Claude Code inserts a newline
    // Must block both keydown and keypress to prevent xterm from also sending \r
    if (event.shiftKey && (event.key === 'Enter' || event.code === 'Enter')) {
      if (event.type === 'keydown') {
        sendData('\x1b[13;2u')
      }
      return false
    }

    if (event.type !== 'keydown') return true

    if (event.metaKey && event.key === 'c') {
      if (terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection())
        return false
      }
      return true
    }

    if (event.metaKey && event.key === 'k') {
      terminal.clear()
      return false
    }

    if (event.metaKey && event.key === 'v') {
      // preventDefault stops the browser from also firing a paste event,
      // which xterm would pick up and send a second copy via onData
      event.preventDefault()
      navigator.clipboard.readText().then(text => {
        sendData(text)
      })
      return false
    }

    return true
  })
}

function setupContextMenu(terminal: Terminal, element: HTMLElement) {
  element.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    window.carapaceTerminal.showContextMenu(terminal.hasSelection())
  })
}

function setupDragDrop(
  getSendData: () => (data: string) => void,
  getFocus: () => () => void,
) {
  const overlay = document.getElementById('drop-overlay')!
  let dragCounter = 0

  // Only intercept external file drops — let internal drags (sidebar reorder) pass through
  function isExternalFileDrag(e: DragEvent): boolean {
    return !!e.dataTransfer?.types.includes('Files')
  }

  window.addEventListener('dragenter', (e) => {
    if (!isExternalFileDrag(e)) return
    e.preventDefault()
    dragCounter++
    overlay.classList.add('visible')
  }, true)

  window.addEventListener('dragleave', (e) => {
    if (!isExternalFileDrag(e)) return
    e.preventDefault()
    dragCounter--
    if (dragCounter <= 0) { dragCounter = 0; overlay.classList.remove('visible') }
  }, true)

  window.addEventListener('dragover', (e) => {
    if (!isExternalFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }, true)

  window.addEventListener('drop', (e) => {
    if (!isExternalFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragCounter = 0
    overlay.classList.remove('visible')
    if (!e.dataTransfer?.files.length) return
    const paths = Array.from(e.dataTransfer.files)
      .map(f => {
        try { return window.carapaceTerminal.getPathForFile(f) } catch { return '' }
      })
      .filter(Boolean)
    if (paths.length > 0) {
      const escaped = paths.map(p => p.includes(' ') ? `"${p}"` : p).join(' ')
      getSendData()(escaped)
    }
    getFocus()()
  }, true)
}

async function init() {
  const params = new URLSearchParams(window.location.search)
  let color = params.get('color') || '#7C3AED'
  const title = params.get('title') || 'Claude Code'
  const hasShellTab = params.get('shellTab') === '1'
  let savedShellTabNames: string[] | undefined
  try {
    savedShellTabNames = JSON.parse(params.get('shellTabNames') || '')
  } catch { /* no saved names */ }

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

  // ─── Sidebar button reordering + visibility ───
  const reorderableBtns = Array.from(sidebar.querySelectorAll('.sidebar-reorderable')) as HTMLElement[]
  const snippetsSection = document.getElementById('custom-snippets')!
  const addSnippetBtn = document.getElementById('add-snippet-btn')!

  // Button labels for the visibility context menu
  const sidebarLabels: Record<string, string> = {
    notes: 'Notes', skills: 'Slash Commands', skillbrowser: 'Skills',
    filetree: 'File Tree', model: 'Switch Model', github: 'GitHub',
    prompthistory: 'Prompt History', imagegallery: 'Image Gallery',
    openfolder: 'Open Folder', savepreset: 'Save as Preset', slack: 'Share to Slack',
  }

  let hiddenBtns = new Set<string>()

  // Apply saved order and visibility
  const sidebarSettings = await window.carapaceTerminal.getSidebarSettings()
  if (sidebarSettings) {
    if (sidebarSettings.order && Array.isArray(sidebarSettings.order)) {
      const byId = new Map(reorderableBtns.map(btn => [btn.dataset.sidebarId!, btn]))
      for (const id of sidebarSettings.order) {
        const btn = byId.get(id)
        if (btn) sidebar.insertBefore(btn, snippetsSection)
      }
      for (const btn of reorderableBtns) {
        if (!sidebarSettings.order.includes(btn.dataset.sidebarId!)) {
          sidebar.insertBefore(btn, snippetsSection)
        }
      }
    }
    if (sidebarSettings.hidden && Array.isArray(sidebarSettings.hidden)) {
      hiddenBtns = new Set(sidebarSettings.hidden)
      for (const btn of reorderableBtns) {
        const id = btn.dataset.sidebarId!
        // Don't hide github (it has its own display logic)
        if (hiddenBtns.has(id) && id !== 'github') {
          btn.style.display = 'none'
        }
      }
    }
  }

  // Right-click on sidebar background → toggle button visibility
  sidebar.addEventListener('contextmenu', (e) => {
    // Don't interfere with right-clicks on individual buttons that have their own context menus
    const target = e.target as HTMLElement
    if (target.closest('.sidebar-btn')) return

    e.preventDefault()
    // Build a checklist popup via IPC to main process (native menu)
    window.carapaceTerminal.showSidebarVisibilityMenu()
  })

  // Listen for visibility changes from main process (native menu toggles)
  window.carapaceTerminal.onSidebarVisibilityChanged((hidden: string[]) => {
    hiddenBtns = new Set(hidden)
    for (const btn of reorderableBtns) {
      const id = btn.dataset.sidebarId!
      if (id === 'github') continue // github has its own display logic
      btn.style.display = hiddenBtns.has(id) ? 'none' : ''
    }
  })

  // Drag-and-drop reordering
  let draggedBtn: HTMLElement | null = null
  for (const btn of reorderableBtns) {
    btn.draggable = true

    btn.addEventListener('dragstart', (e) => {
      draggedBtn = btn
      btn.classList.add('dragging')
      e.dataTransfer!.effectAllowed = 'move'
      e.dataTransfer!.setData('text/plain', btn.dataset.sidebarId!)
    })

    btn.addEventListener('dragend', () => {
      btn.classList.remove('dragging')
      sidebar.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'))
      draggedBtn = null
    })

    btn.addEventListener('dragover', (e) => {
      if (!draggedBtn || draggedBtn === btn) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'move'
      btn.classList.add('drag-over')
    })

    btn.addEventListener('dragleave', () => {
      btn.classList.remove('drag-over')
    })

    btn.addEventListener('drop', (e) => {
      e.preventDefault()
      btn.classList.remove('drag-over')
      if (!draggedBtn || draggedBtn === btn) return

      // Reorder in DOM
      const allBtns = Array.from(sidebar.querySelectorAll('.sidebar-reorderable')) as HTMLElement[]
      const fromIdx = allBtns.indexOf(draggedBtn)
      const toIdx = allBtns.indexOf(btn)
      if (fromIdx < 0 || toIdx < 0) return

      if (fromIdx < toIdx) {
        sidebar.insertBefore(draggedBtn, btn.nextSibling)
      } else {
        sidebar.insertBefore(draggedBtn, btn)
      }

      // Save new order
      const newOrder = Array.from(sidebar.querySelectorAll('.sidebar-reorderable'))
        .map(el => (el as HTMLElement).dataset.sidebarId!)
      window.carapaceTerminal.saveSidebarOrder(newOrder)
    })
  }

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

  // ─── Link handler for OSC 8 hyperlinks (used by Claude Code) ───
  const linkHandler = {
    activate: (_e: MouseEvent, url: string) => {
      window.carapaceTerminal.openExternal(url)
    },
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
    linkHandler,
  })

  claudeTerminal.loadAddon(claudeFit)
  claudeTerminal.loadAddon(new WebLinksAddon((_e, url) => window.carapaceTerminal.openExternal(url)))
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
  setupContextMenu(claudeTerminal, document.getElementById('terminal')!)

  // ─── Multi-shell tab system ───
  interface ShellTab {
    id: string
    name: string
    terminal: Terminal
    fitAddon: FitAddon
    paneEl: HTMLElement
    tabEl: HTMLElement
  }

  const shellTabs: ShellTab[] = []
  let activeTab = 'claude'  // 'claude' or a shellPtyId
  let shellCounter = 0

  function persistShellTabNames() {
    window.carapaceTerminal.updateShellTabNames(shellTabs.map(t => t.name))
  }
  const terminalContainer = document.getElementById('terminal-container')!
  const claudeTab = document.getElementById('tab-claude')!
  const claudePane = document.getElementById('terminal')!
  const addTabBtn = document.getElementById('add-tab-btn')!

  function getActiveShellTab(): ShellTab | undefined {
    return shellTabs.find(t => t.id === activeTab)
  }

  function switchTab(tabId: string) {
    activeTab = tabId
    claudeTab.classList.toggle('active', tabId === 'claude')
    claudePane.classList.toggle('active', tabId === 'claude')
    for (const st of shellTabs) {
      st.tabEl.classList.toggle('active', st.id === tabId)
      st.paneEl.classList.toggle('active', st.id === tabId)
    }
    if (tabId === 'claude') {
      claudeFit.fit()
      window.carapaceTerminal.resize(claudeTerminal.cols, claudeTerminal.rows)
      claudeTerminal.focus()
    } else {
      const tab = getActiveShellTab()
      if (tab) {
        tab.fitAddon.fit()
        window.carapaceTerminal.shellResize(tab.id, tab.terminal.cols, tab.terminal.rows)
        tab.terminal.focus()
      }
    }
  }

  function addShellTab(shellPtyId: string, tabName?: string) {
    shellCounter++

    const name = tabName || `Tab ${shellCounter}`

    // Create tab element
    const tabEl = document.createElement('div')
    tabEl.className = 'tab'
    tabEl.dataset.shellId = shellPtyId
    tabEl.innerHTML = `<span class="tab-icon">&#10095;</span><span class="tab-label">${name}</span><button class="tab-close" title="Close">&times;</button>`
    tabbar.insertBefore(tabEl, addTabBtn)

    // Create terminal pane
    const paneEl = document.createElement('div')
    paneEl.className = 'terminal-pane'
    terminalContainer.appendChild(paneEl)

    // Create terminal
    const fitAddon = new FitAddon()
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      theme,
      allowProposedApi: true,
      linkHandler,
    })
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon((_e, url) => window.carapaceTerminal.openExternal(url)))
    terminal.open(paneEl)
    setupCopyPaste(terminal, (data) => window.carapaceTerminal.shellSendData(shellPtyId, data))
    setupContextMenu(terminal, paneEl)

    terminal.onData((data) => {
      window.carapaceTerminal.shellSendData(shellPtyId, data)
    })

    const tab: ShellTab = { id: shellPtyId, name, terminal, fitAddon, paneEl, tabEl }
    shellTabs.push(tab)

    // Tab click
    tabEl.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('tab-close')) return
      switchTab(shellPtyId)
    })

    // Right-click to rename (inline edit)
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const labelEl = tabEl.querySelector('.tab-label') as HTMLElement
      if (!labelEl) return
      labelEl.contentEditable = 'true'
      labelEl.focus()
      // Select all text
      const range = document.createRange()
      range.selectNodeContents(labelEl)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)

      const finishEdit = () => {
        labelEl.contentEditable = 'false'
        const newName = labelEl.textContent?.trim()
        if (newName) {
          tab.name = newName
          labelEl.textContent = newName
        } else {
          labelEl.textContent = tab.name
        }
        persistShellTabNames()
        labelEl.removeEventListener('blur', finishEdit)
        labelEl.removeEventListener('keydown', onKey)
      }
      const onKey = (ke: KeyboardEvent) => {
        if (ke.key === 'Enter') { ke.preventDefault(); labelEl.blur() }
        if (ke.key === 'Escape') { labelEl.textContent = tab.name; labelEl.blur() }
      }
      labelEl.addEventListener('blur', finishEdit)
      labelEl.addEventListener('keydown', onKey)
    })

    // Close button
    tabEl.querySelector('.tab-close')!.addEventListener('click', () => {
      removeShellTab(shellPtyId)
    })

    // Switch to new tab
    switchTab(shellPtyId)

    requestAnimationFrame(() => {
      fitAddon.fit()
      window.carapaceTerminal.shellResize(shellPtyId, terminal.cols, terminal.rows)
      terminal.focus()
    })

    persistShellTabNames()
  }

  function removeShellTab(shellPtyId: string) {
    const idx = shellTabs.findIndex(t => t.id === shellPtyId)
    if (idx < 0) return
    const tab = shellTabs[idx]
    tab.terminal.dispose()
    tab.paneEl.remove()
    tab.tabEl.remove()
    shellTabs.splice(idx, 1)
    window.carapaceTerminal.closeShellTab(shellPtyId)
    persistShellTabNames()

    if (activeTab === shellPtyId) {
      switchTab(shellTabs.length > 0 ? shellTabs[shellTabs.length - 1].id : 'claude')
    }
    if (shellTabs.length === 0) {
      // Tab bar stays visible — "+" button always accessible
    }
  }

  // Route shell data to correct terminal
  window.carapaceTerminal.onShellData((shellId, data) => {
    const tab = shellTabs.find(t => t.id === shellId)
    if (tab) tab.terminal.write(data)
  })

  window.carapaceTerminal.onShellExit((shellId) => {
    const tab = shellTabs.find(t => t.id === shellId)
    if (tab) tab.terminal.write('\r\n\x1b[90m[Shell exited]\x1b[0m\r\n')
  })

  // "+" button to add shell tabs
  addTabBtn.addEventListener('click', async () => {
    const shellId = await window.carapaceTerminal.createShellTab()
    if (shellId) addShellTab(shellId)
  })

  // Claude tab click
  claudeTab.addEventListener('click', () => switchTab('claude'))

  // Keyboard shortcut: Cmd+Shift+] and Cmd+Shift+[ to cycle tabs
  document.addEventListener('keydown', (e) => {
    if (!e.metaKey || !e.shiftKey) return
    const allTabIds = ['claude', ...shellTabs.map(t => t.id)]
    const curIdx = allTabIds.indexOf(activeTab)
    if (e.key === ']') {
      e.preventDefault()
      switchTab(allTabIds[(curIdx + 1) % allTabIds.length])
    }
    if (e.key === '[') {
      e.preventDefault()
      switchTab(allTabIds[(curIdx - 1 + allTabIds.length) % allTabIds.length])
    }
  })

  // Create initial shell tabs (restore saved tabs or create one if shellTab flag set)
  const tabNamesToRestore = savedShellTabNames && savedShellTabNames.length > 0
    ? savedShellTabNames
    : hasShellTab ? [undefined] : []

  for (const name of tabNamesToRestore) {
    const shellId = await window.carapaceTerminal.createShellTab()
    if (shellId) addShellTab(shellId, name)
  }
  if (tabNamesToRestore.length > 0) {
    switchTab('claude')
  }

  // Paste images from clipboard (text paste is handled by setupCopyPaste)
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
    const shellTab = getActiveShellTab()
    if (activeTab === 'claude') {
      window.carapaceTerminal.sendData(filePath)
      claudeTerminal.focus()
    } else if (shellTab) {
      window.carapaceTerminal.shellSendData(shellTab.id, filePath)
      shellTab.terminal.focus()
    }
  })

  // ─── Drag-drop files into terminal (window-level capture) ───
  setupDragDrop(
    () => {
      const st = getActiveShellTab()
      return st
        ? (data: string) => window.carapaceTerminal.shellSendData(st.id, data)
        : (data: string) => window.carapaceTerminal.sendData(data)
    },
    () => {
      const st = getActiveShellTab()
      return st ? () => st.terminal.focus() : () => claudeTerminal.focus()
    },
  )

  // ─── Sidebar drawers (only one open at a time) ───
  const notesBtn = document.getElementById('notes-btn')!
  const skillsBtn = document.getElementById('skills-btn')!
  const skillbrowserBtn = document.getElementById('skillbrowser-btn')!
  const imagegalleryBtn = document.getElementById('imagegallery-btn')!
  const filetreeBtn = document.getElementById('filetree-btn')!
  const prompthistoryBtn = document.getElementById('prompthistory-btn')!
  const modelBtn = document.getElementById('model-btn')!
  let notesOpen = false
  let skillsOpen = false
  let skillbrowserOpen = false
  let imagegalleryOpen = false
  let filetreeOpen = false
  let prompthistoryOpen = false
  let modelSelectorOpen = false

  function closeOtherDrawers(except: 'notes' | 'skills' | 'skillbrowser' | 'imagegallery' | 'filetree' | 'prompthistory' | 'modelselector') {
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
    if (except !== 'imagegallery' && imagegalleryOpen) {
      imagegalleryOpen = false
      imagegalleryBtn.classList.remove('active')
      window.carapaceTerminal.toggleImageGallery()
    }
    if (except !== 'filetree' && filetreeOpen) {
      filetreeOpen = false
      filetreeBtn.classList.remove('active')
      window.carapaceTerminal.toggleFileTree()
    }
    if (except !== 'prompthistory' && prompthistoryOpen) {
      prompthistoryOpen = false
      prompthistoryBtn.classList.remove('active')
      window.carapaceTerminal.togglePromptHistory()
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

  imagegalleryBtn.addEventListener('click', () => {
    if (!imagegalleryOpen) closeOtherDrawers('imagegallery')
    imagegalleryOpen = !imagegalleryOpen
    imagegalleryBtn.classList.toggle('active', imagegalleryOpen)
    window.carapaceTerminal.toggleImageGallery()
  })

  window.carapaceTerminal.onImageGalleryClosed(() => {
    imagegalleryOpen = false
    imagegalleryBtn.classList.remove('active')
  })

  filetreeBtn.addEventListener('click', () => {
    if (!filetreeOpen) closeOtherDrawers('filetree')
    filetreeOpen = !filetreeOpen
    filetreeBtn.classList.toggle('active', filetreeOpen)
    window.carapaceTerminal.toggleFileTree()
  })

  window.carapaceTerminal.onFileTreeClosed(() => {
    filetreeOpen = false
    filetreeBtn.classList.remove('active')
  })

  prompthistoryBtn.addEventListener('click', () => {
    if (!prompthistoryOpen) closeOtherDrawers('prompthistory')
    prompthistoryOpen = !prompthistoryOpen
    prompthistoryBtn.classList.toggle('active', prompthistoryOpen)
    window.carapaceTerminal.togglePromptHistory()
  })

  window.carapaceTerminal.onPromptHistoryClosed(() => {
    prompthistoryOpen = false
    prompthistoryBtn.classList.remove('active')
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
    const st = getActiveShellTab()
    if (activeTab === 'claude' || !st) {
      window.carapaceTerminal.sendData(command)
      claudeTerminal.focus()
    } else {
      window.carapaceTerminal.shellSendData(st.id, command)
      st.terminal.focus()
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
    for (const st of shellTabs) st.terminal.options.theme = newTheme
  })

  // ─── GitHub ───
  const githubBtn = document.getElementById('github-btn')!
  window.carapaceTerminal.getGitHubUrl().then(url => {
    if (url) githubBtn.style.display = ''
  })
  githubBtn.addEventListener('click', () => {
    window.carapaceTerminal.openGitHub()
  })
  githubBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    window.carapaceTerminal.githubContextMenu()
  })

  // ─── Save as Preset ───
  document.getElementById('savepreset-btn')!.addEventListener('click', () => {
    window.carapaceTerminal.saveAsPreset()
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
      btn.textContent = SNIPPET_ICONS[snippet.icon] || snippet.icon || SNIPPET_ICONS.bookmark
      btn.style.fontSize = '15px'

      btn.addEventListener('click', () => {
        const st = getActiveShellTab()
        if (activeTab === 'claude' || !st) {
          window.carapaceTerminal.sendData(snippet.prompt)
          claudeTerminal.focus()
        } else {
          window.carapaceTerminal.shellSendData(st.id, snippet.prompt)
          st.terminal.focus()
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
    } else {
      const st = getActiveShellTab()
      if (st) {
        st.fitAddon.fit()
        window.carapaceTerminal.shellResize(st.id, st.terminal.cols, st.terminal.rows)
      }
    }
  }

  window.addEventListener('resize', handleResize)

  // Focus active terminal
  claudeTerminal.focus()
}

init()
