import { describe, expect, it, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ products: [] as Array<{ id: string; name: string; isActive: boolean }> }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  default: {
    product: {
      findMany: vi.fn(async ({ where }: any) => {
        const names: string[] = where.OR.map((c: any) => String(c.name.equals).toLowerCase())
        return h.products.filter(p => p.isActive && names.includes(p.name.toLowerCase()))
      }),
    },
  },
}))

import { linkLinesToProducts } from '@/lib/sales/link-line-products.server'
import { mapSaleOrderItems } from '@/lib/sale-order-items-write'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

beforeEach(() => { h.products = [] })

describe('keeping a line linked to its product', () => {
  const existing = [{ id: 'row-1', productId: A, qtyDelivered: 0, qtyInvoiced: 0 }]

  it('does not wipe the product when an edit arrives without one', () => {
    const [line] = mapSaleOrderItems([{ id: 'row-1', description: 'Dell Latitude E7240 Battery', qty: 1, unitPrice: 6000 }], existing)
    expect(line.productId).toBe(A)
    const [blank] = mapSaleOrderItems([{ id: 'row-1', productId: '', description: 'x', qty: 1, unitPrice: 1 }], existing)
    expect(blank.productId).toBe(A)
  })

  it('lets a line change to a different product', () => {
    const [line] = mapSaleOrderItems([{ id: 'row-1', productId: B, description: 'x', qty: 1, unitPrice: 1 }], existing)
    expect(line.productId).toBe(B)
  })

  it('leaves a genuinely new line without a product as it was', () => {
    const [line] = mapSaleOrderItems([{ description: 'Free text', qty: 1, unitPrice: 5 }], existing)
    expect(line.productId).toBeNull()
  })
})

describe('linking a line to the product with exactly its name', () => {
  it('links on an exact name, ignoring case and spacing', async () => {
    h.products = [{ id: A, name: 'Dell Latitude E7240 Battery - 8858X', isActive: true }]
    const [line] = await linkLinesToProducts([{ productName: 'dell latitude  E7240 battery - 8858x', qty: 1, unitPrice: 6000 }])
    expect(line.productId).toBe(A)
  })

  it('does not link when two products share the name, or the name only partly matches', async () => {
    h.products = [
      { id: A, name: '8GB RAM', isActive: true },
      { id: B, name: '8GB RAM', isActive: true },
      { id: '33333333-3333-4333-8333-333333333333', name: '8GB DDR4 SODIMM Laptop RAM - 2666MHz', isActive: true },
    ]
    const lines = await linkLinesToProducts([
      { description: '8GB RAM', qty: 1, unitPrice: 5000 },
      { description: '8GB DDR4', qty: 1, unitPrice: 5000 },
    ])
    expect(lines.map(l => l.productId)).toEqual([undefined, undefined])
  })

  it('saves the order as it was if the product lookup fails', async () => {
    const prisma = (await import('@/lib/prisma')).default as any
    prisma.product.findMany.mockRejectedValueOnce(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const input = [{ description: 'Anything', qty: 1, unitPrice: 1 }]
    expect(await linkLinesToProducts(input)).toBe(input)
    warn.mockRestore()
  })

  it('ignores archived products, sections, and lines that already have a product', async () => {
    h.products = [{ id: A, name: 'Old SSD', isActive: false }]
    const lines = await linkLinesToProducts([
      { description: 'Old SSD', qty: 1, unitPrice: 1 },
      { lineType: 'section', description: 'Parts', qty: 0 },
      { productId: B, description: 'Anything', qty: 1, unitPrice: 1 },
    ])
    expect(lines[0].productId).toBeUndefined()
    expect(lines[1].productId).toBeUndefined()
    expect(lines[2].productId).toBe(B)
  })
})
