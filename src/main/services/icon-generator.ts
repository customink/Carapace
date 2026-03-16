/**
 * Generate colored orb NativeImages at runtime for dynamic dock icons.
 * Each terminal session gets a dock icon matching its color.
 */

import { nativeImage, app } from 'electron'
import { deflateSync } from 'zlib'

// ─── CRC32 ───
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  crcTable[n] = c >>> 0
}

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]!) & 0xFF]! ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const payload = Buffer.concat([typeBuf, data])
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(payload))
  return Buffer.concat([len, payload, crcBuf])
}

function createPNG(size: number, rgba: Buffer): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6

  const stride = 1 + size * 4
  const raw = Buffer.alloc(size * stride)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflateSync(raw, { level: 6 })),
    makeChunk('IEND', Buffer.alloc(0)),
  ])
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

function renderOrb(size: number, r: number, g: number, b: number): Buffer {
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
        const hlDist = Math.sqrt((dx / radius + 0.3) ** 2 + (dy / radius + 0.35) ** 2)
        const specular = Math.max(0, 1 - hlDist * 1.1) ** 5 * 0.85
        const diffuse = Math.max(0, 1 - t * 0.7)
        const edge = 1 - t ** 3 * 0.6
        const light = (0.5 + diffuse * 0.5) * edge + specular
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

// Cache to avoid regenerating the same icon
const cache = new Map<string, Electron.NativeImage>()

export function getOrbIcon(color: string, size = 128): Electron.NativeImage {
  const key = `${color}-${size}`
  let icon = cache.get(key)
  if (!icon) {
    const [r, g, b] = hexToRgb(color)
    const rgba = renderOrb(size, r, g, b)
    const png = createPNG(size, rgba)
    icon = nativeImage.createFromBuffer(png)
    cache.set(key, icon)
  }
  return icon
}

export function setDockIcon(color: string): void {
  if (process.platform !== 'darwin') return
  const icon = getOrbIcon(color, 256)
  app.dock?.setIcon(icon)
}

/** Reset dock icon to default purple orb */
export function resetDockIcon(): void {
  setDockIcon('#7C3AED')
}
