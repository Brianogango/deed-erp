import { describe, it, expect } from 'vitest'
import {
  computeInvoiceTotals,
  computeInvoiceLineMoney,
  clampAmountPaid,
  mapDbInvoiceItemsToClientLines,
  mapDbInvoiceStatusToClient,
  mapDbInvoiceToClientStore,
  mergePrismaInvoicesIntoBlob,
  preserveInvoiceLinesOnStoreWrite,
  preserveMissingInvoicesOnStoreWrite,
  enforcePostedInvoiceImmutability,
} from '@/lib/finance-invoice'

describe('computeInvoiceTotals', () => {
  it('derives subtotal from qty × unitPrice, ignoring client-supplied line subtotals', () => {
    const totals = computeInvoiceTotals([
      { qty: 2, unitPrice: 100, subtotal: 999999 },
      { qty: 1, unitPrice: 50, subtotal: 0 },
    ])
    expect(totals.subtotal).toBe(250)
    expect(totals.totalAmount).toBe(250)
  })

  it('computes per-line tax from tax rates', () => {
    const totals = computeInvoiceTotals([{ qty: 1, unitPrice: 1000, taxRate: 16 }])
    expect(totals.subtotal).toBe(1000)
    expect(totals.taxAmount).toBe(160)
    expect(totals.totalAmount).toBe(1160)
  })

  it('applies per-line discount percent before tax', () => {
    const totals = computeInvoiceTotals([{ qty: 1, unitPrice: 10000, discountPct: 10, taxRate: 16 }])
    expect(totals.subtotal).toBe(9000)
    expect(totals.discountAmount).toBe(1000)
    expect(totals.taxAmount).toBe(1440)
    expect(totals.totalAmount).toBe(10440)
  })

  it('falls back to header tax when lines carry no rate (POS/repair VAT pattern)', () => {
    const totals = computeInvoiceTotals(
      [{ qty: 1, unitPrice: 1000, taxRate: 0 }],
      { headerTax: 160 },
    )
    expect(totals.subtotal).toBe(1000)
    expect(totals.taxAmount).toBe(160)
    expect(totals.totalAmount).toBe(1160)
  })

  it('applies header discount when no line discount, and never returns a negative total', () => {
    const totals = computeInvoiceTotals([{ qty: 1, unitPrice: 100 }], { discount: 500 })
    expect(totals.totalAmount).toBe(0)
    expect(totals.discountAmount).toBe(500)
  })

  it('handles an empty / non-array line set safely', () => {
    expect(computeInvoiceTotals([]).totalAmount).toBe(0)
    // @ts-expect-error — defensive against malformed payloads
    expect(computeInvoiceTotals(undefined).totalAmount).toBe(0)
  })
})

describe('computeInvoiceLineMoney', () => {
  it('nets discount then taxes the net', () => {
    const line = computeInvoiceLineMoney({ qty: 2, unitPrice: 500, discountPct: 20, taxRate: 16 })
    expect(line.gross).toBe(1000)
    expect(line.discountAmount).toBe(200)
    expect(line.lineSubtotal).toBe(800)
    expect(line.lineTax).toBe(128)
    expect(line.lineTotal).toBe(928)
  })
})

describe('clampAmountPaid', () => {
  it('clamps into [0, totalAmount]', () => {
    expect(clampAmountPaid(999, 500)).toBe(500)
    expect(clampAmountPaid(-10, 500)).toBe(0)
    expect(clampAmountPaid(250, 500)).toBe(250)
  })
})

describe('mapDbInvoiceItemsToClientLines', () => {
  it('maps pretax lineSubtotal (not tax-inclusive lineTotal) and discountPct', () => {
    const lines = mapDbInvoiceItemsToClientLines([
      {
        id: 'li1',
        description: 'Laptop ×1',
        qty: 1,
        unitPrice: 10000,
        taxRate: 16,
        discountPct: 10,
        lineSubtotal: 9000,
        productId: 'p1',
      },
    ])
    expect(lines).toEqual([{
      id: 'li1',
      lineType: 'item',
      description: 'Laptop ×1',
      qty: 1,
      unitPrice: 10000,
      taxRate: 16,
      discountPct: 10,
      subtotal: 9000,
      productId: 'p1',
    }])
  })

  it('falls back to qty × unitPrice when lineSubtotal missing', () => {
    const lines = mapDbInvoiceItemsToClientLines([
      { description: 'Part', qty: 2, unitPrice: 500, taxRate: 0 },
    ])
    expect(lines[0].subtotal).toBe(1000)
    expect(lines[0].id).toBe('line-0')
  })
})

