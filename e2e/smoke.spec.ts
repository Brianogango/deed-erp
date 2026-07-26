import { test, expect, type APIRequestContext, type Browser } from '@playwright/test'
import { E2E_USER } from './global-setup'

/**
 * Smoke tests for the critical money paths:
 *   login → repair intake → quote rules → invoice rules → portal visibility.
 * UI coverage is intentionally shallow (render + key interactions); the
 * document flows are exercised through the real HTTP APIs against a real
 * Postgres database, which is where the production bugs have lived.
 */

async function loginViaApi(browser: Browser) {
  const context = await browser.newContext()
  const res = await context.request.post('/api/auth/login', {
    data: { username: E2E_USER.username, password: E2E_USER.password },
  })
  expect(res.status(), 'login should succeed').toBe(200)
  return context
}

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
    const res = await api.get('/api/repairs')
    expect(res.status()).toBe(200)
    const repairs = await res.json()
    expect(repairs.some((r: any) => r.ref === repairRef)).toBe(true)
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
    expect(qa.quoteNumber).toMatch(/^QTE-\d{5}$/)
    expect(qb.quoteNumber).toMatch(/^QTE-\d{5}$/)
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
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{5}$/)

    const payment = await api.post(`/api/invoices/${invoice.id}/payments`, {
      data: { amount: 5800, paymentMethod: 'mpesa', reference: 'E2E-MPESA-01' },
    })
    expect(payment.status()).toBe(200)
    const payload = await payment.json()
    expect(Number(payload.invoice.amountPaid)).toBe(5800)
    expect(payload.invoice.status).toBe('paid')
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

test.describe('module render smoke', () => {
  // Every major module route must render without a client-side crash.
  // This guards the feature-store splits: several modules are @ts-nocheck,
  // so a missing key in a store slice would only fail at runtime.
  const routes = [
    '/', '/sales', '/contacts', '/inventory', '/operations', '/purchases',
    '/pos', '/repairs', '/refurbishment', '/delivery', '/ecommerce',
    '/kilimall', '/finance', '/hr', '/outsource', '/aftersales',
    '/deposits', '/holdovers', '/expenses', '/settings',
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
