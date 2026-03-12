import { BrowserWindow, ipcMain } from 'electron'
import { loadPromptHistory } from '../services/prompt-history'
import {
  drawerBaseCss, drawerHeaderCss, drawerHeaderHtml, drawerBaseScript,
  createDrawerWindow, loadDrawerHtml,
} from './drawer-base'

const historyWindows = new Map<number, BrowserWindow>()

const PANEL_WIDTH = 320

export function togglePromptHistoryWindow(parentWin: BrowserWindow, color: string, ptyId: string): boolean {
  const channelType = `prompthistory-type-${parentWin.id}`

  const prompts = loadPromptHistory(ptyId)

  const result = createDrawerWindow({
    parentWin,
    width: PANEL_WIDTH,
    color,
    closedChannel: 'terminal:prompthistory-closed',
    windowMap: historyWindows,
    ipcChannels: [channelType],
  })

  if (!result) return false
  const { win, bgColor, headerBg } = result

  ipcMain.on(channelType, (_e, command: string) => {
    if (!parentWin.isDestroyed()) {
      parentWin.webContents.send('terminal:type-command', command)
    }
  })

  const accentColor = color
  const promptsJson = JSON.stringify(prompts)

  const html = `<!DOCTYPE html>
<html>
<head><style>
  ${drawerBaseCss(bgColor)}
  ${drawerHeaderCss(headerBg)}
  #list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
    -webkit-app-region: no-drag;
  }
  .prompt-item {
    padding: 8px 14px;
    cursor: pointer;
    transition: background 0.1s;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .prompt-item:hover { background: rgba(255,255,255,0.06); }
  .prompt-item:active { background: ${accentColor}30; }
  .prompt-text {
    font-size: 12px;
    color: rgba(255,255,255,0.8);
    font-family: 'SF Mono', Menlo, monospace;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .prompt-num {
    font-size: 10px;
    color: rgba(255,255,255,0.25);
    margin-bottom: 3px;
  }
  .empty {
    padding: 24px 14px;
    font-size: 12px;
    color: rgba(255,255,255,0.2);
    text-align: center;
    line-height: 1.5;
  }
</style></head>
<body>
  ${drawerHeaderHtml('Prompt History')}
  <div id="list"></div>
  <script>
    const { ipcRenderer } = require('electron');
    const prompts = ${promptsJson};
    const list = document.getElementById('list');

    if (prompts.length === 0) {
      list.innerHTML = '<div class="empty">No prompts yet.<br>Send a prompt in the terminal to see it here.</div>';
    } else {
      for (let i = 0; i < prompts.length; i++) {
        const el = document.createElement('div');
        el.className = 'prompt-item';
        const num = document.createElement('div');
        num.className = 'prompt-num';
        num.textContent = '#' + (i + 1);
        const text = document.createElement('div');
        text.className = 'prompt-text';
        text.textContent = prompts[i];
        el.appendChild(num);
        el.appendChild(text);
        el.addEventListener('click', () => {
          ipcRenderer.send('${channelType}', prompts[i]);
        });
        list.appendChild(el);
      }
    }

    ${drawerBaseScript()}
  </script>
</body>
</html>`

  loadDrawerHtml(win, html)
  return true
}