describe('preserveInvoiceLinesOnStoreWrite', () => {
  it('keeps existing lines when incoming shell has lines:[]', () => {
    const current = [{
      id: 'inv1',
      ref: 'INV/1',
      lines: [{ id: 'l1', description: 'Item', qty: 1, unitPrice: 100, taxRate: 0, subtotal: 100 }],
      subtotal: 100,
      taxTotal: 0,
      total: 100,
    }]
    const incoming = [{
      id: 'inv1',
      ref: 'INV/1',
      lines: [],
      subtotal: 116,
      taxTotal: 0,
      total: 116,
    }]
    const merged = preserveInvoiceLinesOnStoreWrite(current, incoming) as typeof current
    expect(merged[0].lines).toHaveLength(1)
    expect(merged[0].lines[0].description).toBe('Item')
    expect(merged[0].subtotal).toBe(100)
    expect(merged[0].total).toBe(100)
  })

  it('allows intentional non-empty line updates', () => {
    const current = [{ id: 'inv1', lines: [{ id: 'l1', subtotal: 100 }], subtotal: 100, total: 100 }]
    const incoming = [{ id: 'inv1', lines: [{ id: 'l2', subtotal: 200 }], subtotal: 200, total: 200 }]
    const merged = preserveInvoiceLinesOnStoreWrite(current, incoming) as typeof incoming
    expect(merged[0].lines[0].id).toBe('l2')
    expect(merged[0].subtotal).toBe(200)
  })
})

describe('preserveMissingInvoicesOnStoreWrite', () => {
  it('restores posted invoices dropped by a truncated sync', () => {
    const current = [
      { id: 'a', status: 'posted', ref: 'INV/1' },
      { id: 'b', status: 'posted', ref: 'INV/2' },
      { id: 'c', status: 'draft', ref: 'DRAFT/INV/X' },
    ]
    const incoming = [{ id: 'a', status: 'posted', ref: 'INV/1' }]
    const merged = preserveMissingInvoicesOnStoreWrite(current, incoming) as typeof current
    expect(merged.map(r => r.id).sort()).toEqual(['a', 'b'])
  })

  it('allows intentional draft removal', () => {
    const current = [
      { id: 'a', status: 'draft', ref: 'DRAFT/INV/X' },
      { id: 'b', status: 'posted', ref: 'INV/2' },
    ]
    const incoming = [{ id: 'b', status: 'posted', ref: 'INV/2' }]
    const merged = preserveMissingInvoicesOnStoreWrite(current, incoming) as typeof current
    expect(merged.map(r => r.id)).toEqual(['b'])
  })
})

describe('mapDbInvoiceToClientStore / mergePrismaInvoicesIntoBlob', () => {
  it('maps approved Prisma invoices to posted customer invoices', () => {
    const row = mapDbInvoiceToClientStore({
      id: 'inv-1',
      invoiceNumber: 'INV/2026/0046',
      status: 'approved',
      clientId: 'c1',
      client: { name: 'Kevin Mbugua' },
      invoiceDate: new Date('2026-08-06T00:00:00.000Z'),
      dueDate: new Date('2026-09-05T00:00:00.000Z'),
      subtotal: 51700,
      taxAmount: 112,
      totalAmount: 51812,
      amountPaid: 0,
      saleOrderId: 'so-1',
      notes: 'Created from SO/2026/0025',
      items: [{
        id: 'li-1',
        description: 'HP ZBook',
        qty: 1,
        unitPrice: 51000,
        taxRate: 0,
        discountPct: 0,
        lineSubtotal: 51000,
        productId: 'p1',
        sortOrder: 0,
      }],
    })
    expect(row).toMatchObject({
      id: 'inv-1',
      ref: 'INV/2026/0046',
      type: 'customer_invoice',
      status: 'posted',
      partnerName: 'Kevin Mbugua',
      total: 51812,
      saleOrderId: 'so-1',
    })
    expect((row.lines as unknown[]).length).toBe(1)
  })

  it('maps BILL refs to vendor_bill and voided to cancelled', () => {
    expect(mapDbInvoiceStatusToClient('voided')).toBe('cancelled')
    const row = mapDbInvoiceToClientStore({
      id: 'b1',
      invoiceNumber: 'BILL/2026/0011',
      status: 'voided',
      clientId: 'v1',
      client: { name: 'Vendor' },
      invoiceDate: '2026-08-06',
      totalAmount: 1700,
      amountPaid: 0,
      items: [],
    })
    expect(row.type).toBe('vendor_bill')
    expect(row.status).toBe('cancelled')
  })

  it('merges missing Prisma invoices into the blob without clobbering existing rows', () => {
    const blob = [{
      id: 'keep',
      ref: 'BILL/0096',
      type: 'vendor_bill',
      status: 'posted',
      purchaseOrderId: 'po-1',
      amountPaid: 0,
    }]
    const { merged, added } = mergePrismaInvoicesIntoBlob(blob, [{
      id: 'new',
      invoiceNumber: 'INV/2026/0046',
      status: 'approved',
      clientId: 'c1',
      client: { name: 'Kevin' },
      invoiceDate: '2026-08-06',
      totalAmount: 100,
      amountPaid: 0,
      items: [],
    }])
    expect(added).toBe(1)
    expect(merged).toHaveLength(2)
    expect(merged.find(r => r.id === 'keep')?.purchaseOrderId).toBe('po-1')
    expect(merged.find(r => r.id === 'new')?.ref).toBe('INV/2026/0046')
  })
})

