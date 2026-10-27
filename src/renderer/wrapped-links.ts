import type { IBufferCell, IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm'

// Replacement for @xterm/addon-web-links that also follows URLs across hard line breaks.
//
// Claude Code renders long plain-text URLs (tool calls, tool output, code blocks, the echoed
// prompt) by breaking them at the right edge with a real newline and indenting the remainder,
// e.g.
//   ⏺ Bash(echo
//         https://github.com/customink/carapace/pull/123/files?d
//         iff=split&w=1#diff-abc)
// Those rows aren't flagged isWrapped, so the stock addon only sees the first fragment and
// opens a truncated URL. A row whose text reaches the right edge is treated as continuing onto
// the next row with its leading indentation stripped. (URLs Claude Code emits as OSC 8
// hyperlinks already carry the full URI and are handled by xterm's built-in provider, which
// takes priority over this one.)

// Same pattern as @xterm/addon-web-links.
const URL_REGEX = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\\^<>`]*[^\s"':,.!?{}|\\\^~\[\]`()<>]/g

// Ink leaves a column or two of right padding, so "reaches the edge" can't be an exact match.
const EDGE_SLACK = 3

// Bound on how far up/down a single logical line is followed.
const MAX_ROWS = 20

interface Row {
  text: string
  xs: number[] // buffer column of each UTF-16 code unit in `text`
}

type Join = 'soft' | 'hard' | null

function readRow(line: IBufferLine, cell: IBufferCell): Row {
  let text = ''
  const xs: number[] = []
  for (let x = 0; x < line.length; x++) {
    line.getCell(x, cell)
    if (cell.getWidth() === 0) continue // trailing half of a wide character
    const chars = cell.getChars() || ' '
    for (let k = 0; k < chars.length; k++) {
      text += chars[k]
      xs.push(x)
    }
  }
  return { text, xs }
}

function trimmedLength(text: string): number {
  let end = text.length
  while (end > 0 && text[end - 1] === ' ') end--
  return end
}

export function createWrappedLinkProvider(
  terminal: Terminal,
  open: (url: string) => void,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const buf = terminal.buffer.active
      const cols = terminal.cols
      const cell = buf.getNullCell()
      const rows = new Map<number, Row | null>()

      const rowAt = (y: number): Row | null => {
        if (!rows.has(y)) {
          const line = buf.getLine(y)
          rows.set(y, line ? readRow(line, cell) : null)
        }
        return rows.get(y)!
      }

      // How row y continues row y - 1, if at all.
      const joinAt = (y: number): Join => {
        if (y <= 0) return null
        const line = buf.getLine(y)
        if (!line) return null
        if (line.isWrapped) return 'soft'
        const prev = rowAt(y - 1)
        const curr = rowAt(y)
        if (!prev || !curr) return null
        const prevLen = trimmedLength(prev.text)
        if (prevLen === 0 || prev.xs[prevLen - 1] < cols - EDGE_SLACK) return null
        if (curr.text.trim().length === 0) return null
        return 'hard'
      }

      const y = bufferLineNumber - 1
      let top = y
      while (y - top < MAX_ROWS && joinAt(top)) top--
      let bottom = y
      while (bottom - y < MAX_ROWS && joinAt(bottom + 1)) bottom++

      let text = ''
      const pos: { x: number; y: number }[] = []
      for (let r = top; r <= bottom; r++) {
        const row = rowAt(r)
        if (!row) break
        let start = 0
        let end = row.text.length
        if (r > top && joinAt(r) === 'hard') {
          while (start < end && row.text[start] === ' ') start++
        }
        if (r < bottom && joinAt(r + 1) === 'hard') end = trimmedLength(row.text)
        text += row.text.slice(start, end)
        for (let i = start; i < end; i++) pos.push({ x: row.xs[i], y: r })
      }

      const links: ILink[] = []
      for (const match of text.matchAll(URL_REGEX)) {
        const url = match[0]
        const first = pos[match.index!]
        const last = pos[match.index! + url.length - 1]
        if (last.y < y || first.y > y) continue
        try {
          new URL(url)
        } catch {
          continue
        }
        links.push({
          range: {
            start: { x: first.x + 1, y: first.y + 1 },
            end: { x: last.x + 1, y: last.y + 1 },
          },
          text: url,
          activate: () => open(url),
        })
      }

      callback(links.length > 0 ? links : undefined)
    },
  }
}
