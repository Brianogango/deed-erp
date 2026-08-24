import { test, expect, type APIRequestContext } from '@playwright/test'
import { E2E_USER } from './global-setup'
import { loginViaApi } from './helpers'

/**
 * Smoke tests for the critical money paths:
 *   login → repair intake → quote rules → invoice rules → portal visibility.
 * UI coverage is intentionally shallow (render + key interactions); the
 * document flows are exercised through the real HTTP APIs against a real
 * Postgres database, which is where the production bugs have lived.
 *
 * Broader journey coverage lives in e2e/critical-workflows.spec.ts (AGENT-QA-001).
 */

test.describe('authentication', () => {
  test('login page renders and rejects bad credentials', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByPlaceholder('your.username')).toBeVisible()

    await page.getByPlaceholder('your.username').fill('nobody')
    await page.getByPlaceholder('••••••••••••').fill('wrong-password')
    await page.locator('button[type="submit"]').click()
    // Stays on login (no session cookie issued)
    await page.waitForTimeout(1500)
    expect(page.url()).toContain('/login')
  })

  test('director can log in through the login form', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('your.username').fill(E2E_USER.username)
    await page.getByPlaceholder('••••••••••••').fill(E2E_USER.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20_000 })
    expect(page.url()).not.toContain('/login')
  })
})

