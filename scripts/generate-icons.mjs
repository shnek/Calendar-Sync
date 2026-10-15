// Renders the app and tray icons as PNGs using signed distance fields, so the
// repo needs no design tools or binary sources. Run: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---- PNG encoding -----------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- Shapes (unit coordinates, 0..1) ----------------------------------------
const roundBox = (cx, cy, hx, hy, r) => (x, y) => {
  const qx = Math.abs(x - cx) - (hx - r)
  const qy = Math.abs(y - cy) - (hy - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r
const intersect = (a, b) => (x, y) => Math.max(a(x, y), b(x, y))
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

/** layers: [{ sdf, color: '#rrggbb' } | { sdf, erase: true }] painted in order. */
function render(size, layers) {
  const out = Buffer.alloc(size * size * 4)
  const px = 1 / size
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) / size
      const y = (j + 0.5) / size
      let r = 0,
        g = 0,
        b = 0,
        a = 0
      for (const layer of layers) {
        const cov = Math.min(1, Math.max(0, 0.5 - layer.sdf(x, y) / px))
        if (cov <= 0) continue
        if (layer.erase) {
          a *= 1 - cov
          continue
        }
        const [lr, lg, lb] = hex(layer.color)
        const na = cov + a * (1 - cov)
        r = (lr * cov + r * a * (1 - cov)) / na
        g = (lg * cov + g * a * (1 - cov)) / na
        b = (lb * cov + b * a * (1 - cov)) / na
        a = na
      }
      const o = (j * size + i) * 4
      out[o] = Math.round(r)
      out[o + 1] = Math.round(g)
      out[o + 2] = Math.round(b)
      out[o + 3] = Math.round(a * 255)
    }
  }
  return out
}

const BLUE = '#2563EB'
const NAVY = '#1E3A8A'
const SKY = '#BFDBFE'
const WHITE = '#FFFFFF'
const RED = '#DC2626'

function appIconLayers() {
  const body = roundBox(0.5, 0.56, 0.3, 0.27, 0.06)
  const cells = []
  const cols = [0.355, 0.5, 0.645]
  const rows = [0.55, 0.69]
  rows.forEach((cy, ri) =>
    cols.forEach((cx, ci) => {
      const busy = (ri === 0 && ci === 1) || (ri === 1 && ci === 0)
      cells.push({ sdf: roundBox(cx, cy, 0.06, 0.05, 0.018), color: busy ? BLUE : SKY })
    }),
  )
  return [
    { sdf: roundBox(0.5, 0.5, 0.45, 0.45, 0.2), color: BLUE },
    { sdf: body, color: WHITE },
    { sdf: intersect(body, roundBox(0.5, 0.36, 0.31, 0.07, 0)), color: NAVY },
    { sdf: roundBox(0.38, 0.27, 0.026, 0.06, 0.026), color: WHITE },
    { sdf: roundBox(0.62, 0.27, 0.026, 0.06, 0.026), color: WHITE },
    ...cells,
  ]
}

function trayLayers({ error }) {
  const body = roundBox(0.5, 0.56, 0.34, 0.32, 0.08)
  const layers = [
    { sdf: roundBox(0.5, 0.5, 0.48, 0.48, 0.16), color: BLUE },
    { sdf: body, color: WHITE },
    { sdf: intersect(body, roundBox(0.5, 0.33, 0.36, 0.09, 0)), color: NAVY },
    { sdf: roundBox(0.36, 0.6, 0.09, 0.09, 0.03), color: BLUE },
    { sdf: roundBox(0.64, 0.6, 0.09, 0.09, 0.03), color: SKY },
  ]
  if (error) {
    layers.push({ sdf: circle(0.78, 0.78, 0.24), erase: true })
    layers.push({ sdf: circle(0.78, 0.78, 0.2), color: RED })
  }
  return layers
}

/** macOS template image: black glyph + alpha; the system tints it. */
function templateLayers() {
  const body = roundBox(0.5, 0.55, 0.4, 0.37, 0.09)
  return [
    { sdf: body, color: '#000000' },
    { sdf: roundBox(0.5, 0.62, 0.32, 0.22, 0.04), erase: true },
    { sdf: roundBox(0.34, 0.58, 0.09, 0.09, 0.03), color: '#000000' },
    { sdf: roundBox(0.32, 0.17, 0.05, 0.1, 0.05), color: '#000000' },
    { sdf: roundBox(0.68, 0.17, 0.05, 0.1, 0.05), color: '#000000' },
  ]
}

function write(relPath, size, layers) {
  const file = join(root, relPath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, encodePng(size, render(size, layers)))
  console.log(`wrote ${relPath} (${size}px)`)
}

write('build/icon.png', 1024, appIconLayers())
write('resources/icon.png', 256, appIconLayers())
for (const [suffix, size] of [
  ['', 16],
  ['@2x', 32],
]) {
  write(`resources/tray${suffix}.png`, size, trayLayers({ error: false }))
  write(`resources/tray-error${suffix}.png`, size, trayLayers({ error: true }))
  write(`resources/trayTemplate${suffix}.png`, size, templateLayers())
}
