import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { purchaseOrder: { findMany: vi.fn() } },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/server-store', () => ({ notifyStoreKeysChanged: vi.fn() }))
vi.mock('@/lib/legacy-compat', () => ({ resolveClientId: vi.fn(), optionalUuid: (v: unknown) => v }))

import { loadScreenPurchaseOrders } from '@/lib/purchase-order-read-model.server'

const po = (over: Record<string, unknown> = {}) => ({
  id: 'po-1', poNumber: 'PO/2026/0001', status: 'partial', clientId: 'v-1', vendor: { name: 'Acme' },
  orderDate: new Date('2026-10-01'), expectedDate: null, subtotal: 100, taxAmount: 0, totalAmount: 100, notes: null, lockVersion: 3,
  screenExtras: { approvalStatus: 'approved', repairId: 'rep-1', receiptIds: ['rec-old'] },
  items: [{ id: 'it-1', productId: 'p-1', description: 'Screen', qtyOrdered: 2, qtyReceived: 1, qtyBilled: 0, unitCost: 50, taxRate: 0, lineTotal: 100, product: null, screenExtras: { specs: '15"', importedSerials: ['S1', 'S2'] } }],
  invoices: [
    { id: 'bill-cancelled', status: 'cancelled', createdAt: new Date('2026-10-05') },
    { id: 'bill-1', status: 'approved', createdAt: new Date('2026-10-03') },
  ],
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('purchase orders for the screens, read from the tables', () => {
  it('takes counts from the table, extras from screen_extras, and links from receipts and bills', async () => {
    mockPrisma.purchaseOrder.findMany.mockResolvedValue([po()])
    const [row] = await loadScreenPurchaseOrders(
      [{ id: 'po-1', status: 'confirmed', lines: [] }],
      [{ id: 'rec-1', poId: 'po-1' }, { id: 'rec-other', poId: 'po-9' }],
    )
    expect(row).toMatchObject({ status: 'partial', vendorName: 'Acme', approvalStatus: 'approved', repairId: 'rep-1', billId: 'bill-1' })
    expect(row.receiptIds).toEqual(['rec-old', 'rec-1'])
    expect(row.lines[0]).toMatchObject({ id: 'it-1', qty: 2, qtyReceived: 1, specs: '15"', importedSerials: ['S1', 'S2'] })
  })

  it('keeps an order only the frozen copy has', async () => {
    mockPrisma.purchaseOrder.findMany.mockResolvedValue([po()])
    const list = await loadScreenPurchaseOrders([{ id: 'po-local', ref: 'PO/2026/0099' }, { id: 'twin', ref: 'PO/2026/0001' }], [])
    expect(list.map(r => r.id)).toEqual(['po-1', 'po-local'])
  })
})
