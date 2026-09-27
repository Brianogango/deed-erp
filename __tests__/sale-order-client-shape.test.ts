import { describe, expect, it } from 'vitest'
import { mapSaleOrderToClient } from '@/lib/sales/sale-order-client-shape'

const prismaOrder = (over: Record<string, unknown> = {}) => ({
  id: 'so-1',
  orderNumber: 'SO/2026/0042',
  clientId: 'client-1',
  client: { name: 'Amani Ltd' },
  status: 'sale',
  orderDate: new Date('2026-09-01T00:00:00Z'),
  totalAmount: 92_800,
  taxAmount: 12_800,
  subtotal: 80_000,
  discountAmount: 0,
  amountPaid: 0,
  lockVersion: 3,
  paymentTermsDays: 30,
  items: [
    {
      id: 'line-1',
      productId: 'prod-1',
      description: 'Laptop',
      qty: 10,
      unitPrice: 10_000,
      taxRate: 16,
      discountPct: 20,
      lineTotal: 80_000,
      qtyDelivered: 4,
      qtyInvoiced: 0,
      serialNumberId: null,
      notes: null,
      sortOrder: 1,
    },
    {
      id: 'line-0',
      productId: null,
      description: 'Hardware',
      qty: 0,
      unitPrice: 0,
      taxRate: 0,
      discountPct: 0,
      lineTotal: 0,
      qtyDelivered: 0,
      qtyInvoiced: 0,
      serialNumberId: null,
      notes: null,
      sortOrder: 0,
    },
  ],
  ...over,
})

describe('mapSaleOrderToClient', () => {
  it('carries the per-line discount both ways round', () => {
    // The field that made this worth unifying. Two routes wrote the whole
    // deed_saleOrders blob from reduced copies that omitted it, and the next
    // save of an order then recomputed its header from lines claiming no
    // discount — re-pricing a 20%-off order upward with no user edit.
    const line = mapSaleOrderToClient(prismaOrder()).lines.find((l: any) => l.id === 'line-1')
    expect(line).toMatchObject({ discount: 20, discountPercent: 20, lineTotal: 80_000 })
  })

  it('returns lines in their stored order', () => {
    expect(mapSaleOrderToClient(prismaOrder()).lines.map((l: any) => l.id)).toEqual(['line-0', 'line-1'])
  })

  it('keeps the header figures a reduced copy used to drop', () => {
    expect(mapSaleOrderToClient(prismaOrder())).toMatchObject({
      taxTotal: 12_800,
      subtotal: 80_000,
      date: '2026-09-01',
      total: 92_800,
      lockVersion: 3,
    })
  })

  it('reconstructs payment terms from the durable column', () => {
    expect(mapSaleOrderToClient(prismaOrder()).paymentTerms).toBeTruthy()
    expect(mapSaleOrderToClient(prismaOrder({ paymentTermsDays: null })).paymentTerms).toBeUndefined()
  })

  it('never leaves raw Prisma items or client on the row', () => {
    const mapped = mapSaleOrderToClient(prismaOrder()) as Record<string, unknown>
    // PATCH used to prefer that stale array over edited lines and resurrect
    // deleted products.
    expect(mapped.items).toBeUndefined()
    expect(mapped.client).toBeUndefined()
  })

  it('recognises a qty-0 unpriced row as a section heading', () => {
    const section = mapSaleOrderToClient(prismaOrder()).lines.find((l: any) => l.id === 'line-0')
    expect(section).toMatchObject({ lineType: 'section' })
  })

  it('does not label a real product line as a section', () => {
    const line = mapSaleOrderToClient(prismaOrder()).lines.find((l: any) => l.id === 'line-1')
    expect(line).not.toHaveProperty('lineType')
  })

  it('normalises a legacy status onto the Odoo vocabulary', () => {
    expect(mapSaleOrderToClient(prismaOrder({ status: 'confirmed' })).status).toBe('sale')
  })

  it('carries fulfilment counters so invoiceable quantity is not lost', () => {
    const line = mapSaleOrderToClient(prismaOrder()).lines.find((l: any) => l.id === 'line-1')
    expect(line).toMatchObject({ qtyDelivered: 4, qtyInvoiced: 0 })
  })
})
