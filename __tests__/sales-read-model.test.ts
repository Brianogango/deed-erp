import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { saleOrder: { findMany: vi.fn() }, quote: { findMany: vi.fn() } },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { loadScreenQuotes, loadScreenSaleOrders } from '@/lib/sales-read-model.server'

const order = (over: Record<string, unknown> = {}) => ({
  id: 'so-1', orderNumber: 'SO/2026/0001', clientId: 'c-1', status: 'sale', client: { name: 'Renamed Ltd' }, items: [],
  invoices: [], deliveries: [], deliveryNotesDirect: [], screenExtras: null,
  orderDate: new Date('2026-10-01'), createdAt: new Date('2026-10-01'), totalAmount: 1000, taxAmount: 0, subtotal: 1000, discountAmount: 0, amountPaid: 0,
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('sale orders for the screens, read from the table', () => {
  it('takes the customer from the table and screen-only fields from screen_extras', async () => {
    mockPrisma.saleOrder.findMany.mockResolvedValue([order({ screenExtras: { approvalStatus: 'approved', confirmedByName: 'Ann' } })])
    const [so] = await loadScreenSaleOrders([{ id: 'so-1', customerName: 'Old Name', approvalStatus: 'pending' }])
    expect(so).toMatchObject({ customerName: 'Renamed Ltd', ref: 'SO/2026/0001', approvalStatus: 'approved', confirmedByName: 'Ann', total: 1000 })
  })

  it('links the latest open invoice and delivery note', async () => {
    mockPrisma.saleOrder.findMany.mockResolvedValue([order({
      invoices: [
        { id: 'inv-old', status: 'cancelled', createdAt: new Date('2026-10-02') },
        { id: 'inv-1', status: 'approved', createdAt: new Date('2026-10-01') },
      ],
      deliveryNotesDirect: [{ id: 'dn-1', status: 'done', createdAt: new Date('2026-10-02') }],
    })])
    const [so] = await loadScreenSaleOrders([])
    expect(so).toMatchObject({ invoiceId: 'inv-1', deliveryId: 'dn-1' })
  })

  it('keeps an order only the frozen copy has', async () => {
    mockPrisma.saleOrder.findMany.mockResolvedValue([order()])
    const list = await loadScreenSaleOrders([{ id: 'so-1' }, { id: 'so-local', ref: 'SO/9' }])
    expect(list.map(r => r.id)).toEqual(['so-1', 'so-local'])
  })
})

describe('quotes for the screens, read from the table', () => {
  it('adds screen_extras and keeps quotes only the copy has', async () => {
    mockPrisma.quote.findMany.mockResolvedValue([{
      id: 'q-1', quoteNumber: 'QUO/1', clientId: 'c-1', status: 'sent', client: { name: 'Acme' }, items: [], opportunity: null,
      quoteDate: new Date('2026-10-01'), screenExtras: { contactPersonName: 'Jane', viewCount: 3, repairRef: 'REP-1' },
    }])
    const list = await loadScreenQuotes([{ id: 'q-1' }, { id: 'q-local', ref: 'QUO/9' }])
    expect(list[0]).toMatchObject({ ref: 'QUO/1', companyName: 'Acme', contactPersonName: 'Jane', viewCount: 3, repairRef: 'REP-1' })
    expect(list.map(r => r.id)).toEqual(['q-1', 'q-local'])
  })
})
