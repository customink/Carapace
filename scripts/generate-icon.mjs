#!/usr/bin/env node
/**
 * Generate Carapace app icon (.icns) from a procedurally rendered orb.
 * Uses only Node.js built-ins — no external image libraries.
 * macOS-only: requires `iconutil` (ships with Xcode CLT).
 */

import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { deflateSync } from 'zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUILD_DIR = join(__dirname, '..', 'build')
const ICONSET_DIR = join(BUILD_DIR, 'icon.iconset')

// ─── CRC32 (required for PNG chunks) ───
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  crcTable[n] = c >>> 0
}

function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const payload = Buffer.concat([typeBuf, data])
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(payload))
  return Buffer.concat([len, payload, crcBuf])
}

function createPNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA

  const stride = 1 + width * 4
  const raw = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: None
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflateSync(raw, { level: 9 })),
    makeChunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── Orb renderer ───
function renderOrb(size, r, g, b) {
  const rgba = Buffer.alloc(size * size * 4)
  const cx = size / 2, cy = size / 2
  const radius = size * 0.44

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist <= radius + 1.5) {
        const t = Math.min(1, dist / radius)

        // Light source top-left
        const hlDist = Math.sqrt((dx / radius + 0.3) ** 2 + (dy / radius + 0.35) ** 2)
        const specular = Math.max(0, 1 - hlDist * 1.1) ** 5 * 0.85
        const diffuse = Math.max(0, 1 - t * 0.7)
        const edge = 1 - t ** 3 * 0.6
        const light = (0.5 + diffuse * 0.5) * edge + specular

        // Anti-aliased edge
        const aa = Math.min(1, Math.max(0, radius + 1.5 - dist))

        rgba[idx]     = Math.min(255, Math.round(r * light + specular * 200))
        rgba[idx + 1] = Math.min(255, Math.round(g * light + specular * 180))
        rgba[idx + 2] = Math.min(255, Math.round(b * light + specular * 220))
        rgba[idx + 3] = Math.round(255 * aa)
      }
    }
  }
  return rgba
}

// ─── Generate all icon sizes ───
const SIZES = [
  { name: 'icon_16x16.png',      size: 16 },
  { name: 'icon_16x16@2x.png',   size: 32 },
  { name: 'icon_32x32.png',      size: 32 },
  { name: 'icon_32x32@2x.png',   size: 64 },
  { name: 'icon_128x128.png',    size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png',    size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png',    size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
]

// Carapace purple: #7C3AED → RGB(124, 58, 237)
const R = 124, G = 58, B = 237

console.log('Generating Carapace app icon...')

mkdirSync(ICONSET_DIR, { recursive: true })

// Cache rendered sizes to avoid re-rendering duplicates
const cache = new Map()

for (const { name, size } of SIZES) {
  let png = cache.get(size)
  if (!png) {
    const rgba = renderOrb(size, R, G, B)
    png = createPNG(size, size, rgba)
    cache.set(size, png)
  }
  writeFileSync(join(ICONSET_DIR, name), png)
}

// Also save a standalone 1024px PNG
writeFileSync(join(BUILD_DIR, 'icon.png'), cache.get(1024))

// Convert to .icns using macOS iconutil
try {
  execSync(`iconutil -c icns "${ICONSET_DIR}" -o "${join(BUILD_DIR, 'icon.icns')}"`)
  console.log('✓ build/icon.icns created')
} catch (e) {
  console.error('Warning: iconutil failed (macOS only):', e.message)
  console.log('  build/icon.png is available as fallback')
}

// Clean up iconset directory
rmSync(ICONSET_DIR, { recursive: true, force: true })
console.log('✓ Done')
