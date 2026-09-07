#!/usr/bin/env node
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE_URL = process.env.VISREG_BASE_URL || 'http://127.0.0.1:3000'
const USERNAME = process.env.VISREG_USERNAME || ''
const PASSWORD = process.env.VISREG_PASSWORD || ''
const OUT_DIR = process.env.VISREG_OUT_DIR || path.join('docs', 'visual-regression', 'core')
const SKIP_LOGIN = process.env.VISREG_SKIP_LOGIN === 'true'

const viewports = [
  { name: '320', width: 320, height: 700 },
  { name: '375', width: 375, height: 812 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1366', width: 1366, height: 768 },
  { name: '1920', width: 1920, height: 1080 },
]

const routes = [
  { slug: 'dashboard', path: '/' },
  { slug: 'sales', path: '/sales' },
  { slug: 'inventory', path: '/inventory' },
  { slug: 'finance', path: '/finance' },
  { slug: 'hr-employees', path: '/hr?tab=employees' },
  { slug: 'hr-recruitment', path: '/hr?tab=recruitment' },
  { slug: 'hr-training', path: '/hr?tab=training' },
  { slug: 'hr-leave', path: '/hr?tab=leave' },
  { slug: 'hr-payroll', path: '/hr?tab=payroll' },
  { slug: 'hr-salary-advances', path: '/hr?tab=salary_advances' },
  { slug: 'hr-documents', path: '/hr?tab=documents' },
  { slug: 'hr-assets', path: '/hr?tab=assets' },
  { slug: 'hr-performance', path: '/hr?tab=performance' },
  { slug: 'hr-reports', path: '/hr?tab=reports' },
  { slug: 'expenses', path: '/expenses' },
  { slug: 'repairs', path: '/repairs' },
  { slug: 'kilimall', path: '/kilimall' },
  { slug: 'performance-targets', path: '/sops' },
  { slug: 'deposits', path: '/deposits' },
  { slug: 'holdovers', path: '/holdovers' },
  { slug: 'settings', path: '/settings' },
]

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function login(page) {
  if (SKIP_LOGIN) return
  if (!USERNAME || !PASSWORD) {
    throw new Error('Set VISREG_USERNAME and VISREG_PASSWORD env vars (or VISREG_SKIP_LOGIN=true). Credentials are never hardcoded.')
  }
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[autocomplete="username"]', USERNAME)
  await page.fill('input[autocomplete="current-password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30000 })
  await page.waitForLoadState('domcontentloaded')
  await sleep(1200)
}

async function captureRoute(browser, route) {
  const routeDir = path.join(OUT_DIR, route.slug)
  await mkdir(routeDir, { recursive: true })

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    await login(page)
    await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'domcontentloaded' })
    await sleep(1500)

    const filePath = path.join(routeDir, `${viewport.name}.png`)
    await page.screenshot({ path: filePath, fullPage: true })
    await context.close()
    console.log(`saved ${filePath}`)
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const route of routes) {
      await captureRoute(browser, route)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
