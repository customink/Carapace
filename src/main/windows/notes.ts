import { BrowserWindow, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const NOTES_DIR = path.join(os.homedir(), '.claude', 'usage-data', 'session-notes')

/** Map of terminal windowId → notes BrowserWindow */
const notesWindows = new Map<number, BrowserWindow>()

function ensureNotesDir(): void {
  fs.mkdirSync(NOTES_DIR, { recursive: true })
}

function notesPath(ptyId: string): string {
  return path.join(NOTES_DIR, `${ptyId}.txt`)
}

function loadNotes(ptyId: string): string {
  try {
    return fs.readFileSync(notesPath(ptyId), 'utf-8')
  } catch {
    return ''
  }
}

function saveNotes(ptyId: string, content: string): void {
  ensureNotesDir()
  fs.writeFileSync(notesPath(ptyId), content, 'utf-8')
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

const NOTES_WIDTH = 280
const GAP = 0

export function toggleNotesWindow(parentWin: BrowserWindow, ptyId: string, color: string): boolean {
  const existing = notesWindows.get(parentWin.id)
  if (existing && !existing.isDestroyed()) {
    existing.close()
    notesWindows.delete(parentWin.id)
    return false
  }

  const parentBounds = parentWin.getBounds()
  const bgColor = tintedBackground(color, 0.06)

  const notes = new BrowserWindow({
    width: NOTES_WIDTH,
    height: parentBounds.height,
    x: parentBounds.x - NOTES_WIDTH - GAP,
    y: parentBounds.y,
    frame: false,
    transparent: false,
    backgroundColor: bgColor,
    hasShadow: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  notesWindows.set(parentWin.id, notes)

  const savedContent = loadNotes(ptyId)
  const channelSave = `notes-save-${parentWin.id}`

  ipcMain.on(channelSave, (_e, content: string) => {
    saveNotes(ptyId, content)
  })

  // Follow parent when it moves or resizes
  const updatePosition = () => {
    if (notes.isDestroyed()) return
    const b = parentWin.getBounds()
    notes.setBounds({
      x: b.x - NOTES_WIDTH - GAP,
      y: b.y,
      width: NOTES_WIDTH,
      height: b.height,
    })
  }

  parentWin.on('move', updatePosition)
  parentWin.on('resize', updatePosition)

  // Show/hide with parent
  parentWin.on('minimize', () => {
    if (!notes.isDestroyed()) notes.hide()
  })
  parentWin.on('restore', () => {
    if (!notes.isDestroyed()) notes.show()
  })

  // Cleanup
  const cleanup = () => {
    ipcMain.removeAllListeners(channelSave)
    parentWin.removeListener('move', updatePosition)
    parentWin.removeListener('resize', updatePosition)
    notesWindows.delete(parentWin.id)
  }

  notes.on('closed', () => {
    cleanup()
    // Notify the terminal renderer that notes was closed
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send('terminal:notes-closed')
    }
  })

  parentWin.on('closed', () => {
    if (!notes.isDestroyed()) notes.close()
    cleanup()
  })

  const escapedContent = JSON.stringify(savedContent)

  const accentColor = color

  const html = `<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    background: ${bgColor};
    overflow: hidden;
  }
  body {
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  }
  #header {
    -webkit-app-region: drag;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px 0 14px;
    font-size: 11px;
    font-weight: 600;
    color: rgba(255,255,255,0.55);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: ${tintedBackground(color, 0.1)};
  }
  #header span { pointer-events: none; }
  #add-task-btn {
    -webkit-app-region: no-drag;
    width: 24px; height: 24px;
    border: none; border-radius: 5px;
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.5);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; line-height: 1;
    transition: all 0.15s ease;
  }
  #add-task-btn:hover {
    background: rgba(255,255,255,0.14);
    color: rgba(255,255,255,0.85);
  }
  #content {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  #content::-webkit-scrollbar { width: 5px; }
  #content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
  /* ─── Tasks ─── */
  #tasks {
    flex-shrink: 0;
  }
  .task-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 14px;
    transition: background 0.1s;
  }
  .task-item:hover {
    background: rgba(255,255,255,0.03);
  }
  .task-item input[type="checkbox"] {
    width: 15px; height: 15px;
    margin-top: 2px;
    accent-color: ${accentColor};
    cursor: pointer;
    flex-shrink: 0;
  }
  .task-text {
    flex: 1;
    background: none; border: none; outline: none;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    font-size: 13px;
    line-height: 1.45;
    color: rgba(255,255,255,0.85);
    resize: none;
    overflow: hidden;
    padding: 0;
    min-height: 19px;
  }
  .task-text::placeholder { color: rgba(255,255,255,0.3); }
  .task-item.done .task-text {
    text-decoration: line-through;
    color: rgba(255,255,255,0.45);
  }
  .task-remove {
    width: 18px; height: 18px;
    border: none; border-radius: 4px;
    background: transparent;
    color: rgba(255,255,255,0.15);
    cursor: pointer;
    font-size: 12px; line-height: 1;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
    transition: all 0.1s;
    opacity: 0;
  }
  .task-item:hover .task-remove { opacity: 1; }
  .task-remove:hover {
    background: rgba(255,80,80,0.2);
    color: rgba(255,100,100,0.8);
  }
  /* ─── Divider ─── */
  #divider {
    height: 1px;
    margin: 6px 14px;
    background: rgba(255,255,255,0.06);
    flex-shrink: 0;
  }
  #divider.hidden { display: none; }
  /* ─── Free-form notes ─── */
  #editor {
    flex: 1;
    width: 100%;
    min-height: 80px;
    border: none; outline: none; resize: none;
    padding: 10px 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    font-size: 13px;
    line-height: 1.6;
    color: rgba(255,255,255,0.85);
    background: transparent;
  }
  #editor::placeholder { color: rgba(255,255,255,0.3); }
</style></head>
<body>
  <div id="header">
    <span>Notes</span>
    <button id="add-task-btn" title="Add task checkbox">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/>
        <path d="M4.5 7h5M7 4.5v5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
  <div id="content">
    <div id="tasks"></div>
    <div id="divider" class="hidden"></div>
    <textarea id="editor" placeholder="Jot down context, links, ideas..." autofocus></textarea>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const tasksEl = document.getElementById('tasks');
    const divider = document.getElementById('divider');
    const editor = document.getElementById('editor');
    const addBtn = document.getElementById('add-task-btn');

    // ── Parse saved content ──
    // Format: lines starting with "- [ ] " or "- [x] " are tasks, rest is free text
    const raw = ${escapedContent};
    const lines = raw.split('\\n');
    const taskLines = [];
    const textLines = [];
    let pastTasks = false;
    for (const line of lines) {
      if (!pastTasks && (line.startsWith('- [ ] ') || line.startsWith('- [x] '))) {
        taskLines.push({ done: line.startsWith('- [x] '), text: line.slice(6) });
      } else {
        pastTasks = true;
        textLines.push(line);
      }
    }
    // Trim leading empty lines from text section
    while (textLines.length > 0 && textLines[0].trim() === '') textLines.shift();
    editor.value = textLines.join('\\n');

    // ── Render tasks ──
    function createTaskEl(done, text, focusIt) {
      const row = document.createElement('div');
      row.className = 'task-item' + (done ? ' done' : '');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = done;
      cb.addEventListener('change', () => {
        row.classList.toggle('done', cb.checked);
        save();
      });

      const input = document.createElement('textarea');
      input.className = 'task-text';
      input.rows = 1;
      input.value = text;
      input.placeholder = 'Task...';
      input.addEventListener('input', () => {
        autoResize(input);
        save();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          addTask(true);
        }
        if (e.key === 'Backspace' && input.value === '') {
          e.preventDefault();
          const prev = row.previousElementSibling;
          row.remove();
          updateDivider();
          save();
          if (prev) {
            const prevInput = prev.querySelector('.task-text');
            if (prevInput) { prevInput.focus(); prevInput.selectionStart = prevInput.value.length; }
          }
        }
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'task-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', () => {
        row.remove();
        updateDivider();
        save();
      });

      row.appendChild(cb);
      row.appendChild(input);
      row.appendChild(removeBtn);
      tasksEl.appendChild(row);
      updateDivider();

      // Auto-resize textarea to fit content
      setTimeout(() => autoResize(input), 0);
      if (focusIt) setTimeout(() => input.focus(), 10);
    }

    function autoResize(el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }

    function updateDivider() {
      divider.classList.toggle('hidden', tasksEl.children.length === 0);
    }

    // Load saved tasks
    for (const t of taskLines) createTaskEl(t.done, t.text, false);

    function addTask(focusIt) {
      createTaskEl(false, '', focusIt !== false);
    }

    addBtn.addEventListener('click', () => addTask(true));

    // ── Serialize & save ──
    let saveTimer = null;
    function save() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const parts = [];
        for (const row of tasksEl.children) {
          const cb = row.querySelector('input[type="checkbox"]');
          const input = row.querySelector('.task-text');
          const prefix = cb.checked ? '- [x] ' : '- [ ] ';
          parts.push(prefix + input.value);
        }
        if (parts.length > 0 && editor.value.trim()) parts.push('');
        parts.push(editor.value);
        ipcRenderer.send('${channelSave}', parts.join('\\n'));
      }, 300);
    }

    editor.addEventListener('input', save);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.close();
    });
  </script>
</body>
</html>`

  notes.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  notes.once('ready-to-show', () => notes.show())

  return true
}

export function closeNotesForWindow(windowId: number): void {
  const notes = notesWindows.get(windowId)
  if (notes && !notes.isDestroyed()) {
    notes.close()
  }
  notesWindows.delete(windowId)
}

export function isNotesOpen(windowId: number): boolean {
  const notes = notesWindows.get(windowId)
  return !!notes && !notes.isDestroyed()
}
