/**
 * Clean copy of Claude's messages.
 *
 * What the terminal shows is a rendering: hard-wrapped at the window width, indented, with
 * gutter glyphs (`●`, `│` for blockquotes) and markdown styling applied. Copying that gives
 * ragged text with artifacts. The transcript holds the markdown Claude actually wrote, so we
 * find the message (or block) the user hovered by matching the rendered rows against it, and
 * copy the source converted to plain text instead.
 */

import * as fs from 'fs'

export type CopyMode = 'block' | 'message'

const TAIL_BYTES = 4 * 1024 * 1024

interface Block {
  kind: 'para' | 'quote' | 'code'
  lines: string[]
}

/** Letters and digits only, any script — rendering vs. markdown differ in everything else */
export function normalize(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
}

/** Split markdown into paragraphs, blockquotes (contiguous `>` lines) and fenced code blocks. */
export function splitBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.split('\n')
  let current: Block | null = null
  const flush = () => { if (current && current.lines.length > 0) blocks.push(current); current = null }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = line.match(/^\s*(```|~~~)/)
    if (fence) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!); i++) code.push(lines[i]!)
      blocks.push({ kind: 'code', lines: code })
      continue
    }
    const isQuote = /^\s*>/.test(line)
    if (isQuote) {
      if (current?.kind !== 'quote') { flush(); current = { kind: 'quote', lines: [] } }
      current.lines.push(line.replace(/^\s*> ?/, ''))
      continue
    }
    if (line.trim() === '') { flush(); continue }
    if (current?.kind !== 'para') { flush(); current = { kind: 'para', lines: [] } }
    current.lines.push(line)
  }
  flush()
  return blocks
}

/** Inline markdown → plain text. List markers and line structure are kept. */
export function inlineToPlain(line: string): string {
  return line
    .replace(/^(\s*)#{1,6}\s+/, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) =>
      text === url || `https://${text}` === url || `http://${text}` === url ? url : `${text} (${url})`)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w])_(?!\s)(.+?)(?<!\s)_(?![\w])/g, '$1$2')
}

function blockToPlain(block: Block): string {
  if (block.kind === 'code') return block.lines.join('\n') // exactly as written
  // A quote's own blank `>` lines separate its paragraphs; keep them as blank lines
  return block.lines.map(inlineToPlain).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function markdownToPlain(markdown: string): string {
  return splitBlocks(markdown).map(blockToPlain).join('\n\n')
}

/**
 * Find what to copy for the hovered rows. `messages` are Claude's text blocks, newest first;
 * `rows` are the rendered terminal rows of the hovered block (gutters already stripped).
 * Returns null when nothing matches confidently — the caller falls back to reflowed screen text.
 */
export function findCopyText(messages: string[], rows: string[], mode: CopyMode): string | null {
  const target = normalize(rows.join(' '))
  // Too short to identify a block on its own ("Done.") — would match the wrong message
  if (target.length < 12) return null

  for (const message of messages) {
    if (!normalize(message).includes(target)) continue
    if (mode === 'message') return markdownToPlain(message)

    const blocks = splitBlocks(message)
    const norms = blocks.map(b => normalize(b.lines.join(' ')))
    // The hovered rows sit inside one source block…
    const inside = norms.findIndex(n => n.includes(target))
    if (inside !== -1) return blockToPlain(blocks[inside]!)
    // …or span several (the terminal showed no blank row between them): take the run they cover
    const covered = norms.map(n => n.length > 0 && target.includes(n))
    const first = covered.indexOf(true)
    if (first === -1) return markdownToPlain(message)
    let last = first
    while (last + 1 < blocks.length && covered[last + 1]) last++
    return blocks.slice(first, last + 1).map(blockToPlain).join('\n\n')
  }
  return null
}

/** Claude's text blocks from transcript lines, newest first */
function assistantTexts(lines: string[]): string[] {
  const texts: string[] = []
  for (const line of lines) {
    if (!line.includes('"assistant"')) continue
    let entry: { type?: string; isSidechain?: boolean; message?: { content?: unknown } }
    try { entry = JSON.parse(line) } catch { continue }
    if (entry.type !== 'assistant' || entry.isSidechain || !Array.isArray(entry.message?.content)) continue
    for (const part of entry.message!.content as { type?: string; text?: unknown }[]) {
      if (part?.type === 'text' && typeof part.text === 'string') texts.push(part.text)
    }
  }
  return texts.reverse()
}

/**
 * Clean text for the hovered rows of a conversation. Reads the transcript's tail first — the
 * hovered message is almost always recent — and only reads the whole file if that misses.
 */
export async function copyTextFromTranscript(transcriptPath: string, rows: string[], mode: CopyMode): Promise<string | null> {
  let size: number
  try { size = (await fs.promises.stat(transcriptPath)).size } catch { return null }

  const start = Math.max(0, size - TAIL_BYTES)
  const handle = await fs.promises.open(transcriptPath, 'r')
  let tail: string
  try {
    const buf = Buffer.alloc(size - start)
    await handle.read(buf, 0, buf.length, start)
    tail = buf.toString('utf-8')
  } finally {
    await handle.close()
  }
  const tailLines = tail.split('\n')
  if (start > 0) tailLines.shift() // first line is cut mid-way
  const fromTail = findCopyText(assistantTexts(tailLines), rows, mode)
  if (fromTail !== null || start === 0) return fromTail

  const all = await fs.promises.readFile(transcriptPath, 'utf-8')
  return findCopyText(assistantTexts(all.split('\n')), rows, mode)
}
