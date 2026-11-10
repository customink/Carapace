import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { createWrappedLinkProvider } from './wrapped-links'
import '@xterm/xterm/css/xterm.css'
import { SNIPPET_ICONS } from '@shared/constants/snippet-icons'
import type { Snippet } from '@shared/types/snippet'
import type { ConversationLink } from '@shared/types/conversation-link'

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
      getInputBuffer: () => Promise<string>
      clearPrompt: () => void
      queryFileTreeDrag: () => Promise<string | null>
      saveAsPreset: () => void
      slackCompose: () => void
      onTitleUpdated: (callback: (title: string) => void) => () => void
      onColorUpdated: (callback: (color: string) => void) => () => void
      getLinks: () => Promise<ConversationLink[] | null>
      removeLink: (url: string) => void
      clearLinks: (kind: ConversationLink['kind']) => void
      openLink: (url: string) => void
      copyLink: (url: string) => void
      copyMessage: (rows: string[], mode: 'block' | 'message') => Promise<string | null>
      onLinksUpdated: (callback: (links: ConversationLink[]) => void) => () => void
      toggleStacks: () => void
      onStacksClosed: (callback: () => void) => () => void
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

// Claude Code's CLI wraps its own prose (hanging-indent bullets, etc.) with hard
// newlines rather than relying on the terminal's native autowrap, so xterm's
// isWrapped flag is false for those rows. Copying them verbatim produces a
// ragged mess when pasted elsewhere (e.g. Slack). We reflow: a row whose text
// comes within word-wrap slack of the row's full width is treated as a
// soft-wrapped continuation and joined with a space; everything else keeps a
// real newline. Word-wrap breaks at the last space that fits, so a wrapped
// row essentially never lands exactly on the last column — it falls short by
// up to about one word's width, hence the tolerance rather than an exact match.
// `cleanRow` post-processes each row's text (e.g. stripping gutter glyphs) after the
// fullness check, which must see the row as rendered.
function reflowRows(
  terminal: Terminal,
  start: { x: number; y: number },
  end: { x: number; y: number },
  cleanRow: (text: string) => string = t => t,
): string {
  const buf = terminal.buffer.active
  const rows: { text: string; isWrapped: boolean; full: boolean }[] = []

  for (let y = start.y; y <= end.y; y++) {
    const line = buf.getLine(y)
    if (!line) continue
    const startCol = y === start.y ? start.x : 0
    const endCol = y === end.y ? end.x : line.length
    const text = line.translateToString(true, startCol, endCol)
    const spanWidth = endCol - startCol
    const slack = Math.min(24, Math.ceil(spanWidth * 0.25))
    const full = endCol === line.length && spanWidth - text.length <= slack
    rows.push({ text: cleanRow(text), isWrapped: line.isWrapped, full })
  }

  if (rows.length === 0) return ''

  let result = rows[0].text
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]
    const curr = rows[i]
    if (curr.isWrapped) {
      // Genuine terminal-native wrap: no character (including spaces) was lost.
      result += curr.text
    } else if (prev.full && curr.text.length > 0) {
      result += ' ' + curr.text
    } else {
      result += '\n' + curr.text
    }
  }

  return result.trimEnd()
}

