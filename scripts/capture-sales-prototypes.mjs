#!/usr/bin/env node
/**
 * Capture Sales Module prototype screenshots (desktop / tablet / mobile).
 * Usage: VISREG_BASE_URL=http://127.0.0.1:3000 node scripts/capture-sales-prototypes.mjs
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE_URL = process.env.VISREG_BASE_URL || 'http://127.0.0.1:3000'
const OUT_DIR = process.env.VISREG_OUT_DIR || path.join('docs', 'sales-module', 'screenshots')

const viewports = [
  { name: 'desktop-1440', width: 1440, height: 1024 },
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'mobile-390', width: 390, height: 844 },
]

const routes = [
  { slug: '01-quotations-list', path: '/sales-prototype/quotations' },
  { slug: '02-create-quotation', path: '/sales-prototype/quotations/new' },
  { slug: '03-quotation-detail', path: '/sales-prototype/quotations/quo-001' },
  { slug: '04-sales-order', path: '/sales-prototype/orders/so-001' },
  { slug: '05-delivery-picking', path: '/sales-prototype/deliveries/dn-001' },
  { slug: '06-invoice-create', path: '/sales-prototype/invoices/new' },
  { slug: '07-invoice-payment', path: '/sales-prototype/invoices/inv-001' },
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    for (const route of routes) {
      const dir = path.join(OUT_DIR, route.slug)
      await mkdir(dir, { recursive: true })
      for (const vp of viewports) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1,
        })
        const page = await context.newPage()
        const url = `${BASE_URL}${route.path}`
        const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
        await sleep(800)
        const file = path.join(dir, `${vp.name}.png`)
        await page.screenshot({ path: file, fullPage: true })
        console.log(`saved ${file} status=${res?.status()}`)
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
