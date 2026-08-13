import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test'
import { E2E_USER } from './global-setup'
import {
  cancelRepair,
  cleanupProduct,
  createE2eProduct,
  createE2eVendor,
  e2eTag,
  jsonOrThrow,
  loginViaApi,
} from './helpers'

/**
 * AGENT-QA-001 — critical business workflows.
 *
 * API-first (same pattern as smoke.spec.ts): exercises real HTTP routes against
 * Postgres. UI checks stay limited to login/dashboard navigation.
 *
 * Credentials come from e2e/global-setup (overridable via E2E_USERNAME / E2E_PASSWORD).
 */

test.describe('1. Login and dashboard navigation', () => {
  test('rejects invalid credentials and keeps the user on /login', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByPlaceholder('your.username')).toBeVisible()
    await page.getByPlaceholder('your.username').fill('nobody')
    await page.getByPlaceholder('••••••••••••').fill('wrong-password')
    await page.locator('button[type="submit"]').click()
    await page.waitForTimeout(1200)
    expect(page.url()).toContain('/login')
  })

  test('director logs in and reaches the dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('your.username').fill(E2E_USER.username)
    await page.getByPlaceholder('••••••••••••').fill(E2E_USER.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20_000 })
    expect(page.url()).not.toContain('/login')
    // Dashboard / home is the default authenticated landing route.
    await expect(page.locator('body')).toBeVisible()
    await page.goto('/')
    await expect(page.getByText('Application error: a client-side exception has occurred')).toHaveCount(0)
  })
})

