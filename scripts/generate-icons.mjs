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
const union =
  (...shapes) =>
  (x, y) =>
    Math.min(...shapes.map((f) => f(x, y)))
/** Half-plane, negative where x*nx + y*ny < d (with n normalised). */
const halfPlane = (nx, ny, d) => {
  const len = Math.hypot(nx, ny)
  return (x, y) => (x * nx + y * ny) / len - d
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
/** Vertical linear gradient from `top` (y = y0) to `bottom` (y = y1). */
const verticalGradient = (top, bottom, y0 = 0.05, y1 = 0.95) => {
  const a = hex(top)
  const b = hex(bottom)
  return (x, y) => {
    const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)))
    return a.map((v, i) => v + (b[i] - v) * t)
  }
}

/**
 * layers: [{ sdf, color: '#rrggbb' | (x, y) => [r, g, b] } | { sdf, erase: true }]
 * painted in order.
 */
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
        const [lr, lg, lb] = typeof layer.color === 'function' ? layer.color(x, y) : hex(layer.color)
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

// ---- Silhouette mark ---------------------------------------------------------
// A calendar page cut diagonally: the left half shows event details, the right
// half shows the same events as plain shapes - what the app does to a calendar.
const INDIGO_LIGHT = '#818CF8'
const INDIGO = '#4338CA'
const INK = '#312E81' // header, and events in silhouette
const SHADOW = '#1E1B4B' // the silhouetted half of the page
const WHITE = '#FFFFFF'
const AMBER = '#F59E0B'
const GREEN = '#10B981'
const RED = '#DC2626'

/** Splits a shape along a diagonal through (cx, cy): [detailed half, silhouetted half]. */
const splitAt = (cx, cy) => {
  const cut = halfPlane(1, 0.35, (cx + 0.35 * cy) / Math.hypot(1, 0.35))
  return [(s) => intersect(s, cut), (s) => intersect(s, (x, y) => -cut(x, y))]
}

function appIconLayers() {
  const page = roundBox(0.5, 0.56, 0.29, 0.27, 0.06)
  const [detail, shadow] = splitAt(0.541, 0.56)
  const header = intersect(page, roundBox(0.5, 0.37, 0.3, 0.08, 0))
  const event1 = roundBox(0.43, 0.55, 0.15, 0.045, 0.02)
  const event2 = roundBox(0.57, 0.68, 0.15, 0.045, 0.02)
  const textLines = union(roundBox(0.38, 0.55, 0.07, 0.008, 0.004), roundBox(0.5, 0.68, 0.06, 0.008, 0.004))
  const rings = union(roundBox(0.38, 0.29, 0.028, 0.065, 0.028), roundBox(0.62, 0.29, 0.028, 0.065, 0.028))
  return [
    { sdf: roundBox(0.5, 0.5, 0.45, 0.45, 0.2), color: verticalGradient(INDIGO_LIGHT, INDIGO) },
    { sdf: detail(page), color: WHITE },
    { sdf: detail(header), color: INK },
    { sdf: detail(event1), color: AMBER },
    { sdf: detail(event2), color: GREEN },
    { sdf: detail(textLines), color: WHITE },
    { sdf: shadow(page), color: SHADOW },
    { sdf: shadow(union(event1, event2)), color: INK },
    { sdf: rings, color: WHITE },
  ]
}

/** Windows/Linux tray: same mark, simplified to read at 16px. */
function trayLayers({ error }) {
  const page = roundBox(0.5, 0.56, 0.36, 0.33, 0.08)
  const [detail, shadow] = splitAt(0.53, 0.56)
  const header = intersect(page, roundBox(0.5, 0.31, 0.37, 0.09, 0))
  const event = roundBox(0.5, 0.62, 0.24, 0.1, 0.04)
  const layers = [
    { sdf: roundBox(0.5, 0.5, 0.48, 0.48, 0.16), color: verticalGradient(INDIGO_LIGHT, INDIGO, 0, 1) },
    { sdf: detail(page), color: WHITE },
    { sdf: detail(header), color: INK },
    { sdf: detail(event), color: AMBER },
    { sdf: shadow(page), color: SHADOW },
    { sdf: shadow(event), color: INK },
  ]
  if (error) {
    layers.push({ sdf: circle(0.78, 0.78, 0.24), erase: true })
    layers.push({ sdf: circle(0.78, 0.78, 0.2), color: RED })
  }
  return layers
}

/** macOS template image: black glyph + alpha; the system tints it. Hollow page on the left, solid on the right. */
function templateLayers() {
  const page = roundBox(0.5, 0.55, 0.4, 0.37, 0.09)
  const inside = roundBox(0.5, 0.62, 0.3, 0.22, 0.04)
  const [detail] = splitAt(0.52, 0.6)
  return [
    { sdf: page, color: '#000000' },
    { sdf: detail(inside), erase: true },
    { sdf: intersect(roundBox(0.36, 0.58, 0.1, 0.07, 0.03), detail(page)), color: '#000000' },
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
// Used by the GitHub Pages site (docs/).
write('docs/logo.png', 256, appIconLayers())
for (const [suffix, size] of [
  ['', 16],
  ['@2x', 32],
]) {
  write(`resources/tray${suffix}.png`, size, trayLayers({ error: false }))
  write(`resources/tray-error${suffix}.png`, size, trayLayers({ error: true }))
  write(`resources/trayTemplate${suffix}.png`, size, templateLayers())
}
