import { describe, expect, it } from 'vitest'
import { buildSaleOrderItemsNestedWrite, mapSaleOrderItems } from '@/lib/sale-order-items-write'
import { orderedSaleOrderItems } from '@/lib/sales/sale-order-line-order'
import { saleOrderLinesFingerprint } from '@/lib/sale-order-draft-edits'

const LAPTOP = '11111111-1111-1111-1111-111111111111'
const MOUSE = '22222222-2222-2222-2222-222222222222'
const DOCK = '33333333-3333-3333-3333-333333333333'

const existing = [
  { id: LAPTOP, productId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', description: 'Laptop', qty: 2, qtyDelivered: 0, qtyInvoiced: 0, unitPrice: 1000, taxRate: 16, discountPct: 0, lineTotal: 2000, notes: null, serialNumberId: null, sortOrder: 0 },
  { id: MOUSE, productId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', description: 'Mouse', qty: 1, qtyDelivered: 0, qtyInvoiced: 0, unitPrice: 500, taxRate: 16, discountPct: 0, lineTotal: 500, notes: null, serialNumberId: null, sortOrder: 1 },
  { id: DOCK, productId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', description: 'Dock', qty: 1, qtyDelivered: 0, qtyInvoiced: 0, unitPrice: 800, taxRate: 16, discountPct: 0, lineTotal: 800, notes: null, serialNumberId: null, sortOrder: 2 },
]

/** The client sends lines as a positional array; this is what the UI holds. */
const asClientLines = (rows: typeof existing) => rows.map(r => ({
  id: r.id,
  productId: r.productId,
  description: r.description,
  qty: r.qty,
  unitPrice: r.unitPrice,
  taxRate: r.taxRate,
  discount: r.discountPct,
  lineTotal: r.lineTotal,
}))

const swap = <T,>(rows: T[], a: number, b: number): T[] => {
  const next = [...rows]
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}

describe('orderedSaleOrderItems', () => {
  it('returns rows in sortOrder, whatever order the query gave them', () => {
    const shuffled = [existing[2], existing[0], existing[1]]
    expect(orderedSaleOrderItems(shuffled).map(r => r.id)).toEqual([LAPTOP, MOUSE, DOCK])
  })

  it('is stable for rows sharing a sortOrder, so un-backfilled documents keep the order they show today', () => {
    const legacy = existing.map(r => ({ ...r, sortOrder: 0 }))
    expect(orderedSaleOrderItems(legacy).map(r => r.id)).toEqual([LAPTOP, MOUSE, DOCK])
    expect(orderedSaleOrderItems([legacy[2], legacy[1], legacy[0]]).map(r => r.id))
      .toEqual([DOCK, MOUSE, LAPTOP])
  })

  it('treats a missing sortOrder as position zero rather than throwing', () => {
    const rows = [{ id: 'x' }, { id: 'y', sortOrder: 5 }, { id: 'z', sortOrder: null }]
    expect(orderedSaleOrderItems(rows).map(r => r.id)).toEqual(['x', 'z', 'y'])
    expect(orderedSaleOrderItems(null)).toEqual([])
    expect(orderedSaleOrderItems(undefined)).toEqual([])
  })
})

describe('mapSaleOrderItems assigns position from the array index', () => {
  it('numbers the lines in the order the client sent them', () => {
    const mapped = mapSaleOrderItems(asClientLines(existing), existing)
    expect(mapped.map(m => [m.description, m.sortOrder])).toEqual([
      ['Laptop', 0], ['Mouse', 1], ['Dock', 2],
    ])
  })

  it('numbers section headings alongside the products they group', () => {
    const withSection = [
      { lineType: 'section', description: 'Hardware', qty: 0 },
      ...asClientLines([existing[0]]),
      { lineType: 'section', description: 'Accessories', qty: 0 },
      ...asClientLines([existing[1]]),
    ]
    expect(mapSaleOrderItems(withSection, existing).map(m => m.sortOrder)).toEqual([0, 1, 2, 3])
  })
})

describe('buildSaleOrderItemsNestedWrite — a reorder has to change a column', () => {
  it('writes the new position on every moved line', () => {
    // The exact reported bug: the user moves the Dock to the top. Nothing
    // else about any line changes, so before sortOrder existed the update
    // list was a set of no-ops and the order never reached the database.
    const reordered = swap(asClientLines(existing), 0, 2)

    const nested = buildSaleOrderItemsNestedWrite(reordered, existing)

    expect(nested.create).toBeUndefined()
    expect(nested.deleteMany).toBeUndefined()
    expect(nested.update?.map(u => [u.where.id, u.data.sortOrder])).toEqual([
      [DOCK, 0], [MOUSE, 1], [LAPTOP, 2],
    ])
  })

  it('carries a position on newly added lines too', () => {
    const withNew = [
      ...asClientLines(existing),
      { productId: 'dddddddd-dddd-dddd-dddd-dddddddddddd', description: 'Cable', qty: 1, unitPrice: 100, taxRate: 16 },
    ]
    const nested = buildSaleOrderItemsNestedWrite(withNew, existing)
    expect(nested.create?.map(c => [c.description, c.sortOrder])).toEqual([['Cable', 3]])
  })

  it('renumbers the survivors when a line in the middle is deleted', () => {
    const nested = buildSaleOrderItemsNestedWrite(
      asClientLines([existing[0], existing[2]]),
      existing,
    )
    expect(nested.deleteMany).toEqual({ id: { in: [MOUSE] } })
    expect(nested.update?.map(u => [u.where.id, u.data.sortOrder])).toEqual([
      [LAPTOP, 0], [DOCK, 1],
    ])
  })

  it('leaves the round trip in the order the user set', () => {
    const reordered = swap(asClientLines(existing), 0, 2)
    const nested = buildSaleOrderItemsNestedWrite(reordered, existing)

    // What the database would then hold, read back through the mapper.
    const stored = (nested.update ?? []).map(u => ({ id: u.where.id, ...u.data }))
    expect(orderedSaleOrderItems(stored).map(r => r.description))
      .toEqual(['Dock', 'Mouse', 'Laptop'])
  })
})

describe('saleOrderLinesFingerprint sees a reorder', () => {
  it('differs when only the order differs', () => {
    // It used to sort the per-line keys, so a reorder-only save looked
    // identical to the pre-reorder lines, the "local still matches what I
    // sent" guard passed, and the server's copy overwrote the new order.
    const lines = asClientLines(existing)
    expect(saleOrderLinesFingerprint(swap(lines, 0, 2)))
      .not.toBe(saleOrderLinesFingerprint(lines))
  })

  it('still matches an unchanged array', () => {
    const lines = asClientLines(existing)
    expect(saleOrderLinesFingerprint([...lines])).toBe(saleOrderLinesFingerprint(lines))
  })
})