test.describe('2. Quote → sale order → invoice → payment', () => {
  let context: BrowserContext
  let api: APIRequestContext
  const tag = e2eTag('quote')

  test.beforeAll(async ({ browser }) => {
    context = await loginViaApi(browser)
    api = context.request
  })

  test.afterAll(async () => {
    await context?.close()
  })

  test('approves a quote, confirms SO, invoices, and records payment', async () => {
    const customer = `E2E Quote Customer ${tag}`

    const quoteRes = await api.post('/api/quotes', {
      data: {
        customerName: customer,
        total: 5800,
        subtotal: 5000,
        taxAmount: 800,
        lines: [{ description: `Mainboard repair ${tag}`, qty: 1, unitPrice: 5000, taxRate: 16 }],
      },
    })
    const quote = await jsonOrThrow(quoteRes, 'create quote')
    expect(quote.quoteNumber).toMatch(/^QUO\//)
    expect(quote.id).toBeTruthy()

    const sent = await api.patch(`/api/quotes/${quote.id}`, { data: { status: 'sent' } })
    expect(sent.status()).toBe(200)
    const accepted = await api.patch(`/api/quotes/${quote.id}`, { data: { status: 'accepted' } })
    expect(accepted.status()).toBe(200)
    const acceptedBody = await accepted.json()
    // Server stores approved; client-facing mapping may still say accepted.
    expect(['approved', 'accepted']).toContain(acceptedBody.status)

    const soRes = await api.post('/api/sale-orders', {
      data: {
        customerName: customer,
        quoteId: quote.id,
        lines: [{ productName: `Mainboard repair ${tag}`, qty: 1, unitPrice: 5000, taxRate: 16, lineTotal: 5800 }],
        total: 5800,
        subtotal: 5000,
        taxAmount: 800,
      },
    })
    const so = await jsonOrThrow(soRes, 'create sale order')
    expect(so.status).toBe('quotation')
    expect(so.id).toBeTruthy()

    const markedSent = await api.patch(`/api/sale-orders/${so.id}`, { data: { status: 'quotation_sent' } })
    expect(markedSent.status()).toBe(200)
    const confirmed = await api.patch(`/api/sale-orders/${so.id}`, { data: { status: 'sale' } })
    expect(confirmed.status()).toBe(200)
    const saleBody = await confirmed.json()
    expect(saleBody.status).toBe('sale')
    expect(saleBody.confirmedAt).toBeTruthy()

    const invRes = await api.post('/api/invoices', {
      data: {
        partnerName: customer,
        saleOrderId: so.id,
        status: 'posted',
        total: 5800,
        subtotal: 5000,
        taxTotal: 800,
        lines: [{ description: `Mainboard repair ${tag}`, qty: 1, unitPrice: 5000, subtotal: 5000 }],
      },
    })
    const invoice = await jsonOrThrow(invRes, 'create invoice')
    expect(invoice.invoiceNumber).toMatch(/^INV\//)

    const payRes = await api.post(`/api/invoices/${invoice.id}/payments`, {
      data: { amount: 5800, paymentMethod: 'mpesa', reference: `E2E-PAY-${tag}` },
    })
    const paid = await jsonOrThrow(payRes, 'record payment')
    expect(Number(paid.invoice.amountPaid)).toBe(5800)
    expect(paid.invoice.status).toBe('approved')
  })
})

test.describe('3. Repair intake → diagnosis → completion → collection', () => {
  let context: BrowserContext
  let api: APIRequestContext
  let repairId = ''
  const tag = e2eTag('repair')

  test.beforeAll(async ({ browser }) => {
    context = await loginViaApi(browser)
    api = context.request
  })

  test.afterAll(async () => {
    if (repairId) await cancelRepair(api, repairId)
    await context?.close()
  })

  test('walks repair through diagnosis, ready, and collected', async () => {
    const created = await api.post('/api/repairs', {
      data: {
        customerName: `E2E Repair Customer ${tag}`,
        customerPhone: `07${String(Date.now()).slice(-8)}`,
        productName: `ThinkPad E2E ${tag}`,
        issueDescription: 'No power — e2e critical workflow',
        status: 'received',
      },
    })
    const repair = await jsonOrThrow(created, 'create repair')
    expect(repair.ref).toMatch(/^REP\//)
    repairId = repair.id
    expect(repair.status).toBeTruthy()

    const assigned = await api.patch(`/api/repairs/${repairId}`, {
      data: {
        status: 'assigned',
        assignedTechnicianId: 'e2e-tech',
        assignedTechnicianName: 'E2E Technician',
        assignedDate: new Date().toISOString(),
      },
    })
    expect((await jsonOrThrow(assigned, 'assign repair')).item.status).toBe('assigned')

    const diagnosed = await api.patch(`/api/repairs/${repairId}`, {
      data: {
        status: 'diagnosed',
        diagnosis: {
          findings: 'Blown DC jack',
          faultDescription: 'No power',
          recommendedAction: 'Replace DC jack',
          estimatedHours: 1,
          diagnosedBy: 'E2E Technician',
          diagnosedDate: new Date().toISOString(),
        },
      },
    })
    expect((await jsonOrThrow(diagnosed, 'diagnose repair')).item.status).toBe('diagnosed')

    for (const [status, extra] of [
      ['approved', {}],
      ['in_repair', { repairStartDate: new Date().toISOString() }],
      ['qc', { repairCompletedDate: new Date().toISOString() }],
      ['ready', { qcPassedDate: new Date().toISOString(), qcApprovedBy: 'E2E QC' }],
      ['collected', { collectedDate: new Date().toISOString() }],
    ] as Array<[string, Record<string, unknown>]>) {
      const res = await api.patch(`/api/repairs/${repairId}`, { data: { status, ...extra } })
      const body = await jsonOrThrow(res, `repair → ${status}`)
      expect(body.item.status).toBe(status)
    }
  })
})

test.describe('4. POS session → transaction → close session', () => {
  let context: BrowserContext
  let api: APIRequestContext
  let productId = ''
  const tag = e2eTag('pos')
  const sessionId = `sess_${tag}`
  const orderRef = `POS-${tag}`

  test.beforeAll(async ({ browser }) => {
    context = await loginViaApi(browser)
    api = context.request
  })

  test.afterAll(async () => {
    // Ensure session is closed even if the test failed mid-flight.
    await api?.post('/api/store', {
      data: {
        deed_posSessionOpen: false,
        deed_posSessionId: null,
      },
    }).catch(() => {})
    if (productId) await cleanupProduct(api, productId)
    await context?.close()
  })

  test('opens a session, sells stocked item, and closes the session', async () => {
    const product = await createE2eProduct(api, `E2E POS Item ${tag}`)
    productId = product.id
    const vendor = await createE2eVendor(api, `E2E POS Vendor ${tag}`)

    // Seed 3 units into warehouse so POS can deduct.
    const receive = await api.post('/api/inventory/validate-receipt', {
      data: {
        applyStock: true,
        destination: 'warehouse',
        receiptId: `rec_${tag}`,
        receiptRef: `REC/${tag}`,
        lines: [{
          productId: product.id,
          productName: product.name,
          qtyReceived: 3,
          requiresSerial: false,
          serials: [],
        }],
      },
    })
    const stocked = await jsonOrThrow(receive, 'seed POS stock')
    expect(stocked.stockApplied).toBe(true)
    void vendor

    const openedAt = new Date().toISOString()
    const open = await api.post('/api/store', {
      data: {
        deed_posSessionOpen: true,
        deed_posSessionId: sessionId,
        deed_posSessionOpeningCash: 1000,
        deed_posSessions: [{
          id: sessionId,
          ref: `POSSESS-${tag}`,
          status: 'open',
          openedAt,
          openingCash: 1000,
          totalSales: 0,
          totalCash: 0,
          totalMpesa: 0,
          totalCard: 0,
          orderCount: 0,
        }],
      },
    })
    expect(open.status()).toBe(200)

    const deduct = await api.post('/api/inventory/apply-pos-stock', {
      data: {
        orderRef,
        lines: [{
          productId: product.id,
          productName: product.name,
          qty: 1,
          sourceLocation: 'warehouse',
        }],
      },
    })
    const moves = await jsonOrThrow(deduct, 'POS stock deduct')
    expect(moves.ok).toBe(true)

    const invRes = await api.post('/api/invoices', {
      data: {
        partnerName: 'Walk-in Customer',
        status: 'posted',
        total: 1160,
        subtotal: 1000,
        taxTotal: 160,
        amountPaid: 1160,
        notes: `POS ${orderRef}`,
        lines: [{
          description: `${product.name} ×1`,
          qty: 1,
          unitPrice: 1000,
          taxRate: 16,
          subtotal: 1000,
          productId: product.id,
        }],
      },
    })
    const invoice = await jsonOrThrow(invRes, 'POS invoice')
    expect(invoice.invoiceNumber).toMatch(/^INV\//)

    const orderDate = new Date().toISOString()
    const persistOrder = await api.post('/api/store', {
      data: {
        deed_posOrders: [{
          id: `ord_${tag}`,
          ref: orderRef,
          sessionId,
          lines: [{ productId: product.id, productName: product.name, qty: 1, unitPrice: 1000 }],
          subtotal: 1000,
          taxTotal: 160,
          total: 1160,
          payment: 'cash',
          date: orderDate,
          invoiceId: invoice.id,
        }],
      },
    })
    expect(persistOrder.status()).toBe(200)

    const closedAt = new Date().toISOString()
    const close = await api.post('/api/store', {
      data: {
        deed_posSessionOpen: false,
        deed_posSessionId: null,
        deed_posSessions: [{
          id: sessionId,
          ref: `POSSESS-${tag}`,
          status: 'closed',
          openedAt,
          closedAt,
          openingCash: 1000,
          closingCash: 2160,
          expectedCash: 2160,
          cashDifference: 0,
          totalSales: 1160,
          totalCash: 1160,
          totalMpesa: 0,
          totalCard: 0,
          orderCount: 1,
        }],
      },
    })
    expect(close.status()).toBe(200)

    const verify = await api.get('/api/store?keys=deed_posSessionOpen,deed_posSessionId,deed_posSessions')
    expect(verify.status()).toBe(200)
    const state = await verify.json()
    expect(state.deed_posSessionOpen).toBe(false)
    const sessions = Array.isArray(state.deed_posSessions) ? state.deed_posSessions : []
    const ours = sessions.find((s: { id: string }) => s.id === sessionId)
    expect(ours?.status).toBe('closed')
  })
})

test.describe('5. Inventory receipt (GRN) → stock level update', () => {
  let context: BrowserContext
  let api: APIRequestContext
  let productId = ''
  const tag = e2eTag('grn')
  const qty = 5

  test.beforeAll(async ({ browser }) => {
    context = await loginViaApi(browser)
    api = context.request
  })

  test.afterAll(async () => {
    if (productId) await cleanupProduct(api, productId)
    await context?.close()
  })

  test('creates PO, receives GRN stock, and verifies on-hand qty', async () => {
    const product = await createE2eProduct(api, `E2E GRN Widget ${tag}`)
    productId = product.id
    const vendor = await createE2eVendor(api, `E2E GRN Vendor ${tag}`)

    const poRes = await api.post('/api/purchase-orders', {
      data: {
        vendorId: vendor.id,
        vendorName: vendor.name,
        status: 'draft',
        lines: [{
          id: `pol_${tag}`,
          productId: product.id,
          productName: product.name,
          qty,
          qtyReceived: 0,
          unitPrice: 600,
          taxRate: 16,
          subtotal: 3000,
          requiresSerial: false,
        }],
        subtotal: 3000,
        taxTotal: 480,
        total: 3480,
        receiptIds: [],
        notes: `e2e ${tag}`,
      },
    })
    const poBody = await jsonOrThrow(poRes, 'create PO')
    const po = poBody.item
    expect(po.id).toBeTruthy()
    expect(po.ref).toBeTruthy()

    const confirm = await api.patch(`/api/purchase-orders/${po.id}`, { data: { status: 'confirmed' } })
    expect((await jsonOrThrow(confirm, 'confirm PO')).item.status).toBe('confirmed')

    const receiptId = `rec_${tag}`
    const grnRes = await api.post('/api/receipts', {
      data: {
        id: receiptId,
        poId: po.id,
        poRef: po.ref,
        vendorId: vendor.id,
        vendorName: vendor.name,
        status: 'draft',
        date: new Date().toISOString().slice(0, 10),
        destinationLocation: 'warehouse',
        lines: [{
          productId: product.id,
          productName: product.name,
          qtyExpected: qty,
          qtyReceived: 0,
          serials: [],
          requiresSerial: false,
        }],
      },
    })
    const grn = await jsonOrThrow(grnRes, 'create GRN')
    expect(grn.item.id).toBe(receiptId)
    const receiptRef = grn.item.ref || `REC/${tag}`

    const validate = await api.post('/api/inventory/validate-receipt', {
      data: {
        applyStock: true,
        destination: 'warehouse',
        receiptId,
        receiptRef,
        purchaseOrderId: po.id,
        lines: [{
          productId: product.id,
          productName: product.name,
          qtyReceived: qty,
          requiresSerial: false,
          serials: [],
        }],
      },
    })
    const applied = await jsonOrThrow(validate, 'validate GRN / apply stock')
    expect(applied.ok !== false).toBe(true)
    expect(applied.stockApplied).toBe(true)
    expect(Array.isArray(applied.moves) ? applied.moves.length : 0).toBeGreaterThan(0)

    await api.put(`/api/receipts/${receiptId}`, {
      data: {
        status: 'validated',
        lines: [{
          productId: product.id,
          productName: product.name,
          qtyExpected: qty,
          qtyReceived: qty,
          serials: [],
          requiresSerial: false,
        }],
        destinationLocation: 'warehouse',
      },
    })

    await api.patch(`/api/purchase-orders/${po.id}`, {
      data: {
        status: 'received',
        lines: [{
          id: `pol_${tag}`,
          productId: product.id,
          productName: product.name,
          qty,
          qtyReceived: qty,
          unitPrice: 600,
          taxRate: 16,
          subtotal: 3000,
          requiresSerial: false,
        }],
        receiptIds: [receiptId],
      },
    })

    const stockRes = await api.get('/api/store?keys=deed_bulkStock')
    expect(stockRes.status()).toBe(200)
    const stockState = await stockRes.json()
    const bulk = Array.isArray(stockState.deed_bulkStock) ? stockState.deed_bulkStock : []
    const row = bulk.find(
      (b: { productId: string; location?: string }) =>
        b.productId === product.id && (b.location === 'warehouse' || !b.location),
    )
    expect(row, 'warehouse bulk stock row after GRN').toBeTruthy()
    expect(Number(row.qty)).toBeGreaterThanOrEqual(qty)
  })
})
