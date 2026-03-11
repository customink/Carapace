import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface SkillInfo {
  name: string
  command: string // the /slash-command form
  description: string
  source: 'user' | 'plugin' | 'project'
}

const CLAUDE_DIR = path.join(os.homedir(), '.claude')

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}
  const block = match[1]!
  const result: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/)
    if (m) result[m[1]!] = m[2]!.trim()
  }
  return result
}

function scanDir(dir: string, source: SkillInfo['source']): SkillInfo[] {
  const skills: SkillInfo[] = []
  if (!fs.existsSync(dir)) return skills

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillFile = path.join(dir, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillFile)) continue
      try {
        const content = fs.readFileSync(skillFile, 'utf-8')
        const fm = parseFrontmatter(content)
        if (fm.name) {
          skills.push({
            name: fm.name,
            command: `/${fm.name}`,
            description: fm.description || '',
            source,
          })
        }
      } catch { /* skip unreadable */ }
    }
  } catch { /* skip unreadable dir */ }

  return skills
}

/** Recursively find all directories named "skills" under a root, then scan each */
function findAndScanSkillsDirs(root: string, source: SkillInfo['source']): SkillInfo[] {
  const results: SkillInfo[] = []
  if (!fs.existsSync(root)) return results

  function walk(dir: string, depth: number) {
    if (depth > 6) return // prevent runaway recursion
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const full = path.join(dir, entry.name)
        if (entry.name === 'skills') {
          results.push(...scanDir(full, source))
        } else {
          walk(full, depth + 1)
        }
      }
    } catch { /* permission denied or unreadable */ }
  }

  walk(root, 0)
  return results
}

function scanAllPlugins(): SkillInfo[] {
  const pluginsDir = path.join(CLAUDE_DIR, 'plugins')
  return findAndScanSkillsDirs(pluginsDir, 'plugin')
}

function scanProjectCommands(projectPath?: string): SkillInfo[] {
  const skills: SkillInfo[] = []
  if (!projectPath) return skills

  const cmdDir = path.join(projectPath, '.claude', 'commands')
  if (!fs.existsSync(cmdDir)) return skills

  try {
    for (const file of fs.readdirSync(cmdDir)) {
      if (!file.endsWith('.md')) continue
      const filePath = path.join(cmdDir, file)
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const fm = parseFrontmatter(content)
        const name = fm.name || file.replace('.md', '')
        skills.push({
          name,
          command: `/${name}`,
          description: fm.description || '',
          source: 'project',
        })
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return skills
}

/** Discover all available skills from user dir, plugins, and optionally a project */
export function discoverSkills(projectPath?: string): SkillInfo[] {
  const seen = new Set<string>()
  const skills: SkillInfo[] = []

  function add(list: SkillInfo[]) {
    for (const s of list) {
      if (seen.has(s.name)) continue
      seen.add(s.name)
      skills.push(s)
    }
  }

  // User-level skills first
  add(scanDir(path.join(CLAUDE_DIR, 'skills'), 'user'))
  // Plugin skills (cache + marketplaces)
  add(scanAllPlugins())
  // Project commands
  add(scanProjectCommands(projectPath))

  skills.sort((a, b) => a.name.localeCompare(b.name))
  return skills
}
