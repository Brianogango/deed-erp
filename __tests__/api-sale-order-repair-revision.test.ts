import { describe, it, expect, vi, beforeEach } from 'vitest'

// A revised repair quote reaching the repair's sale order in Sales.

const {
  mockGetSession,
  mockPrismaSO,
  mockPrismaInvoice,
  mockPrismaClient,
  mockPrismaStockReservation,
  mockResolveClientId,
  mockLoadAppState,
  mockSaveStoreKeys,
  mockWriteFinancialAudit,
  mockReserveStock,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrismaSO: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    delete: vi.fn(),
  },
  mockPrismaInvoice: {
    findMany: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: 0, amountPaid: 0 } }),
  },
  mockPrismaClient: {
    findUnique: vi.fn().mockResolvedValue({ creditLimit: 0, name: 'Acme' }),
  },
  mockPrismaStockReservation: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  mockResolveClientId: vi.fn(),
  mockLoadAppState: vi.fn().mockResolvedValue({}),
  mockSaveStoreKeys: vi.fn().mockResolvedValue(undefined),
  mockWriteFinancialAudit: vi.fn().mockResolvedValue(undefined),
  mockReserveStock: vi.fn().mockResolvedValue({ ok: true, reserved: 0 }),
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status })
    }
  },
  getRequiredSession: mockGetSession,
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    saleOrder: mockPrismaSO,
    invoice: mockPrismaInvoice,
    client: mockPrismaClient,
    stockReservation: mockPrismaStockReservation,
  },
}))
vi.mock('@/lib/server-store', () => ({ loadAppState: mockLoadAppState, saveStoreKeys: mockSaveStoreKeys }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: mockWriteFinancialAudit }))
vi.mock('@/lib/fiscal-lock.server', () => ({
  checkFiscalLock: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/inventory/stock-transactions', () => ({
  reserveStockForSaleOrder: mockReserveStock,
}))
vi.mock('@/lib/legacy-compat', () => ({
  resolveClientId: mockResolveClientId,
  optionalUuid: (v: unknown) =>
    typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined,
}))

import { PUT } from '@/app/api/sale-orders/[id]/route'

const ORDER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
const CLIENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

const sessionFor = (role: string) => ({ user: { id: '11111111-2222-3333-4444-555555555555', name: 'U', username: 'u', role } })

const baseOrder = {
  id: ORDER_ID,
  orderNumber: 'QUO/2026/0001',
  clientId: CLIENT_ID,
  createdById: '11111111-2222-3333-4444-555555555555',
  status: 'quotation',
  locked: false,
  subtotal: 8400,
  taxAmount: 1600,
  discountAmount: 0,
  totalAmount: 10000,
  amountPaid: 0,
  orderDate: new Date('2026-06-01'),
  client: { id: CLIENT_ID, name: 'Acme Ltd' },
  items: [
    { id: 'item-1', productId: null, description: 'Laptop', qty: 1, unitPrice: 8400, taxRate: 16, lineTotal: 10000 },
  ],
}

