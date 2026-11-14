import { describe, it, expect } from 'vitest'
import { saleOrderLinesFromBody } from '@/lib/sale-order-body-lines'
import { saleOrderPersistBody } from '@/lib/sale-order-persist'

describe('saleOrderLinesFromBody', () => {
  it('QEDIT — prefers lines over stale items when both are present', () => {
    const lines = [{ id: 'keep', productId: 'p1', qty: 1 }]
    const items = [
      { id: 'keep', productId: 'p1', qty: 1 },
      { id: 'deleted', productId: 'p2', qty: 1 },
      { id: 'deleted2', productId: 'p3', qty: 1 },
    ]
    expect(saleOrderLinesFromBody({ lines, items })).toEqual(lines)
    expect(saleOrderLinesFromBody({ lines, items })?.length).toBe(1)
  })

  it('falls back to items when lines is absent', () => {
    const items = [{ id: 'a' }]
    expect(saleOrderLinesFromBody({ items })).toEqual(items)
  })
})

describe('saleOrderPersistBody strips stale items', () => {
  it('omits items so PATCH cannot resurrect deleted products', () => {
    const body = saleOrderPersistBody({
      id: 'so-1',
      lockVersion: 3,
      lines: [{ id: 'keep' }],
      items: [{ id: 'keep' }, { id: 'stale-deleted' }],
    })
    expect(body.lines).toEqual([{ id: 'keep' }])
    expect('items' in body).toBe(false)
    expect('lockVersion' in body).toBe(false)
  })
})

