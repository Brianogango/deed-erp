// Generates icon-192.png and icon-512.png in /public
// Navy background (#1B2762) with white "d" — no external deps needed
import { deflateSync } from 'zlib'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'public')

function crc32(buf) {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const payload = Buffer.concat([typeBytes, data])
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(payload))
  return Buffer.concat([len, payload, crcBuf])
}

function makePNG(size) {
  // Background: #1B2762 (navy)
  const bgR = 0x1B, bgG = 0x27, bgB = 0x62
  // Letter "d" rendered as a simple pixel art at target scale
  // We'll draw a filled rounded square bg + white circle + white "d" mark

  const pixels = new Uint8Array(size * size * 4) // RGBA

  // Fill background
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4 + 0] = bgR
    pixels[i * 4 + 1] = bgG
    pixels[i * 4 + 2] = bgB
    pixels[i * 4 + 3] = 255
  }

  // Draw white circle in center (60% of size radius)
  const cx = size / 2, cy = size / 2
  const outerR = size * 0.38
  const innerR = size * 0.22
  const stemW = size * 0.10
  const stemH = size * 0.52
  const stemX = cx - size * 0.05
  const stemTop = cy - stemH / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)

      // Outer circle (white)
      if (dist <= outerR) {
        pixels[(y * size + x) * 4 + 0] = 255
        pixels[(y * size + x) * 4 + 1] = 255
        pixels[(y * size + x) * 4 + 2] = 255
        pixels[(y * size + x) * 4 + 3] = 255
      }

      // Inner circle cutout (navy) — forms the "bowl" of the d
      const bowlCx = cx + size * 0.04
      const bowlCy = cy
      const bowlDx = x - bowlCx, bowlDy = y - bowlCy
      const bowlDist = Math.sqrt(bowlDx * bowlDx + bowlDy * bowlDy)
      if (bowlDist <= innerR) {
        pixels[(y * size + x) * 4 + 0] = bgR
        pixels[(y * size + x) * 4 + 1] = bgG
        pixels[(y * size + x) * 4 + 2] = bgB
        pixels[(y * size + x) * 4 + 3] = 255
      }

      // Vertical stem of "d" — thin rectangle on left side of circle
      if (
        x >= stemX - stemW / 2 && x <= stemX + stemW / 2 &&
        y >= stemTop && y <= stemTop + stemH &&
        dist > outerR * 0.55  // only draw where outside inner bowl zone
      ) {
        pixels[(y * size + x) * 4 + 0] = 255
        pixels[(y * size + x) * 4 + 1] = 255
        pixels[(y * size + x) * 4 + 2] = 255
        pixels[(y * size + x) * 4 + 3] = 255
      }

      // Re-cut the bowl area to make "d" shape clean
      if (bowlDist <= innerR) {
        pixels[(y * size + x) * 4 + 0] = bgR
        pixels[(y * size + x) * 4 + 1] = bgG
        pixels[(y * size + x) * 4 + 2] = bgB
        pixels[(y * size + x) * 4 + 3] = 255
      }
    }
  }

  // Build PNG raw scanlines (RGBA = color type 6)
  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter none
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4
      const dst = y * (size * 4 + 1) + 1 + x * 4
      raw[dst + 0] = pixels[src + 0]
      raw[dst + 1] = pixels[src + 1]
      raw[dst + 2] = pixels[src + 2]
      raw[dst + 3] = pixels[src + 3]
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [192, 512]) {
  const out = join(outDir, `icon-${size}.png`)
  writeFileSync(out, makePNG(size))
  console.log(`✓ ${out}`)
}