// Typed as any: the handler wants NextRequest but only uses .json().
function putReq(body: unknown): any {
  return new Request(`http://localhost/api/sale-orders/${ORDER_ID}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const params = { params: Promise.resolve({ id: ORDER_ID }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(sessionFor('director'))
  mockResolveClientId.mockResolvedValue(CLIENT_ID)
  mockPrismaSO.findMany.mockResolvedValue([])
  mockPrismaInvoice.findMany.mockResolvedValue([])
  mockPrismaClient.findUnique.mockResolvedValue({ creditLimit: 0, name: 'Acme' })
  mockReserveStock.mockResolvedValue({ ok: true, reserved: 0 })
  mockLoadAppState.mockResolvedValue({})
  mockPrismaSO.update.mockImplementation(({ data }: any) => {
    // `items` is a Prisma nested-write object, not the relation payload.
    const { items: _items, ...rest } = data
    return Promise.resolve({ ...baseOrder, ...rest, items: baseOrder.items, client: baseOrder.client })
  })
})

const TECH = '11111111-2222-3333-4444-555555555555'
const REPAIR = { id: 'rep-1', ref: 'REP/2026/0101', saleOrderId: ORDER_ID, assignedTechnicianId: TECH }
const order = (over: Record<string, unknown> = {}) => ({ ...baseOrder, notes: 'Repair quote — REP/2026/0101 — Dell 5400', ...over })
const revision = {
  repairRevision: true,
  repairId: 'rep-1',
  repairRef: 'REP/2026/0101',
  source: 'repair',
  status: 'quotation',
  lines: [{ id: 'item-1', productName: 'Screen', description: 'Screen', qty: 1, unitPrice: 9000, taxRate: 0 }],
  total: 9000,
}

describe('a repair quote revision reaching Sales', () => {
  beforeEach(() => {
    mockLoadAppState.mockResolvedValue({ deed_repairs_v2: [REPAIR] })
    mockGetSession.mockResolvedValue(sessionFor('technician'))
  })

  it('lets the assigned technician update the quotation', async () => {
    mockPrismaSO.findUnique.mockResolvedValue(order())
    const res = await PUT(putReq(revision), params)
    expect(res.status).toBe(200)
    const data = mockPrismaSO.update.mock.calls[0][0].data
    expect(data.items).toBeDefined()
    expect(data.totalAmount).toBe(9000)
  })

  it('reopens a confirmed order as a quotation, since the client must approve again', async () => {
    mockPrismaSO.findUnique.mockResolvedValue(order({ status: 'sale', locked: true, confirmedAt: new Date('2026-09-20') }))
    const res = await PUT(putReq(revision), params)
    expect(res.status).toBe(200)
    expect(mockPrismaSO.update.mock.calls[0][0].data).toMatchObject({ status: 'quotation', locked: false, confirmedAt: null })
    expect(mockPrismaStockReservation.updateMany).toHaveBeenCalled()
  })

  it('reopens a quotation already sent from Sales', async () => {
    mockPrismaSO.findUnique.mockResolvedValue(order({ status: 'quotation_sent', sentAt: new Date('2026-09-21') }))
    const res = await PUT(putReq(revision), params)
    expect(res.status).toBe(200)
    expect(mockPrismaSO.update.mock.calls[0][0].data).toMatchObject({ status: 'quotation', sentAt: null })
  })

  it('refuses once the order has been paid against, and says why', async () => {
    mockPrismaSO.findUnique.mockResolvedValue(order({ status: 'sale' }))
    mockPrismaInvoice.findMany.mockResolvedValue([{ status: 'paid', amountPaid: 10000 }])
    const res = await PUT(putReq(revision), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('Finance must credit it')
    expect(mockPrismaSO.update).not.toHaveBeenCalled()
  })

  it('refuses a technician who is not on the repair', async () => {
    mockLoadAppState.mockResolvedValue({ deed_repairs_v2: [{ ...REPAIR, assignedTechnicianId: 'someone-else' }] })
    mockPrismaSO.findUnique.mockResolvedValue(order())
    expect((await PUT(putReq(revision), params)).status).toBe(403)
    expect(mockPrismaSO.update).not.toHaveBeenCalled()
  })

  it('refuses a revision aimed at another repair\'s order', async () => {
    mockLoadAppState.mockResolvedValue({ deed_repairs_v2: [{ ...REPAIR, saleOrderId: 'other', ref: 'REP/2026/0999' }] })
    mockPrismaSO.findUnique.mockResolvedValue(order())
    expect((await PUT(putReq(revision), params)).status).toBe(403)
  })

  it('never lets the body pick the status or lock', async () => {
    mockGetSession.mockResolvedValue(sessionFor('technical_lead'))
    mockPrismaSO.findUnique.mockResolvedValue(order())
    await PUT(putReq({ ...revision, status: 'sale', locked: true }), params)
    const data = mockPrismaSO.update.mock.calls[0][0].data
    expect(data.status).toBeUndefined()
    expect(data.locked).toBeUndefined()
  })
})
