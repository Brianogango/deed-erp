#!/usr/bin/env node
/**
 * Download Wikimedia / official source photos and write
 * data/catalog-photos/<packId>/{hero,detail}.jpg (1600px, JPEG).
 *
 *   npx tsx scripts/download-catalog-photos.ts
 */
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { CATALOG_PHOTO_PACKS } from '../lib/catalog-photos'

const UA = 'DeedERP-catalog-photos/1.0 (https://deed.co.ke; product catalog)'
const MAX = 1600

async function fetchBuffer(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

async function normalize(buffer: Buffer) {
  return sharp(buffer, { failOn: 'none', limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer()
}

async function saveSlot(packId: string, slot: 1 | 2, url: string) {
  const dir = path.join(process.cwd(), 'data', 'catalog-photos', packId)
  await mkdir(dir, { recursive: true })
  const dest = path.join(dir, slot === 1 ? 'hero.jpg' : 'detail.jpg')
  const raw = await fetchBuffer(url)
  const jpeg = await normalize(raw)
  await writeFile(dest, jpeg)
  return { dest, bytes: jpeg.length }
}

async function main() {
  const only = process.argv.slice(2).filter(arg => !arg.startsWith('-'))
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
    if (exists) {
      console.log(`${pack.id}  already present`)
      ok += 1
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
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  console.log(`done packs=${ok} failed=${fail}`)
  if (fail && !ok) process.exitCode = 1
}

main()
