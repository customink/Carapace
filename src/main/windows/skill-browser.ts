import { BrowserWindow, ipcMain } from 'electron'
import { discoverSkills } from '../services/skill-discovery'
import {
  drawerBaseCss, drawerHeaderCss, drawerHeaderHtml, drawerBaseScript,
  drawerSearchCss, drawerSearchHtml, drawerSearchScript,
  createDrawerWindow, loadDrawerHtml,
} from './drawer-base'

const browserWindows = new Map<number, BrowserWindow>()

const PANEL_WIDTH = 320

export function toggleSkillBrowserWindow(parentWin: BrowserWindow, color: string, projectPath?: string): boolean {
  const channelType = `skillbrowser-type-${parentWin.id}`

  const skills = discoverSkills(projectPath)

  const result = createDrawerWindow({
    parentWin,
    width: PANEL_WIDTH,
    color,
    closedChannel: 'terminal:skillbrowser-closed',
    windowMap: browserWindows,
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
  const skillsJson = JSON.stringify(skills)

  const sourceLabels: Record<string, string> = {
    user: 'User',
    plugin: 'Plugin',
    project: 'Project',
  }

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
  .skill-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .skill-cmd {
    font-size: 13px;
    font-weight: 600;
    color: ${accentColor};
    font-family: 'SF Mono', Menlo, monospace;
  }
  .skill-badge {
    font-size: 9px;
    font-weight: 600;
    color: rgba(255,255,255,0.55);
    background: rgba(255,255,255,0.08);
    padding: 1px 5px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .skill-desc {
    font-size: 11px;
    color: rgba(255,255,255,0.65);
    margin-top: 3px;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
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
  ${drawerHeaderHtml('Skills')}
  ${drawerSearchHtml('Filter skills...')}
  <div id="list"></div>
  <script>
    const { ipcRenderer } = require('electron');
    const skills = ${skillsJson};
    const sourceLabels = ${JSON.stringify(sourceLabels)};
    const list = document.getElementById('list');
    const search = document.getElementById('search');

    function render(filter) {
      const q = (filter || '').toLowerCase();
      const filtered = skills.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
      list.innerHTML = '';
      if (filtered.length === 0) {
        list.innerHTML = '<div class="empty">No matching skills found</div>';
        return;
      }
      for (const s of filtered) {
        const el = document.createElement('div');
        el.className = 'skill';
        const badge = sourceLabels[s.source] || s.source;
        el.innerHTML =
          '<div class="skill-top">' +
            '<span class="skill-cmd">' + s.command + '</span>' +
            '<span class="skill-badge">' + badge + '</span>' +
          '</div>' +
          (s.description ? '<div class="skill-desc">' + escHtml(s.description) + '</div>' : '');
        el.addEventListener('click', () => {
          ipcRenderer.send('${channelType}', s.command + ' ');
        });
        list.appendChild(el);
      }
    }

    function escHtml(str) {
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