describe('enforcePostedInvoiceImmutability (FIN-001)', () => {
  const postedInvoice = (over: Record<string, unknown> = {}) => ({
    id: 'inv1',
    ref: 'INV/2026/0001',
    status: 'posted',
    type: 'customer_invoice',
    partnerId: 'cust1',
    partnerName: 'Kevin Mbugua',
    date: '2026-08-01',
    dueDate: '2026-08-31',
    lines: [{ id: 'l1', description: 'Screen replacement', qty: 1, unitPrice: 4000, taxRate: 0, subtotal: 4000 }],
    subtotal: 4000,
    taxTotal: 0,
    total: 4000,
    amountPaid: 0,
    notes: '',
    ...over,
  })

  it('rejects a tampered total/lines/date/customer on a posted invoice and restores the stored values', () => {
    const current = [postedInvoice()]
    const incoming = [postedInvoice({ total: 51700, subtotal: 51700, date: '2020-01-01', partnerName: 'Someone Else' })]
    const { merged, rejected } = enforcePostedInvoiceImmutability(current, incoming) as {
      merged: typeof current
      rejected: { id: string; ref?: string; fields: string[] }[]
    }
    expect(merged[0].total).toBe(4000)
    expect(merged[0].subtotal).toBe(4000)
    expect(merged[0].date).toBe('2026-08-01')
    expect(merged[0].partnerName).toBe('Kevin Mbugua')
    expect(rejected).toHaveLength(1)
    expect(rejected[0].id).toBe('inv1')
    expect(rejected[0].ref).toBe('INV/2026/0001')
    expect(rejected[0].fields).toEqual(expect.arrayContaining(['total', 'subtotal', 'date', 'partnerName']))
  })

  it('rejects an invalid status transition away from posted (e.g. back to draft)', () => {
    const current = [postedInvoice()]
    const incoming = [postedInvoice({ status: 'draft' })]
    const { merged, rejected } = enforcePostedInvoiceImmutability(current, incoming) as {
      merged: typeof current
      rejected: { id: string; fields: string[] }[]
    }
    expect(merged[0].status).toBe('posted')
    expect(rejected[0].fields).toContain('status')
  })

  it('allows amountPaid, paymentBlocked, and notes to change on a posted invoice', () => {
    const current = [postedInvoice()]
    const incoming = [postedInvoice({ amountPaid: 4000, paymentBlocked: false, notes: 'Paid via M-Pesa' })]
    const { merged, rejected } = enforcePostedInvoiceImmutability(current, incoming) as { merged: typeof current; rejected: unknown[] }
    expect(merged[0].amountPaid).toBe(4000)
    expect(merged[0].notes).toBe('Paid via M-Pesa')
    expect(rejected).toHaveLength(0)
  })

  it('allows the posted → cancelled transition', () => {
    const current = [postedInvoice()]
    const incoming = [postedInvoice({ status: 'cancelled' })]
    const { merged, rejected } = enforcePostedInvoiceImmutability(current, incoming) as { merged: typeof current; rejected: unknown[] }
    expect(merged[0].status).toBe('cancelled')
    expect(rejected).toHaveLength(0)
  })

  it('leaves draft invoices fully editable', () => {
    const current = [postedInvoice({ status: 'draft' })]
    const incoming = [postedInvoice({ status: 'draft', total: 9999, subtotal: 9999 })]
    const { merged, rejected } = enforcePostedInvoiceImmutability(current, incoming) as { merged: typeof current; rejected: unknown[] }
    expect(merged[0].total).toBe(9999)
    expect(rejected).toHaveLength(0)
  })

  it('leaves a brand-new invoice (no stored counterpart) fully editable', () => {
    const current: unknown[] = []
    const incoming = [postedInvoice()]
    const { merged, rejected } = enforcePostedInvoiceImmutability(current, incoming) as { merged: typeof current; rejected: unknown[] }
    expect(merged).toEqual(incoming)
    expect(rejected).toHaveLength(0)
  })

  it('does not reject other invoices in the same batch', () => {
    const current = [postedInvoice(), postedInvoice({ id: 'inv2', ref: 'INV/2026/0002' })]
    const incoming = [
      postedInvoice({ total: 999999 }),
      postedInvoice({ id: 'inv2', ref: 'INV/2026/0002', amountPaid: 4000 }),
    ]
    const { merged, rejected } = enforcePostedInvoiceImmutability(current, incoming) as {
      merged: typeof current
      rejected: { id: string }[]
    }
    expect(rejected).toHaveLength(1)
    expect(rejected[0].id).toBe('inv1')
    expect(merged[1].amountPaid).toBe(4000)
  })
})
