import { BrowserWindow, ipcMain } from 'electron'
import {
  drawerBaseCss, drawerHeaderCss, drawerHeaderHtml, drawerBaseScript,
  drawerSearchCss, drawerSearchHtml, drawerSearchScript,
  createDrawerWindow, loadDrawerHtml,
} from './drawer-base'

const skillsWindows = new Map<number, BrowserWindow>()

const SKILLS_WIDTH = 300

interface SkillDef {
  command: string
  description: string
  params?: string
}

const SKILLS: SkillDef[] = [
  { command: '/help', description: 'Show help and available commands' },
  { command: '/clear', description: 'Clear conversation history' },
  { command: '/compact', description: 'Compact conversation to save context', params: '[instructions]' },
  { command: '/cost', description: 'Show token usage and cost for this session' },
  { command: '/doctor', description: 'Check Claude Code installation health' },
  { command: '/init', description: 'Initialize project with CLAUDE.md guide' },
  { command: '/login', description: 'Switch accounts or auth method' },
  { command: '/logout', description: 'Sign out from current account' },
  { command: '/memory', description: 'Edit CLAUDE.md memory files' },
  { command: '/model', description: 'Switch Claude model', params: '[model-name]' },
  { command: '/permissions', description: 'View or update tool permissions' },
  { command: '/review', description: 'Review a pull request', params: '[pr-url]' },
  { command: '/status', description: 'Show current session status' },
  { command: '/vim', description: 'Toggle vim mode for input' },
  { command: '/bug', description: 'Report a bug with Claude Code' },
  { command: '/config', description: 'Open or view configuration' },
  { command: '/mcp', description: 'View MCP server status and tools' },
  { command: '/terminal-setup', description: 'Set up terminal key bindings' },
]

export function toggleSkillsWindow(parentWin: BrowserWindow, color: string): boolean {
  const channelType = `skills-type-${parentWin.id}`

  const result = createDrawerWindow({
    parentWin,
    width: SKILLS_WIDTH,
    color,
    closedChannel: 'terminal:skills-closed',
    windowMap: skillsWindows,
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
  const skillsJson = JSON.stringify(SKILLS)

  const html = `<!DOCTYPE html>
<html>
<head><style>
  ${drawerBaseCss(bgColor)}
  ${drawerHeaderCss(headerBg)}
  ${drawerSearchCss(accentColor)}
  #list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .skill {
    padding: 8px 14px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .skill:hover {
    background: rgba(255,255,255,0.06);
  }
  .skill-cmd {
    font-size: 13px;
    font-weight: 600;
    color: ${accentColor};
    font-family: 'SF Mono', Menlo, monospace;
  }
  .skill-params {
    font-weight: 400;
    color: rgba(255,255,255,0.5);
    margin-left: 4px;
  }
  .skill-desc {
    font-size: 11px;
    color: rgba(255,255,255,0.65);
    margin-top: 2px;
    line-height: 1.3;
  }
  .empty {
    padding: 20px 14px;
    font-size: 12px;
    color: rgba(255,255,255,0.2);
    text-align: center;
  }
</style></head>
<body>
  ${drawerHeaderHtml('Slash Commands')}
  ${drawerSearchHtml('Filter commands...')}
  <div id="list"></div>
  <script>
    const { ipcRenderer } = require('electron');
    const skills = ${skillsJson};
    const list = document.getElementById('list');
    const search = document.getElementById('search');

    function render(filter) {
      const q = (filter || '').toLowerCase();
      const filtered = skills.filter(s =>
        s.command.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
      list.innerHTML = '';
      if (filtered.length === 0) {
        list.innerHTML = '<div class="empty">No matching commands</div>';
        return;
      }
      for (const s of filtered) {
        const el = document.createElement('div');
        el.className = 'skill';
        const params = s.params ? '<span class="skill-params">' + s.params + '</span>' : '';
        el.innerHTML = '<div class="skill-cmd">' + s.command + params + '</div>'
          + '<div class="skill-desc">' + s.description + '</div>';
        el.addEventListener('click', () => {
          const text = s.params ? s.command + ' ' : s.command;
          ipcRenderer.send('${channelType}', text);
        });
        list.appendChild(el);
      }
    }

    search.addEventListener('input', () => render(search.value));
    render('');

    ${drawerSearchScript()}
    ${drawerBaseScript()}
  </script>
</body>
</html>`

  loadDrawerHtml(win, html)
  return true
}

export function isSkillsOpen(windowId: number): boolean {
  const win = skillsWindows.get(windowId)
  return !!win && !win.isDestroyed()
}
