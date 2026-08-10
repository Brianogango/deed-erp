import { describe, expect, it } from 'vitest'
import {
  findReleasedOrcsForReturn,
  pickPostedInvoiceForReturn,
  resolveReturnCreditAmount,
  stampDeliveryReturnQtys,
} from '@/lib/sales/return-orchestration'

describe('stampDeliveryReturnQtys', () => {
  it('stamps qtyReturned on done DN lines without changing qtyDone', () => {
    const result = stampDeliveryReturnQtys({
      saleOrderId: 'so1',
      returnLines: [{ productId: 'p1', qty: 1, serialIds: ['s1'] }],
      deliveries: [{
        id: 'dn1',
        saleOrderId: 'so1',
        status: 'done',
        lines: [{ productId: 'p1', productName: 'Laptop', qty: 2, qtyDone: 2, qtyReturned: 0, serialIds: ['s1', 's2'] }],
      }],
    })
    expect(result).toHaveLength(1)
    expect(result[0].lines[0]).toMatchObject({ qtyDone: 2, qtyReturned: 1 })
  })

  it('respects remaining returnable capacity across partial returns', () => {
    const result = stampDeliveryReturnQtys({
      saleOrderId: 'so1',
      returnLines: [{ productId: 'p1', qty: 1 }],
      deliveries: [{
        id: 'dn1',
        saleOrderId: 'so1',
        status: 'done',
        lines: [{ productId: 'p1', qty: 2, qtyDone: 2, qtyReturned: 1, serialIds: [] }],
      }],
    })
    expect(result[0].lines[0].qtyReturned).toBe(2)
  })
})

describe('pickPostedInvoiceForReturn', () => {
  it('uses the only posted invoice', () => {
    const result = pickPostedInvoiceForReturn({
      invoices: [{ id: 'inv1', ref: 'INV/1', lines: [{ productId: 'p1', qty: 1 }] }],
      returnLines: [{ productId: 'p1', qty: 1 }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.invoice.id).toBe('inv1')
  })

  it('picks the uniquely covering invoice among many', () => {
    const result = pickPostedInvoiceForReturn({
      invoices: [
        { id: 'inv-a', ref: 'INV/A', lines: [{ productId: 'p2', qty: 3 }] },
        { id: 'inv-b', ref: 'INV/B', lines: [{ productId: 'p1', qty: 1 }] },
      ],
      returnLines: [{ productId: 'p1', qty: 1 }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.invoice.id).toBe('inv-b')
  })

  it('fails when multiple invoices cover the return equally', () => {
    const result = pickPostedInvoiceForReturn({
      invoices: [
        { id: 'inv-a', ref: 'INV/A', lines: [{ productId: 'p1', qty: 1 }] },
        { id: 'inv-b', ref: 'INV/B', lines: [{ productId: 'p1', qty: 1 }] },
      ],
      returnLines: [{ productId: 'p1', qty: 1 }],
    })
    expect(result).toMatchObject({ ok: false, reason: 'ambiguous' })
  })

  it('honours preferredInvoiceId when present', () => {
    const result = pickPostedInvoiceForReturn({
      preferredInvoiceId: 'inv-a',
      invoices: [
        { id: 'inv-a', ref: 'INV/A', lines: [{ productId: 'p1', qty: 1 }] },
        { id: 'inv-b', ref: 'INV/B', lines: [{ productId: 'p1', qty: 1 }] },
      ],
      returnLines: [{ productId: 'p1', qty: 1 }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.invoice.id).toBe('inv-a')
  })
})

describe('findReleasedOrcsForReturn', () => {
  it('returns released ORCs linked to stamped DNs or invoices', () => {
    const targets = findReleasedOrcsForReturn({
      deliveryIds: ['dn1'],
      invoiceIds: ['inv1'],
      releases: [
        { id: 'orc1', ref: 'ORC/1', status: 'released', deliveryNoteId: 'dn1' },
        { id: 'orc2', ref: 'ORC/2', status: 'released', invoiceId: 'inv1' },
        { id: 'orc3', ref: 'ORC/3', status: 'voided', deliveryNoteId: 'dn1' },
        { id: 'orc4', ref: 'ORC/4', status: 'released', deliveryNoteId: 'other' },
      ],
    })
    expect(targets.map(t => t.releaseId).sort()).toEqual(['orc1', 'orc2'])
  })
})

describe('resolveReturnCreditAmount', () => {
  it('prefers explicit UI amount, then creditTotalHint over SO total fallback', () => {
    expect(resolveReturnCreditAmount({
      explicitAmount: 1160,
      creditTotalHint: 2000,
      fallbackAmount: 50000,
    })).toBe(1160)
    expect(resolveReturnCreditAmount({
      creditTotalHint: 1160,
      allocationCreditTotal: 0,
      fallbackAmount: 50000,
    })).toBe(1160)
  })
})
