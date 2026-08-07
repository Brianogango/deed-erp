import { describe, it, expect } from 'vitest'
import { mergeSaleOrdersStoreWrite, pickFresherSaleOrderRow } from '@/lib/sale-order-store-merge'

describe('mergeSaleOrdersStoreWrite', () => {
  it('prefers the higher lockVersion row', () => {
    const current = [{
      id: 'so-1',
      lockVersion: 3,
      lines: [{ id: 'a', productId: 'p1', qty: 1 }],
    }]
    const incoming = [{
      id: 'so-1',
      lockVersion: 2,
      lines: [
        { id: 'a', productId: 'p1', qty: 1 },
        { id: 'b', productId: 'p2', qty: 1 },
      ],
    }]
    const merged = mergeSaleOrdersStoreWrite(current, incoming)
    expect(merged.find(r => r.id === 'so-1')?.lines).toHaveLength(1)
  })

  it('on equal freshness prefers fewer commercial lines (delete wins)', () => {
    const a = {
      id: 'so-1',
      lockVersion: 1,
      lines: [
        { id: 'a', productId: 'p1', qty: 1 },
        { id: 'b', productId: 'p2', qty: 1 },
      ],
    }
    const b = {
      id: 'so-1',
      lockVersion: 1,
      lines: [{ id: 'a', productId: 'p1', qty: 1 }],
    }
    expect(pickFresherSaleOrderRow(a, b).lines).toHaveLength(1)
    expect(mergeSaleOrdersStoreWrite([a], [b]).find(r => r.id === 'so-1')?.lines).toHaveLength(1)
  })

  it('preserves server-only rows omitted from a partial client cache', () => {
    const current = [
      { id: 'so-1', lockVersion: 1, lines: [] },
      { id: 'so-2', lockVersion: 1, lines: [{ id: 'x' }] },
    ]
    const incoming = [{ id: 'so-1', lockVersion: 2, lines: [{ id: 'a' }] }]
    const merged = mergeSaleOrdersStoreWrite(current, incoming)
    expect(merged.map(r => r.id).sort()).toEqual(['so-1', 'so-2'])
    expect(merged.find(r => r.id === 'so-1')?.lockVersion).toBe(2)
  })
})
