import { describe, expect, it } from 'vitest'
import {
  applyInvoiceLinkToRepair,
  extractRepairRefFromText,
  findRepairForSaleOrder,
  stampInvoiceOnMatchingRepair,
} from '@/lib/repair/sale-order-link'

const repair = {
  id: 'c5495f14-2ea4-4b79-9ea1-5783449be77a',
  ref: 'REP/0289',
  saleOrderId: '0e462293-c3c0-408d-afd9-a23f787c3bcb',
  saleOrderRef: 'SO/2026/0080',
  status: 'ready',
}

describe('extractRepairRefFromText', () => {
  it('matches short and year-prefixed repair refs', () => {
    expect(extractRepairRefFromText('Repair quote — REP/0289 — HP SPECTRE')).toBe('REP/0289')
    expect(extractRepairRefFromText('Repair order REP/2026/0088')).toBe('REP/2026/0088')
  })

  it('returns undefined when no repair ref is present', () => {
    expect(extractRepairRefFromText('Walk-in laptop sale')).toBeUndefined()
  })
})

describe('findRepairForSaleOrder', () => {
  it('matches by saleOrderId first', () => {
    expect(findRepairForSaleOrder([repair], { id: repair.saleOrderId, notes: '' })?.id).toBe(repair.id)
  })

  it('matches by sale order ref when the id is missing', () => {
    expect(findRepairForSaleOrder(
      [{ ...repair, saleOrderId: null }],
      { ref: 'SO/2026/0080' },
    )?.id).toBe(repair.id)
  })

  it('falls back to the REP/… token in notes', () => {
    expect(findRepairForSaleOrder(
      [{ ...repair, saleOrderId: null, saleOrderRef: null }],
      { notes: 'Repair quote — REP/0289 — HP SPECTRE X360 14' },
    )?.ref).toBe('REP/0289')
  })
})

describe('stampInvoiceOnMatchingRepair', () => {
  it('back-links the invoice without changing workshop status', () => {
    const next = stampInvoiceOnMatchingRepair([repair], repair, {
      id: 'inv-1',
      ref: 'INV/2026/0134',
      date: '2026-08-22',
    })
    expect(next[0]).toMatchObject({
      invoiceId: 'inv-1',
      invoiceDate: '2026-08-22',
      linkedInvoiceId: 'inv-1',
      linkedInvoiceRef: 'INV/2026/0134',
      status: 'ready',
    })
  })

  it('leaves an already-invoiced repair alone', () => {
    const invoiced = { ...repair, invoiceId: 'existing' }
    expect(stampInvoiceOnMatchingRepair([invoiced], invoiced, { id: 'inv-2' })).toEqual([invoiced])
  })
})

describe('applyInvoiceLinkToRepair', () => {
  it('sets invoiceId and portal aliases', () => {
    expect(applyInvoiceLinkToRepair(repair, { id: 'inv-1', ref: 'INV/2026/0134' })).toMatchObject({
      invoiceId: 'inv-1',
      linkedInvoiceId: 'inv-1',
      linkedInvoiceRef: 'INV/2026/0134',
    })
  })
})
