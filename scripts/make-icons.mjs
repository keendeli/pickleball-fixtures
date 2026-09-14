// Generates the PWA icons as PNGs with no dependencies: a green rounded
// square with a yellow pickleball (holes and all). Run: npm run icons
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
mkdirSync(out, { recursive: true })

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const BG = [31, 122, 77]
const BALL = [246, 201, 42]
const HOLE = [200, 156, 20]

function render(size, { padding }) {
  const buf = Buffer.alloc(size * size * 4)
  const c = size / 2
  const ballR = size * (0.5 - padding)
  const holeR = size * 0.045
  const cornerR = size * 0.18
  const holes = []
  const ringR = ballR * 0.55
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    holes.push([c + Math.cos(a) * ringR, c + Math.sin(a) * ringR])
  }
  holes.push([c, c])
  const put = (x, y, rgb, a = 255) => {
    const i = (y * size + x) * 4
    buf[i] = rgb[0]
    buf[i + 1] = rgb[1]
    buf[i + 2] = rgb[2]
    buf[i + 3] = a
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5
      // rounded-square background
      const dx = Math.max(Math.abs(px - c) - (c - cornerR), 0)
      const dy = Math.max(Math.abs(py - c) - (c - cornerR), 0)
      if (Math.hypot(dx, dy) > cornerR) {
        put(x, y, BG, 0)
        continue
      }
      const d = Math.hypot(px - c, py - c)
      if (d > ballR) {
        put(x, y, BG)
        continue
      }
      let colour = BALL
      for (const [hx, hy] of holes) if (Math.hypot(px - hx, py - hy) < holeR) colour = HOLE
      // simple edge shading on the ball
      if (d > ballR - size * 0.012) colour = HOLE
      put(x, y, colour)
    }
  }
  return png(size, size, buf)
}

writeFileSync(join(out, 'icon-192.png'), render(192, { padding: 0.12 }))
writeFileSync(join(out, 'icon-512.png'), render(512, { padding: 0.12 }))
writeFileSync(join(out, 'apple-touch-icon.png'), render(180, { padding: 0.12 }))
console.log('icons written to', out)
