import { BrowserWindow, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  drawerBaseCss, drawerHeaderCss, drawerHeaderHtml, drawerBaseScript,
  createDrawerWindow, loadDrawerHtml,
} from './drawer-base'
import { loadTeamPresets, addTeamPreset, deleteTeamPreset, generateTeamPrompt, type TeamPreset } from '../services/team-preset-store'
import * as ptyManager from '../services/pty-manager'

const dashboardWindows = new Map<number, BrowserWindow>()
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')
const PANEL_WIDTH = 300

interface AgentInfo {
  agentId: string
  agentType: string
  description: string
  toolUses: number
  createdAt: number
  isActive: boolean
}

function getSessionAgents(cwd: string, claudeSessionId?: string): AgentInfo[] {
  if (!claudeSessionId) return []
  const encoded = cwd.replace(/\//g, '-')
  const subagentsDir = path.join(PROJECTS_DIR, encoded, claudeSessionId, 'subagents')
  if (!fs.existsSync(subagentsDir)) return []
  const agents: AgentInfo[] = []
  try {
    for (const file of fs.readdirSync(subagentsDir)) {
      if (!file.endsWith('.meta.json')) continue
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(subagentsDir, file), 'utf-8'))
        const agentId = file.replace('.meta.json', '').replace('agent-', '')
        const jsonlFile = path.join(subagentsDir, file.replace('.meta.json', '.jsonl'))
        let toolUses = 0
        let createdAt = 0
        let lastModified = 0
        try {
          const stat = fs.statSync(jsonlFile)
          createdAt = stat.birthtimeMs
          lastModified = stat.mtimeMs
          const content = fs.readFileSync(jsonlFile, 'utf-8')
          for (const line of content.split('\n')) {
            if (line.includes('"tool_use"')) toolUses++
          }
        } catch { /* no jsonl yet */ }
        const isActive = lastModified > 0 && (Date.now() - lastModified) < 30000
        agents.push({ agentId, agentType: meta.agentType || 'unknown', description: meta.description || '', toolUses, createdAt, isActive })
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  // Oldest first (longest living at top)
  agents.sort((a, b) => a.createdAt - b.createdAt)
  return agents
}

export function toggleTeamDashboard(parentWin: BrowserWindow, color: string, cwd: string, claudeSessionId?: string): boolean {
  const chData = `teamdash-data-${parentWin.id}`
  const chPresets = `teamdash-presets-${parentWin.id}`
  const chAddPreset = `teamdash-add-${parentWin.id}`
  const chDeletePreset = `teamdash-del-${parentWin.id}`
  const chLaunchPreset = `teamdash-launch-${parentWin.id}`

  const result = createDrawerWindow({
    parentWin,
    width: PANEL_WIDTH,
    color,
    closedChannel: 'terminal:teamdash-closed',
    windowMap: dashboardWindows,
    ipcChannels: [chLaunchPreset],
    ipcHandlers: [chData, chPresets, chAddPreset, chDeletePreset],
    side: 'right',
  })

  if (!result) return false
  const { win, bgColor, headerBg } = result
  const accentColor = color

  ipcMain.handle(chData, () => {
    // Read live claudeSessionId from PTY session (it gets set after JSONL is first written)
    const session = ptyManager.getByWindowId(parentWin.id)
    const liveSessionId = session?.claudeSessionId || claudeSessionId
    const liveCwd = session?.cwd || cwd
    return { agents: getSessionAgents(liveCwd, liveSessionId) }
  })
  ipcMain.handle(chPresets, () => loadTeamPresets())
  ipcMain.handle(chAddPreset, (_e, preset: Omit<TeamPreset, 'id'>) => addTeamPreset(preset))
  ipcMain.handle(chDeletePreset, (_e, id: string) => deleteTeamPreset(id))

  ipcMain.on(chLaunchPreset, (_e, presetId: string) => {
    const presets = loadTeamPresets()
    const preset = presets.find(p => p.id === presetId)
    if (!preset || parentWin.isDestroyed()) return
    parentWin.webContents.send('terminal:type-command', '\n' + generateTeamPrompt(preset))
    parentWin.focus()
  })

  const html = `<!DOCTYPE html>
<html>
<head><style>
  ${drawerBaseCss(bgColor)}
  ${drawerHeaderCss(headerBg)}

  .content { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; }

  .section-label {
    font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.5);
    text-transform: uppercase; letter-spacing: 0.5px; margin: 8px 0 6px; padding: 0 4px;
  }

  .agent-card {
    display: flex; align-items: flex-start; gap: 8px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 8px; padding: 8px 10px; margin-bottom: 5px;
  }
  .agent-dot {
    width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex-shrink: 0;
  }
  .agent-dot.active { background: #10B981; box-shadow: 0 0 6px rgba(16,185,129,0.5); }
  .agent-dot.idle { background: rgba(255,255,255,0.25); }
  .agent-info { flex: 1; min-width: 0; }
  .agent-type { font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 0.3px; }
  .agent-desc {
    font-size: 11px; color: rgba(255,255,255,0.8); margin-top: 1px; line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .agent-stats {
    font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 3px;
  }

  .empty-msg {
    text-align: center; padding: 24px 14px; font-size: 11px;
    color: rgba(255,255,255,0.4); line-height: 1.5;
  }

  .preset-card {
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 8px; padding: 8px 10px; margin-bottom: 5px;
  }
  .preset-header { display: flex; align-items: center; justify-content: space-between; }
  .preset-name { font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.9); }
  .preset-count { font-size: 10px; color: rgba(255,255,255,0.45); }
  .preset-members { margin-top: 3px; }
  .preset-member { font-size: 10px; color: rgba(255,255,255,0.55); padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .preset-actions { display: flex; gap: 4px; margin-top: 5px; }
  .pbtn {
    font-size: 10px; padding: 3px 10px; border-radius: 5px; border: none; cursor: pointer; font-weight: 500; transition: all 0.15s;
  }
  .pbtn-go { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); }
  .pbtn-go:hover { background: rgba(255,255,255,0.14); color: rgba(255,255,255,0.85); }
  .pbtn-rm { background: rgba(255,60,60,0.08); color: rgba(255,100,100,0.5); }
  .pbtn-rm:hover { background: rgba(255,60,60,0.15); color: rgba(255,100,100,0.8); }

  .spacer { flex: 1; min-height: 10px; }

  .create-section { border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px; flex-shrink: 0; }
  .create-btn {
    width: 100%; padding: 7px; border: 1px dashed rgba(255,255,255,0.12);
    border-radius: 8px; background: transparent; color: rgba(255,255,255,0.55);
    font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.15s;
  }
  .create-btn:hover { border-color: rgba(255,255,255,0.25); color: rgba(255,255,255,0.55); background: rgba(255,255,255,0.03); }

  .form { display: none; flex-direction: column; gap: 6px; }
  .form.visible { display: flex; }
  .flabel { font-size: 10px; font-weight: 500; color: rgba(255,255,255,0.55); margin-bottom: 1px; }
  .finput {
    width: 100%; padding: 5px 8px; font-size: 11px;
    border: 1px solid rgba(255,255,255,0.1); border-radius: 5px;
    background: rgba(0,0,0,0.2); color: #e2e8f0; outline: none; font-family: inherit;
  }
  .finput:focus { border-color: ${accentColor}60; }
  .finput::placeholder { color: rgba(255,255,255,0.15); }
  .member-entry {
    background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);
    border-radius: 6px; padding: 6px; margin-bottom: 3px;
  }
  .member-entry .finput { margin-bottom: 3px; }
  .mrow { display: flex; align-items: center; gap: 3px; }
  .mrow .finput { flex: 1; }
  .rm-btn {
    width: 18px; height: 18px; border: none; border-radius: 3px;
    background: transparent; color: rgba(255,100,100,0.4); cursor: pointer;
    font-size: 13px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .rm-btn:hover { background: rgba(255,60,60,0.1); color: rgba(255,100,100,0.7); }
  .add-btn {
    font-size: 10px; padding: 3px 8px; border: 1px dashed rgba(255,255,255,0.1);
    border-radius: 5px; background: transparent; color: rgba(255,255,255,0.3);
    cursor: pointer; width: 100%; transition: all 0.15s;
  }
  .add-btn:hover { border-color: rgba(255,255,255,0.2); color: rgba(255,255,255,0.5); }
  .factions { display: flex; gap: 5px; justify-content: flex-end; margin-top: 4px; }
  .fbtn { padding: 4px 12px; font-size: 10px; border-radius: 5px; border: none; cursor: pointer; font-weight: 500; }
  .fbtn-cancel { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5); }
  .fbtn-cancel:hover { background: rgba(255,255,255,0.1); }
  .fbtn-save { background: ${accentColor}; color: white; }
  .fbtn-save:hover { opacity: 0.85; }
  .fbtn-save:disabled { opacity: 0.25; cursor: default; }
</style></head>
<body>
  ${drawerHeaderHtml('Agent Teams')}
  <div class="content" id="content">
    <div id="agents-sec"></div>
    <div id="presets-sec"></div>
    <div class="spacer"></div>
    <div class="create-section">
      <button class="create-btn" id="create-btn">+ Create Team Preset</button>
      <div class="form" id="form">
        <div><div class="flabel">Team Name</div>
        <input class="finput" id="tname" placeholder="e.g. Code Review Team" /></div>
        <div class="flabel">Members</div>
        <div id="mlist"></div>
        <button class="add-btn" id="add-m">+ Add Member</button>
        <div class="factions">
          <button class="fbtn fbtn-cancel" id="fcancel">Cancel</button>
          <button class="fbtn fbtn-save" id="fsave" disabled>Save</button>
        </div>
      </div>
    </div>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const agentsSec = document.getElementById('agents-sec');
    const presetsSec = document.getElementById('presets-sec');
    const createBtn = document.getElementById('create-btn');
    const form = document.getElementById('form');
    const tnameInput = document.getElementById('tname');
    const mlist = document.getElementById('mlist');
    const saveBtn = document.getElementById('fsave');

    document.getElementById('drawer-close-btn').addEventListener('click', () => window.close());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

    async function loadAgents() {
      const { agents } = await ipcRenderer.invoke('${chData}');
      agentsSec.innerHTML = '';
      if (agents.length > 0) {
        const l = document.createElement('div'); l.className = 'section-label';
        l.textContent = 'Active Agents (' + agents.length + ')';
        agentsSec.appendChild(l);
        for (const a of agents) {
          const c = document.createElement('div'); c.className = 'agent-card';
          const dotClass = a.isActive ? 'active' : 'idle';
          const statusText = a.isActive ? 'Active' : 'Done';
          const statsText = a.toolUses > 0 ? statusText + ' \\u2022 ' + a.toolUses + ' tool uses' : statusText;
          c.innerHTML = '<div class="agent-dot ' + dotClass + '"></div>' +
            '<div class="agent-info"><div class="agent-type">' + esc(a.agentType) + '</div>' +
            '<div class="agent-desc">' + esc(a.description) + '</div>' +
            '<div class="agent-stats">' + statsText + '</div></div>';
          agentsSec.appendChild(c);
        }
      } else {
        agentsSec.innerHTML = '<div class="empty-msg">No active agents in this session</div>';
      }
    }

    async function loadPresets() {
      const presets = await ipcRenderer.invoke('${chPresets}');
      presetsSec.innerHTML = '';
      if (presets.length > 0) {
        const l = document.createElement('div'); l.className = 'section-label';
        l.textContent = 'Team Presets';
        presetsSec.appendChild(l);
        for (const p of presets) {
          const c = document.createElement('div'); c.className = 'preset-card';
          let mh = '';
          for (const m of p.members) mh += '<div class="preset-member">\\u2022 ' + esc(m.role) + '</div>';
          c.innerHTML = '<div class="preset-header"><span class="preset-name">' + esc(p.name) +
            '</span><span class="preset-count">' + p.members.length + '</span></div>' +
            '<div class="preset-members">' + mh + '</div>' +
            '<div class="preset-actions">' +
            '<button class="pbtn pbtn-go" data-id="' + p.id + '">\\u25B6 Launch</button>' +
            '<button class="pbtn pbtn-rm" data-del="' + p.id + '">Delete</button></div>';
          presetsSec.appendChild(c);
        }
        presetsSec.querySelectorAll('.pbtn-go').forEach(b => b.addEventListener('click', () => ipcRenderer.send('${chLaunchPreset}', b.dataset.id)));
        presetsSec.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { await ipcRenderer.invoke('${chDeletePreset}', b.dataset.del); loadPresets(); }));
      }
    }

    async function loadAll() { await loadAgents(); await loadPresets(); }
    loadAll();
    setInterval(loadAgents, 5000);

    let members = [{ role: '', description: '' }];

    createBtn.addEventListener('click', () => { createBtn.style.display = 'none'; form.classList.add('visible'); renderM(); tnameInput.focus(); });
    document.getElementById('fcancel').addEventListener('click', resetForm);
    document.getElementById('add-m').addEventListener('click', () => { members.push({ role: '', description: '' }); renderM(); });

    function resetForm() { form.classList.remove('visible'); createBtn.style.display = ''; tnameInput.value = ''; members = [{ role: '', description: '' }]; }

    function renderM() {
      mlist.innerHTML = '';
      members.forEach((m, i) => {
        const e = document.createElement('div'); e.className = 'member-entry';
        e.innerHTML = '<div class="mrow"><input class="finput" data-i="' + i + '" data-f="role" placeholder="Role" value="' + esc(m.role) + '" />' +
          (members.length > 1 ? '<button class="rm-btn" data-rm="' + i + '">\\u00D7</button>' : '') + '</div>' +
          '<input class="finput" data-i="' + i + '" data-f="description" placeholder="Description" value="' + esc(m.description) + '" />';
        mlist.appendChild(e);
      });
      mlist.querySelectorAll('.finput').forEach(inp => inp.addEventListener('input', () => { members[parseInt(inp.dataset.i)][inp.dataset.f] = inp.value; updateSave(); }));
      mlist.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { members.splice(parseInt(b.dataset.rm), 1); renderM(); }));
      updateSave();
    }

    function updateSave() { saveBtn.disabled = !(tnameInput.value.trim() && members.some(m => m.role.trim())); }
    tnameInput.addEventListener('input', updateSave);

    saveBtn.addEventListener('click', async () => {
      const name = tnameInput.value.trim();
      const valid = members.filter(m => m.role.trim());
      if (!name || !valid.length) return;
      await ipcRenderer.invoke('${chAddPreset}', { name, members: valid });
      resetForm(); loadPresets();
    });

    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    ${drawerBaseScript()}
  </script>
</body>
</html>`

  loadDrawerHtml(win, html)
  return true
}
