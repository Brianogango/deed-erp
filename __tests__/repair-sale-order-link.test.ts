import { describe, expect, it } from 'vitest'
import {
  applyInvoiceLinkToRepair,
  dedupeRepairSaleOrders,
  extractRepairRefFromText,
  findRepairForSaleOrder,
  findSaleOrderForRepair,
  findSalesQuoteForRepair,
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
  it('matches short, year-prefixed, and random repair refs', () => {
    expect(extractRepairRefFromText('Repair quote — REP/0289 — HP SPECTRE')).toBe('REP/0289')
    expect(extractRepairRefFromText('Repair order REP/2026/0088')).toBe('REP/2026/0088')
    expect(extractRepairRefFromText('Repair quote — REP-7K3M9X2Q — HP SPECTRE')).toBe('REP-7K3M9X2Q')
    expect(extractRepairRefFromText('Created from REP-227532')).toBeUndefined()
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


describe('findSaleOrderForRepair', () => {
  const oldQuote = {
    id: 'quo-old',
    ref: 'QUO/2026/0263',
    status: 'quotation',
    notes: 'Repair quote — REP/0294 — HP 1030 G3',
    createdAt: '2026-08-25T09:00:00.000Z',
  }
  const latestQuote = {
    ...oldQuote,
    id: 'quo-latest',
    ref: 'QUO/2026/0265',
    createdAt: '2026-08-25T10:00:00.000Z',
  }

  it('reuses the explicit linked sale order', () => {
    expect(findSaleOrderForRepair(
      [oldQuote, latestQuote],
      { id: 'repair-1', ref: 'REP/0294', saleOrderId: oldQuote.id },
    )?.id).toBe(oldQuote.id)
  })

  it('falls back to the newest repair-note match when the link was lost', () => {
    expect(findSaleOrderForRepair(
      [oldQuote, latestQuote],
      { id: 'repair-1', ref: 'REP/0294' },
    )?.id).toBe(latestQuote.id)
  })

  it('prefers a confirmed order over a later stray draft', () => {
    expect(findSaleOrderForRepair(
      [{ ...oldQuote, status: 'sale' }, latestQuote],
      { id: 'repair-1', ref: 'REP/0294' },
    )?.id).toBe(oldQuote.id)
  })
})

describe('dedupeRepairSaleOrders', () => {
  it('shows one repair quotation while preserving unrelated orders', () => {
    const duplicateNotes = 'Repair quote — REP/0294 — HP 1030 G3'
    const orders = [
      { id: 'quo-265', ref: 'QUO/2026/0265', status: 'quotation', notes: duplicateNotes },
      { id: 'quo-263', ref: 'QUO/2026/0263', status: 'quotation', notes: duplicateNotes },
      { id: 'walk-in', ref: 'QUO/2026/0264', status: 'quotation', notes: 'Walk-in sale' },
    ]
    expect(dedupeRepairSaleOrders(orders).map(order => order.id)).toEqual(['quo-265', 'walk-in'])
  })

  it('keeps the repair-linked record even if a higher duplicate ref exists', () => {
    const notes = 'Repair quote — REP/0294 — HP 1030 G3'
    const orders = [
      { id: 'linked', ref: 'QUO/2026/0263', status: 'quotation', notes },
      { id: 'stray', ref: 'QUO/2026/0265', status: 'quotation', notes },
    ]
    expect(dedupeRepairSaleOrders(
      orders,
      [{ id: 'repair-1', ref: 'REP/0294', saleOrderId: 'linked' }],
    ).map(order => order.id)).toEqual(['linked'])
  })
})

describe('findSalesQuoteForRepair', () => {
  const quote = {
    id: 'quote-1',
    ref: 'QUO/2026/0284',
    source: 'repair',
    repairId: 'repair-310',
    repairRef: 'REP/0310',
  }

  it('matches by salesQuoteId first', () => {
    expect(findSalesQuoteForRepair(
      [quote],
      { id: 'repair-310', ref: 'REP/0310', salesQuoteId: 'quote-1' },
    )?.ref).toBe('QUO/2026/0284')
  })

  it('falls back to the repair source link', () => {
    expect(findSalesQuoteForRepair(
      [quote],
      { id: 'repair-310', ref: 'REP/0310' },
    )?.id).toBe('quote-1')
  })
})