test.describe('repair → quote → invoice money path', () => {
  let api: APIRequestContext
  let repairRef = ''
  let repairId = ''

  test.beforeAll(async ({ browser }) => {
    const context = await loginViaApi(browser)
    api = context.request
  })

  test('creates a repair with a server-generated reference', async () => {
    const res = await api.post('/api/repairs', {
      data: {
        customerName: 'E2E Customer',
        customerPhone: '0712000111',
        productName: 'Lenovo ThinkPad X1',
        issueDescription: 'Does not power on',
      },
    })
    expect(res.status()).toBe(201)
    const repair = await res.json()
    expect(repair.ref).toMatch(/^REP\//)
    repairRef = repair.ref
    repairId = repair.id
  })

  test('lists the repair in the ERP', async () => {
    const res = await api.get(`/api/repairs?q=${encodeURIComponent(repairRef)}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    const repairs = Array.isArray(body) ? body : (body.items ?? [])
    expect(repairs.some((r: any) => r.ref === repairRef)).toBe(true)
    expect(body.total).toBeGreaterThanOrEqual(1)
  })

  test('rejects quotes with a total below 1', async () => {
    const res = await api.post('/api/quotes', {
      data: { customerName: 'E2E Customer', total: 0 },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/at least 1/i)
  })

  test('creates quotes with unique sequential numbers', async () => {
    const make = () => api.post('/api/quotes', {
      data: {
        customerName: 'E2E Customer',
        source: 'repair',
        repairId,
        repairRef,
        total: 5800,
        subtotal: 5000,
        taxAmount: 800,
        lines: [{ description: 'Mainboard repair', qty: 1, unitPrice: 5000, taxRate: 16 }],
      },
    })
    const [a, b] = await Promise.all([make(), make()])
    expect(a.status()).toBe(201)
    expect(b.status()).toBe(201)
    const [qa, qb] = [await a.json(), await b.json()]
    expect(qa.quoteNumber).toMatch(/^QUO\/\d{4}\/\d{4}$/)
    expect(qb.quoteNumber).toMatch(/^QUO\/\d{4}\/\d{4}$/)
    expect(qa.quoteNumber).not.toBe(qb.quoteNumber)
  })

  test('rejects invoices with a total below 1', async () => {
    const res = await api.post('/api/invoices', {
      data: { partnerName: 'E2E Customer', total: 0.5 },
    })
    expect(res.status()).toBe(400)
  })

  test('creates a repair invoice and pays it', async () => {
    const created = await api.post('/api/invoices', {
      data: {
        partnerName: 'E2E Customer',
        repairId,
        notes: `Repair ${repairRef} — e2e`,
        total: 5800,
        subtotal: 5000,
        taxTotal: 800,
        status: 'posted',
        lines: [{ description: 'Mainboard repair', qty: 1, unitPrice: 5000, subtotal: 5000 }],
      },
    })
    expect(created.status()).toBe(201)
    const invoice = await created.json()
    expect(invoice.invoiceNumber).toMatch(/^INV\/\d{4}\/\d{4}$/)

    const payment = await api.post(`/api/invoices/${invoice.id}/payments`, {
      data: { amount: 5800, paymentMethod: 'mpesa', reference: 'E2E-MPESA-01' },
    })
    expect(payment.status()).toBe(200)
    const payload = await payment.json()
    expect(Number(payload.invoice.amountPaid)).toBe(5800)
    // Odoo semantics: the stored status stays a pure document state; payment
    // progress (Paid) is derived from amountPaid, never written into status.
    expect(payload.invoice.status).toBe('approved')
  })

  test('mirrors repairs into the relational table via backfill', async () => {
    const res = await api.post('/api/admin/backfill-repairs')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.total).toBeGreaterThan(0)
    expect(body.mirrored + body.skipped).toBeGreaterThan(0)
    expect(body.failed).toBe(0)
  })

  test('customer portal shows the repair without authentication', async ({ browser }) => {
    const anon = await browser.newContext()
    const page = await anon.newPage()
    await page.goto(`/portal/repair/${encodeURIComponent(repairRef)}`)
    await expect(page.getByText(repairRef).first()).toBeVisible({ timeout: 15_000 })
    await anon.close()
  })

  test('repairs module lists the repair in the UI', async ({ browser }) => {
    const context = await loginViaApi(browser)
    const page = await context.newPage()
    await page.goto('/repairs')
    await expect(page.getByText(repairRef).first()).toBeVisible({ timeout: 30_000 })
    await context.close()
  })
})

test.describe('odoo sales workflow enforcement', () => {
  let api: APIRequestContext
  let soId = ''

  test.beforeAll(async ({ browser }) => {
    const context = await loginViaApi(browser)
    api = context.request
  })

  test('walks Quotation → Quotation Sent → Sales Order with server stamps', async () => {
    const created = await api.post('/api/sale-orders', {
      data: {
        customerName: 'E2E Workflow Customer',
        lines: [{ productName: 'Router', qty: 1, unitPrice: 4000, taxRate: 0, lineTotal: 4000 }],
        total: 4000,
        subtotal: 4000,
      },
    })
    expect(created.status()).toBe(201)
    const so = await created.json()
    expect(so.status).toBe('quotation')
    expect(so.ref).toMatch(/^QUO\/\d{4}\/\d{4}$/)
    soId = so.id

    const sent = await api.patch(`/api/sale-orders/${soId}`, { data: { status: 'quotation_sent' } })
    expect(sent.status()).toBe(200)
    const sentBody = await sent.json()
    expect(sentBody.status).toBe('quotation_sent')
    expect(sentBody.sentAt).toBeTruthy()

    const confirmed = await api.patch(`/api/sale-orders/${soId}`, { data: { status: 'sale' } })
    expect(confirmed.status()).toBe(200)
    const saleBody = await confirmed.json()
    expect(saleBody.status).toBe('sale')
    expect(saleBody.confirmedAt).toBeTruthy()
  })

  test('rejects a Sales Order being pushed back to Quotation Sent', async () => {
    const res = await api.patch(`/api/sale-orders/${soId}`, { data: { status: 'quotation_sent' } })
    expect(res.status()).toBe(409)
  })

  test('blocks cancelling a Sales Order once a posted invoice exists', async () => {
    const invoiced = await api.post('/api/invoices', {
      data: {
        partnerName: 'E2E Workflow Customer',
        saleOrderId: soId,
        status: 'posted',
        total: 4000,
        subtotal: 4000,
        lines: [{ description: 'Router', qty: 1, unitPrice: 4000, subtotal: 4000 }],
      },
    })
    expect(invoiced.status()).toBe(201)

    const cancel = await api.patch(`/api/sale-orders/${soId}`, { data: { status: 'cancelled' } })
    expect(cancel.status()).toBe(409)
    const body = await cancel.json()
    expect(body.error).toMatch(/posted invoice/i)
  })
})

test.describe('module render smoke', () => {
  // Every major module route must render without a client-side crash.
  // This guards the feature-store splits: several modules are @ts-nocheck,
  // so a missing key in a store slice would only fail at runtime.
  const routes = [
    '/', '/sales', '/contacts', '/inventory', '/operations', '/purchases',
    '/pos', '/repairs', '/refurbishment', '/delivery', '/ecommerce',
    '/kilimall', '/finance', '/hr', '/outsource', '/aftersales',
    '/deposits', '/holdovers', '/sops', '/expenses', '/settings',
  ]

  test('all module routes render without client-side exceptions', async ({ browser }) => {
    test.setTimeout(180_000)
    const context = await loginViaApi(browser)
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(`${page.url()}: ${err.message}`))

    for (const route of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(600)
      await expect(page.getByText('Application error: a client-side exception has occurred'))
        .toHaveCount(0, { timeout: 5_000 })
    }
    expect(pageErrors, `client-side exceptions:\n${pageErrors.join('\n')}`).toEqual([])
    await context.close()
  })
})


test.describe('responsive target workspaces', () => {
  const routes = [
    '/kilimall', '/sops', '/deposits', '/holdovers', '/settings',
    '/expenses',
    '/hr?tab=recruitment',
    '/hr?tab=training',
    '/hr?tab=leave',
    '/hr?tab=payroll',
    '/hr?tab=salary_advances',
    '/hr?tab=documents',
    '/hr?tab=assets',
    '/hr?tab=performance',
    '/hr?tab=reports',
  ]
  const viewports = [
    { width: 320, height: 700 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]

  test('renders without page-level overflow or client exceptions', async ({ browser }) => {
    test.setTimeout(420_000)
    const context = await loginViaApi(browser)
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(`${page.url()}: ${error.message}`))

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      for (const route of routes) {
        await page.goto(route, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(350)
        await expect(page.getByText('Application error: a client-side exception has occurred')).toHaveCount(0)
        const overflow = await page.evaluate(() =>
          Math.max(0, document.documentElement.scrollWidth - window.innerWidth)
        )
        expect(overflow, `${route} overflows at ${viewport.width}px`).toBeLessThanOrEqual(2)
      }
    }

    expect(pageErrors, `client-side exceptions:\n${pageErrors.join('\n')}`).toEqual([])
    await context.close()
  })
})
