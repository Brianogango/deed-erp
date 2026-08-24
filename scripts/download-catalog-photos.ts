#!/usr/bin/env node
/**
 * Download source photos, cut them onto a uniform studio field, and write
 * data/catalog-photos/<packId>/{hero,detail}.jpg (square JPEG, 1600px).
 *
 *   npx tsx scripts/download-catalog-photos.ts
 *   npx tsx scripts/download-catalog-photos.ts --force
 *   npx tsx scripts/download-catalog-photos.ts logitech-m185
 */
import { access, mkdir, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import sharp from 'sharp'
import { CATALOG_PHOTO_PACKS } from '../lib/catalog-photos'

const execFileAsync = promisify(execFile)
const UA = 'DeedERP-catalog-photos/1.0 (https://deed.co.ke; product catalog)'
const MAX = 1600

/** Fractional [left, top, right, bottom] crops applied before studio flatten. */
const PACK_CROPS: Record<string, { 1?: [number, number, number, number]; 2?: [number, number, number, number] }> = {
  'dell-latitude-2in1': {
    1: [0.40, 0.12, 0.98, 0.98],
    2: [0.46, 0.12, 0.92, 0.62],
  },
}

async function fetchBuffer(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

async function cropFractions(buffer: Buffer, box: [number, number, number, number]) {
  const meta = await sharp(buffer, { failOn: 'none', limitInputPixels: 40_000_000 }).rotate().metadata()
  const width = meta.width
  const height = meta.height
  if (!width || !height) return buffer
  const left = Math.max(0, Math.round(box[0] * width))
  const top = Math.max(0, Math.round(box[1] * height))
  const extractWidth = Math.max(1, Math.min(width - left, Math.round((box[2] - box[0]) * width)))
  const extractHeight = Math.max(1, Math.min(height - top, Math.round((box[3] - box[1]) * height)))
  return sharp(buffer, { failOn: 'none', limitInputPixels: 40_000_000 })
    .rotate()
    .extract({ left, top, width: extractWidth, height: extractHeight })
    .toBuffer()
}

async function stageJpeg(buffer: Buffer) {
  return sharp(buffer, { failOn: 'none', limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()
}

async function studioFlatten(filePath: string) {
  await execFileAsync('python3', [path.join(process.cwd(), 'scripts/studio-catalog-photo.py'), filePath, filePath], {
    env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH || ''}` },
    maxBuffer: 10 * 1024 * 1024,
  })
}

async function saveSlot(packId: string, slot: 1 | 2, url: string) {
  const dir = path.join(process.cwd(), 'data', 'catalog-photos', packId)
  await mkdir(dir, { recursive: true })
  const dest = path.join(dir, slot === 1 ? 'hero.jpg' : 'detail.jpg')
  let raw: Buffer = await fetchBuffer(url)
  const crop = PACK_CROPS[packId]?.[slot]
  if (crop) raw = Buffer.from(await cropFractions(raw, crop))
  const jpeg = await stageJpeg(raw)
  await writeFile(dest, jpeg)
  await studioFlatten(dest)
  const info = await stat(dest)
  return { dest, bytes: info.size }
}

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const only = args.filter(arg => !arg.startsWith('-'))
  const packs = only.length
    ? CATALOG_PHOTO_PACKS.filter(pack => only.includes(pack.id))
    : CATALOG_PHOTO_PACKS

  let ok = 0
  let fail = 0
  for (const pack of packs) {
    const dir = path.join(process.cwd(), 'data', 'catalog-photos', pack.id)
    const heroPath = path.join(dir, 'hero.jpg')
    const detailPath = path.join(dir, 'detail.jpg')
    const exists = await access(heroPath).then(() => true).catch(() => false)
      && await access(detailPath).then(() => true).catch(() => false)
    if (exists && !force && !PACK_CROPS[pack.id]) {
      try {
        await studioFlatten(heroPath)
        await studioFlatten(detailPath)
        console.log(`${pack.id}  studio-flattened existing`)
        ok += 1
      } catch (err) {
        fail += 1
        console.error(`${pack.id} FLATTEN FAILED:`, err instanceof Error ? err.message : err)
      }
      continue
    }
    let attempt = 0
    while (true) {
      try {
        const hero = await saveSlot(pack.id, 1, pack.source.hero)
        const detail = await saveSlot(pack.id, 2, pack.source.detail)
        console.log(`${pack.id}  hero ${hero.bytes}B  detail ${detail.bytes}B`)
        ok += 1
        break
      } catch (err) {
        attempt += 1
        const message = err instanceof Error ? err.message : String(err)
        if (attempt < 5 && /429|503|ECONNRESET/.test(message)) {
          const wait = attempt * 4000
          console.error(`${pack.id} retry in ${wait}ms: ${message}`)
          await new Promise(resolve => setTimeout(resolve, wait))
          continue
        }
        fail += 1
        console.error(`${pack.id} FAILED: ${message}`)
        break
      }
    }
    await new Promise(resolve => setTimeout(resolve, 800))
  }
  console.log(`done packs=${ok} failed=${fail}`)
  if (fail && !ok) process.exitCode = 1
}

main()