function setupCopyPaste(terminal: Terminal, sendData: (data: string) => void) {
  function getCleanSelection(): string {
    const pos = terminal.getSelectionPosition()
    return pos ? reflowRows(terminal, pos.start, pos.end) : ''
  }

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
        navigator.clipboard.writeText(getCleanSelection())
        return false
      }
      return true
    }

    if (event.metaKey && event.key === 'k') {
      terminal.clear()
      return false
    }

    // Cmd+Backspace → delete entire line (send Ctrl+U)
    if (event.metaKey && event.key === 'Backspace') {
      sendData('\x15')
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

  // Accept file drops AND text/plain drops (from file tree cross-window drag)
  function isExternalFileDrag(e: DragEvent): boolean {
    if (e.dataTransfer?.types.includes('text/plain')) return true
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

    // Check for text/plain drop (from file tree cross-window drag)
    const textPath = e.dataTransfer?.getData('text/plain')
    if (textPath && textPath.startsWith('/')) {
      const escaped = textPath.includes(' ') ? `"${textPath}"` : textPath
      getSendData()(escaped + ' ')
      getFocus()()
      return
    }

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
    stacks: 'Stacks',
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
  claudeTerminal.registerLinkProvider(createWrappedLinkProvider(claudeTerminal, window.carapaceTerminal.openExternal))
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
  const linkPills = document.getElementById('link-pills')!
  const claudeTab = document.getElementById('tab-claude')!
  const claudePane = document.getElementById('terminal')!
  const addTabBtn = document.getElementById('add-tab-btn')!

  function getActiveShellTab(): ShellTab | undefined {
    return shellTabs.find(t => t.id === activeTab)
  }

  function switchTab(tabId: string) {
    activeTab = tabId
    linkPills.classList.toggle('off-tab', tabId !== 'claude')
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
    terminal.registerLinkProvider(createWrappedLinkProvider(terminal, window.carapaceTerminal.openExternal))
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

  // Copy prompt to clipboard
  document.getElementById('copy-prompt-btn')!.addEventListener('click', async (e) => {
    e.stopPropagation()
    const text = await window.carapaceTerminal.getInputBuffer()
    if (text) {
      await navigator.clipboard.writeText(text)
    }
  })

  // Clear prompt
  document.getElementById('clear-prompt-btn')!.addEventListener('click', (e) => {
    e.stopPropagation()
    window.carapaceTerminal.clearPrompt()
    claudeTerminal.focus()
  })

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
  const stacksBtn = document.getElementById('stacks-btn')!
  let notesOpen = false
  let skillsOpen = false
  let skillbrowserOpen = false
  let imagegalleryOpen = false
  let filetreeOpen = false
  let prompthistoryOpen = false
  let modelSelectorOpen = false
  let stacksOpen = false

  function closeOtherDrawers(except: 'notes' | 'skills' | 'skillbrowser' | 'imagegallery' | 'filetree' | 'prompthistory' | 'modelselector' | 'stacks') {
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
    if (except !== 'stacks' && stacksOpen) {
      stacksOpen = false
      stacksBtn.classList.remove('active')
      window.carapaceTerminal.toggleStacks()
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

  stacksBtn.addEventListener('click', () => {
    if (!stacksOpen) closeOtherDrawers('stacks')
    stacksOpen = !stacksOpen
    stacksBtn.classList.toggle('active', stacksOpen)
    window.carapaceTerminal.toggleStacks()
  })

  window.carapaceTerminal.onStacksClosed(() => {
    stacksOpen = false
    stacksBtn.classList.remove('active')
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
    applyLinkPillColor(newColor)
  })

  // ─── Conversation links (PR / Jira half-pills, top right) ───
  // Link labels come from conversation text (Slack, PR bodies, web pages) — untrusted, so the
  // list is built with createElement/textContent only. This window can type into the PTY.
  // Set on the container so the half-pills and the message-copy toolbar share them.
  // Same tinted family as the tab bar / titlebar (session color scaled toward black), a
  // step brighter so the pill reads as a control, with the raw color for the edge and icon
  function applyLinkPillColor(hex: string) {
    const { r, g, b } = hexToRgb(hex)
    const tint = (k: number, a: number) => `rgba(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)}, ${a})`
    terminalContainer.style.setProperty('--pill-bg', tint(0.3, 0.85))
    terminalContainer.style.setProperty('--pill-bg-hover', tint(0.42, 0.95))
    terminalContainer.style.setProperty('--pill-border', `rgba(${r}, ${g}, ${b}, 0.4)`)
    // Copy highlight: lifted toward white so dark session colors still show on the dark background
    const lift = (k: number, a: number) => `rgba(${Math.round(r + (255 - r) * k)}, ${Math.round(g + (255 - g) * k)}, ${Math.round(b + (255 - b) * k)}, ${a})`
    terminalContainer.style.setProperty('--copy-hl', lift(0.25, 0.3))
    terminalContainer.style.setProperty('--copy-hl-ring', lift(0.4, 0.55))
    terminalContainer.style.setProperty('--copy-hl-edge', lift(0.5, 1))
    terminalContainer.style.setProperty('--pill-fg', `rgb(${Math.round(r + (255 - r) * 0.45)}, ${Math.round(g + (255 - g) * 0.45)}, ${Math.round(b + (255 - b) * 0.45)})`)
  }

  function copyIcon(): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('width', '12'); svg.setAttribute('height', '12'); svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('fill', 'none')
    const rect = document.createElementNS(ns, 'rect')
    for (const [k, v] of [['x', '5'], ['y', '5'], ['width', '8'], ['height', '8'], ['rx', '1'], ['stroke', 'currentColor'], ['stroke-width', '1.3']]) rect.setAttribute(k!, v!)
    const path = document.createElementNS(ns, 'path')
    for (const [k, v] of [['d', 'M3 10V3.5a.5.5 0 0 1 .5-.5H10'], ['stroke', 'currentColor'], ['stroke-width', '1.3'], ['stroke-linecap', 'round']]) path.setAttribute(k!, v!)
    svg.append(rect, path)
    return svg
  }

  // "Clear all" asks for a second click: cleared links stay dismissed and never come back
  for (const group of Array.from(linkPills.querySelectorAll<HTMLElement>('.link-group'))) {
    const clear = group.querySelector<HTMLButtonElement>('.link-clear')!
    let confirmTimer: ReturnType<typeof setTimeout> | null = null
    const reset = () => {
      if (confirmTimer) clearTimeout(confirmTimer)
      confirmTimer = null
      clear.classList.remove('confirm')
      clear.textContent = 'Clear all'
    }
    clear.addEventListener('click', () => {
      if (!clear.classList.contains('confirm')) {
        clear.classList.add('confirm')
        clear.textContent = 'Click to confirm'
        confirmTimer = setTimeout(reset, 3000)
        return
      }
      reset()
      const kind = group.dataset.kind as ConversationLink['kind']
      window.carapaceTerminal.clearLinks(kind)
      currentLinks = currentLinks.filter(l => l.kind !== kind)
      renderLinks(currentLinks)
      claudeTerminal.focus()
    })
    group.addEventListener('mouseleave', reset)
  }

  function renderLinks(links: ConversationLink[]) {
    for (const group of Array.from(linkPills.querySelectorAll<HTMLElement>('.link-group'))) {
      const items = links
        .filter(l => l.kind === group.dataset.kind)
        .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen))
      group.classList.toggle('has-links', items.length > 0)
      const list = group.querySelector('.link-list')!
      list.replaceChildren(...items.map(link => {
        const row = document.createElement('div')
        row.className = 'link-row'

        const label = document.createElement('button')
        label.className = 'link-label'
        label.title = link.title ? `${link.title}\n${link.url}` : link.url
        if (link.title) {
          label.classList.add('has-title')
          const key = document.createElement('span')
          key.className = 'link-key'
          key.textContent = link.label
          const titleBox = document.createElement('span')
          titleBox.className = 'link-title'
          const titleText = document.createElement('span')
          titleText.className = 'link-title-inner'
          titleText.textContent = link.title
          titleBox.append(titleText)
          label.append(key, titleBox)
        } else {
          label.textContent = link.label
        }
        label.addEventListener('click', () => openLink(link.url))

        const open = document.createElement('button')
        open.className = 'link-action'
        open.title = link.kind === 'file' ? (link.label.endsWith('/') ? 'Open in Finder' : 'Open') : 'Open in browser'
        open.textContent = '↗'
        open.addEventListener('click', () => openLink(link.url))

        const copy = document.createElement('button')
        copy.className = 'link-action'
        copy.title = link.kind === 'file' ? 'Copy path' : 'Copy link'
        copy.append(copyIcon())
        copy.addEventListener('click', () => {
          window.carapaceTerminal.copyLink(link.url)
          copy.replaceChildren('✓')
          copy.classList.add('done')
          setTimeout(() => { copy.replaceChildren(copyIcon()); copy.classList.remove('done') }, 1200)
        })

        const del = document.createElement('button')
        del.className = 'link-action delete'
        del.title = 'Remove from this list'
        del.textContent = '×'
        del.addEventListener('click', () => {
          window.carapaceTerminal.removeLink(link.url)
          currentLinks = currentLinks.filter(l => l.url !== link.url)
          renderLinks(currentLinks)
          claudeTerminal.focus()
        })

        row.append(label, open, copy, del)
        return row
      }))
    }
  }

  // Titles that overflow scroll; that can only be measured once the flyout is visible
  for (const group of Array.from(linkPills.querySelectorAll<HTMLElement>('.link-group'))) {
    group.addEventListener('mouseenter', () => requestAnimationFrame(() => {
      for (const box of Array.from(group.querySelectorAll<HTMLElement>('.link-title'))) {
        const inner = box.firstElementChild as HTMLElement
        const distance = inner.scrollWidth - box.clientWidth
        box.classList.toggle('scroll', distance > 0)
        if (distance > 0) {
          box.style.setProperty('--scroll-distance', `${distance}px`)
          box.style.setProperty('--scroll-duration', `${Math.max(3, distance / 35)}s`)
        }
      }
    }))
  }

  // ─── Hover copy for Claude's messages ───
  // The screen shows Claude's markdown rendered: hard-wrapped, indented, with `●` / `│`
  // gutters. Hovering a message offers clean copies of the hovered block or the whole message;
  // main matches the rows against the transcript and copies the source as plain text.
  const messageCopy = document.getElementById('message-copy')!
  const copyHighlight = document.getElementById('copy-highlight')!
  type RowKind = 'blank' | 'quote' | 'quoteBlank' | 'msgStart' | 'text' | 'stop'
  // Claude Code's message bullet is ⏺ (U+23FA) on macOS and ● (U+25CF) elsewhere
  const GUTTER_RE = /^\s*(?:[⏺●⎿│▎]\s?)*/

  function rowText(y: number): string {
    return claudeTerminal.buffer.active.getLine(y)?.translateToString(true) ?? ''
  }

  function rowKind(y: number): RowKind {
    const t = rowText(y).trim()
    if (!t) return 'blank'
    if (t.startsWith('│')) return t.replace(/^│/, '').trim() ? 'quote' : 'quoteBlank'
    // Prompt rows, tool calls (`● Bash(`) and their output (`⎿`), status lines, rules/boxes
    if (/^(❯|>\s|⎿|[*✻✽✶✳✢✺✹]\s|[─━╭╰┌└])/.test(t)) return 'stop'
    if (/^[⏺●]\s*[\w.:-]+\(/.test(t)) return 'stop'
    if (/^[⏺●]/.test(t)) return 'msgStart'
    return 'text'
  }

  /** Rows of the Claude message containing row y, or null if y isn't inside one */
  function messageRange(y: number): { start: number; end: number } | null {
    let start = y
    for (let n = 0; ; n++) {
      if (n > 3000) return null
      const kind = rowKind(start)
      if (kind === 'msgStart') break
      if (kind === 'stop') return null
      // The message's ⏺ row scrolled out of the scrollback: the top of the buffer is as far as it goes
      if (start === 0) break
      start--
    }
    const last = claudeTerminal.buffer.active.length - 1
    let end = y
    while (end < last && end - start < 3000) {
      const kind = rowKind(end + 1)
      if (kind === 'msgStart' || kind === 'stop') break
      end++
    }
    while (end > start && rowKind(end) === 'blank') end--
    return { start, end }
  }

  /** The paragraph / list / quote containing row y (quotes: contiguous `│` rows, blank `│` included) */
  function blockRange(y: number, msg: { start: number; end: number }): { start: number; end: number } {
    const inQuote = (k: RowKind) => k === 'quote' || k === 'quoteBlank'
    const quote = inQuote(rowKind(y))
    const belongs = (k: RowKind) => quote ? inQuote(k) : k === 'text' || k === 'msgStart'
    let start = y
    while (start > msg.start && rowKind(start) !== 'msgStart' && belongs(rowKind(start - 1))) start--
    let end = y
    while (end < msg.end && belongs(rowKind(end + 1)) && rowKind(end + 1) !== 'msgStart') end++
    return { start, end }
  }

  let hovered: { block: { start: number; end: number }; msg: { start: number; end: number } } | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let moveFrame = 0

  function hideMessageCopy(delay = 0) {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (messageCopy.matches(':hover')) return
      messageCopy.classList.remove('visible')
      copyHighlight.classList.remove('visible')
      hovered = null
    }, delay)
  }

  claudePane.addEventListener('mousemove', (e) => {
    if (moveFrame) return
    const { clientX, clientY } = e
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0
      if (activeTab !== 'claude' || claudeTerminal.hasSelection()) return hideMessageCopy()
      const screen = claudePane.querySelector('.xterm-screen')
      if (!screen) return
      const rect = screen.getBoundingClientRect()
      if (clientX < rect.left || clientX > rect.right) return
      const cellHeight = rect.height / claudeTerminal.rows
      const viewportY = claudeTerminal.buffer.active.viewportY
      const y = viewportY + Math.floor((clientY - rect.top) / cellHeight)
      const kind = rowKind(y)
      if (kind === 'blank') return // between paragraphs: keep whatever is showing
      const msg = kind === 'stop' ? null : messageRange(y)
      if (!msg) return hideMessageCopy(250)
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
      const block = blockRange(y, msg)
      hovered = { block, msg }
      const containerTop = terminalContainer.getBoundingClientRect().top
      const anchorRow = Math.max(block.start, viewportY)
      messageCopy.style.top = `${rect.top - containerTop + (anchorRow - viewportY) * cellHeight - 2}px`
      messageCopy.classList.add('visible')
    })
  })
  claudePane.addEventListener('mouseleave', () => hideMessageCopy(400))
  messageCopy.addEventListener('mouseleave', () => hideMessageCopy(250))
  claudeTerminal.onScroll(() => hideMessageCopy())
  // Don't start an xterm selection or move focus when clicking the buttons
  messageCopy.addEventListener('mousedown', (e) => e.preventDefault())

  /** Tint the visible part of a row range — what the hovered button will copy */
  function showCopyHighlight(range: { start: number; end: number }) {
    const screen = claudePane.querySelector('.xterm-screen')
    if (!screen) return
    const rect = screen.getBoundingClientRect()
    const containerRect = terminalContainer.getBoundingClientRect()
    const cellHeight = rect.height / claudeTerminal.rows
    const viewportY = claudeTerminal.buffer.active.viewportY
    const first = Math.max(range.start, viewportY)
    const last = Math.min(range.end, viewportY + claudeTerminal.rows - 1)
    if (last < first) return copyHighlight.classList.remove('visible')
    copyHighlight.style.top = `${rect.top - containerRect.top + (first - viewportY) * cellHeight}px`
    copyHighlight.style.height = `${(last - first + 1) * cellHeight}px`
    copyHighlight.style.left = `${rect.left - containerRect.left - 4}px`
    copyHighlight.style.width = `${rect.width + 4}px`
    copyHighlight.classList.add('visible')
  }

  const stripGutter = (text: string) => text.replace(GUTTER_RE, '')
  for (const btn of Array.from(messageCopy.querySelectorAll<HTMLButtonElement>('.message-copy-btn'))) {
    btn.addEventListener('mouseenter', () => {
      if (hovered) showCopyHighlight(btn.dataset.mode === 'block' ? hovered.block : hovered.msg)
    })
    btn.addEventListener('mouseleave', () => copyHighlight.classList.remove('visible'))
    btn.addEventListener('click', async () => {
      if (!hovered) return
      const mode = btn.dataset.mode as 'block' | 'message'
      const range = mode === 'block' ? hovered.block : hovered.msg
      const rows: string[] = []
      for (let y = hovered.block.start; y <= hovered.block.end; y++) rows.push(stripGutter(rowText(y)).trim())
      let text = await window.carapaceTerminal.copyMessage(rows, mode)
      if (!text) {
        // Not in the transcript yet (still streaming) or too short to match: reflow the screen text
        const endLine = claudeTerminal.buffer.active.getLine(range.end)
        text = reflowRows(claudeTerminal, { x: 0, y: range.start }, { x: endLine?.length ?? 0, y: range.end }, stripGutter)
        await navigator.clipboard.writeText(text)
      }
      btn.classList.add('done')
      setTimeout(() => btn.classList.remove('done'), 1200)
    })
  }

  function openLink(url: string) {
    window.carapaceTerminal.openLink(url)
    claudeTerminal.focus()
  }

  let currentLinks: ConversationLink[] = []
  applyLinkPillColor(color)
  window.carapaceTerminal.onLinksUpdated((links) => {
    currentLinks = links
    renderLinks(links)
  })
  // The PTY is created asynchronously after page load; null means "not yet" — retry briefly
  ;(async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const links = await window.carapaceTerminal.getLinks()
      if (links) {
        currentLinks = links
        renderLinks(links)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  })()

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

  // ─── Agent Teams Dashboard ───
  const teamdashBtn = document.getElementById('teamdash-btn')!
  teamdashBtn.addEventListener('click', () => {
    teamdashBtn.classList.toggle('active')
    window.carapaceTerminal.toggleTeamDashboard()
  })
  window.carapaceTerminal.onTeamDashClosed(() => {
    teamdashBtn.classList.remove('active')
  })

  // ─── Share Context ───
  document.getElementById('sharecontext-btn')!.addEventListener('click', () => {
    window.carapaceTerminal.shareContext()
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

  // Check for pending file tree drag when terminal gets focus or click
  // This handles the cross-window "drag" from file tree to terminal
  window.addEventListener('focus', async () => {
    const path = await window.carapaceTerminal.queryFileTreeDrag()
    if (path) {
      const escaped = path.includes(' ') ? `"${path}"` : path
      const st = getActiveShellTab()
      if (activeTab === 'claude' || !st) {
        window.carapaceTerminal.sendData(escaped + ' ')
        claudeTerminal.focus()
      } else {
        window.carapaceTerminal.shellSendData(st.id, escaped + ' ')
        st.terminal.focus()
      }
    }
  })

  // Focus active terminal
  claudeTerminal.focus()
}

init()
