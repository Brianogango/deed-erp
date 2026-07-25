import { describe, it, expect } from 'vitest'
import {
  normalizeSaleStatus,
  normalizeSaleOrderForClient,
  legacyApprovalFromStatus,
  isQuotationStage,
  SALE_STATUS_BAR,
  SALE_STATUS_LABELS,
  invoiceableQty,
  saleOrderInvoiceStatus,
  splitDeliveryForBackorder,
  normalizeDeliveryStatus,
  invoiceDocState,
  invoicePaymentStatus,
  isInvoiceOverdue,
  saleOrderCancelBlockers,
  matchesSalesListFilter,
} from '@/lib/odoo-sales-flow'

describe('sale order status vocabulary', () => {
  it('uses the Odoo status bar Quotation → Quotation Sent → Sales Order', () => {
    expect(SALE_STATUS_BAR).toEqual(['quotation', 'quotation_sent', 'sale'])
    expect(SALE_STATUS_LABELS.quotation).toBe('Quotation')
    expect(SALE_STATUS_LABELS.quotation_sent).toBe('Quotation Sent')
    expect(SALE_STATUS_LABELS.sale).toBe('Sales Order')
    expect(SALE_STATUS_LABELS.cancelled).toBe('Cancelled')
    // Cancelled is an exception state, not a progress stage.
    expect(SALE_STATUS_BAR).not.toContain('cancelled')
  })

  it('a new quotation remains a Quotation (draft DB default maps to Quotation)', () => {
    expect(normalizeSaleStatus('quotation')).toBe('quotation')
    expect(normalizeSaleStatus('pending')).toBe('quotation')
    expect(normalizeSaleStatus('draft')).toBe('quotation')
    expect(normalizeSaleStatus('')).toBe('quotation')
    expect(normalizeSaleStatus(undefined)).toBe('quotation')
  })

  it('maps legacy fulfilment statuses onto Sales Order without losing the stage', () => {
    for (const legacy of ['confirmed', 'delivered', 'invoiced', 'reserved', 'paid']) {
      expect(normalizeSaleStatus(legacy)).toBe('sale')
    }
  })

  it('maps legacy approval statuses onto Quotation with an approval flag', () => {
    expect(normalizeSaleStatus('pending_approval')).toBe('quotation')
    expect(normalizeSaleStatus('approved')).toBe('quotation')
    expect(legacyApprovalFromStatus('pending_approval')).toBe('pending')
    expect(legacyApprovalFromStatus('approved')).toBe('approved')
    expect(legacyApprovalFromStatus('quotation')).toBeUndefined()

    const normalized = normalizeSaleOrderForClient({ status: 'pending_approval' })
    expect(normalized.status).toBe('quotation')
    expect((normalized as any).approvalStatus).toBe('pending')
    // An explicit approval status is never overwritten.
    const kept = normalizeSaleOrderForClient({ status: 'approved', approvalStatus: 'rejected' })
    expect((kept as any).approvalStatus).toBe('rejected')
  })

  it('keeps modern statuses as-is', () => {
    expect(normalizeSaleStatus('quotation_sent')).toBe('quotation_sent')
    expect(normalizeSaleStatus('sent')).toBe('quotation_sent')
    expect(normalizeSaleStatus('sale')).toBe('sale')
    expect(normalizeSaleStatus('cancelled')).toBe('cancelled')
  })

  it('treats quotation and quotation_sent as the quotation stage', () => {
    expect(isQuotationStage('quotation')).toBe(true)
    expect(isQuotationStage('quotation_sent')).toBe(true)
    expect(isQuotationStage('sale')).toBe(false)
    expect(isQuotationStage('cancelled')).toBe(false)
  })
})

describe('invoicing policy — invoiceable quantities', () => {
  it('ordered-quantity policy allows invoicing after confirmation regardless of delivery', () => {
    expect(invoiceableQty({ qty: 5, qtyDelivered: 0, qtyInvoiced: 0, invoicePolicy: 'order' })).toBe(5)
    expect(invoiceableQty({ qty: 5, qtyDelivered: 0, qtyInvoiced: 2, invoicePolicy: 'order' })).toBe(3)
    expect(invoiceableQty({ qty: 5, qtyDelivered: 0, qtyInvoiced: 5, invoicePolicy: 'order' })).toBe(0)
  })

  it('delivered-quantity policy prevents invoicing undelivered quantities', () => {
    expect(invoiceableQty({ qty: 5, qtyDelivered: 0, qtyInvoiced: 0, invoicePolicy: 'delivery' })).toBe(0)
    expect(invoiceableQty({ qty: 5, qtyDelivered: 3, qtyInvoiced: 0, invoicePolicy: 'delivery' })).toBe(3)
    expect(invoiceableQty({ qty: 5, qtyDelivered: 3, qtyInvoiced: 3, invoicePolicy: 'delivery' })).toBe(0)
    expect(invoiceableQty({ qty: 5, qtyDelivered: 5, qtyInvoiced: 3, invoicePolicy: 'delivery' })).toBe(2)
  })

  it('defaults to the ordered policy and never returns negative quantities', () => {
    expect(invoiceableQty({ qty: 2 })).toBe(2)
    expect(invoiceableQty({ qty: 2, qtyInvoiced: 5 })).toBe(0)
  })
})

describe('sale order invoice status', () => {
  it('quotations are always Nothing to Invoice', () => {
    expect(saleOrderInvoiceStatus('quotation', [{ qty: 5 }])).toBe('no')
    expect(saleOrderInvoiceStatus('quotation_sent', [{ qty: 5 }])).toBe('no')
    expect(saleOrderInvoiceStatus('cancelled', [{ qty: 5 }])).toBe('no')
  })

  it('a confirmed order with ordered-policy lines is To Invoice, then Fully Invoiced', () => {
    expect(saleOrderInvoiceStatus('sale', [{ qty: 5, qtyInvoiced: 0 }])).toBe('to_invoice')
    expect(saleOrderInvoiceStatus('sale', [{ qty: 5, qtyInvoiced: 2 }])).toBe('to_invoice')
    expect(saleOrderInvoiceStatus('sale', [{ qty: 5, qtyInvoiced: 5 }])).toBe('invoiced')
  })

  it('delivered-policy lines show Nothing to Invoice until delivery happens', () => {
    const lines = [{ qty: 5, qtyDelivered: 0, qtyInvoiced: 0, invoicePolicy: 'delivery' as const }]
    expect(saleOrderInvoiceStatus('sale', lines)).toBe('no')
    const delivered = [{ qty: 5, qtyDelivered: 2, qtyInvoiced: 0, invoicePolicy: 'delivery' as const }]
    expect(saleOrderInvoiceStatus('sale', delivered)).toBe('to_invoice')
    const invoiced = [{ qty: 5, qtyDelivered: 2, qtyInvoiced: 2, invoicePolicy: 'delivery' as const }]
    expect(saleOrderInvoiceStatus('sale', invoiced)).toBe('invoiced')
  })

  it('partial invoicing keeps the order To Invoice', () => {
    const lines = [
      { qty: 3, qtyInvoiced: 3 },
      { qty: 2, qtyInvoiced: 0 },
    ]
    expect(saleOrderInvoiceStatus('sale', lines)).toBe('to_invoice')
  })

  it('over-delivery on a fully invoiced order is an Upselling Opportunity', () => {
    const lines = [{ qty: 2, qtyDelivered: 3, qtyInvoiced: 3, invoicePolicy: 'delivery' as const }]
    expect(saleOrderInvoiceStatus('sale', lines)).toBe('upselling')
  })

  it('orders without lines have nothing to invoice', () => {
    expect(saleOrderInvoiceStatus('sale', [])).toBe('no')
  })
})

describe('delivery states, partial delivery and backorders', () => {
  it('normalizes legacy delivery statuses onto Odoo stock states', () => {
    expect(normalizeDeliveryStatus('ready')).toBe('ready')
    expect(normalizeDeliveryStatus('done')).toBe('done')
    expect(normalizeDeliveryStatus('cancelled')).toBe('cancelled')
    expect(normalizeDeliveryStatus('pending')).toBe('waiting')
    expect(normalizeDeliveryStatus('waiting')).toBe('waiting')
    expect(normalizeDeliveryStatus('draft')).toBe('draft')
  })

  it('full validation produces done lines and no backorder', () => {
    const lines = [{ productId: 'p1', productName: 'Laptop', qty: 3, qtyDone: 0, serialIds: [] }]
    const { doneLines, backorderLines } = splitDeliveryForBackorder(lines, { p1: 3 })
    expect(doneLines).toHaveLength(1)
    expect(doneLines[0].qtyDone).toBe(3)
    expect(backorderLines).toHaveLength(0)
  })

  it('partial validation creates a backorder with the remaining quantity', () => {
    const lines = [
      { productId: 'p1', productName: 'Laptop', qty: 5, qtyDone: 0, serialIds: [] },
      { productId: 'p2', productName: 'Mouse', qty: 2, qtyDone: 0, serialIds: [] },
    ]
    const { doneLines, backorderLines } = splitDeliveryForBackorder(lines, { p1: 3, p2: 2 })
    expect(doneLines.map(l => [l.productId, l.qtyDone])).toEqual([['p1', 3], ['p2', 2]])
    expect(backorderLines).toEqual([
      { productId: 'p1', productName: 'Laptop', qty: 2, qtyDone: 0, serialIds: [] },
    ])
  })

  it('clamps quantities to the ordered amount and ignores negatives', () => {
    const lines = [{ productId: 'p1', productName: 'Laptop', qty: 2, qtyDone: 0, serialIds: [] }]
    expect(splitDeliveryForBackorder(lines, { p1: 99 }).doneLines[0].qtyDone).toBe(2)
    const neg = splitDeliveryForBackorder(lines, { p1: -4 })
    expect(neg.doneLines).toHaveLength(0)
    expect(neg.backorderLines[0].qty).toBe(2)
  })
})

describe('invoice document state and payment status', () => {
  it('separates the document state from payment progress', () => {
    expect(invoiceDocState('draft')).toBe('draft')
    expect(invoiceDocState('posted')).toBe('posted')
    expect(invoiceDocState('partially_paid')).toBe('posted')
    expect(invoiceDocState('paid')).toBe('posted')
    expect(invoiceDocState('overdue')).toBe('posted')
    expect(invoiceDocState('cancelled')).toBe('cancelled')
    expect(invoiceDocState('voided')).toBe('cancelled')
  })

  it('computes Not Paid / Partially Paid / Paid from the residual, never user-chosen', () => {
    expect(invoicePaymentStatus({ status: 'posted', total: 100, amountPaid: 0 })).toBe('not_paid')
    expect(invoicePaymentStatus({ status: 'posted', total: 100, amountPaid: 40 })).toBe('partially_paid')
    expect(invoicePaymentStatus({ status: 'posted', total: 100, amountPaid: 100 })).toBe('paid')
    expect(invoicePaymentStatus({ status: 'paid', total: 100, amountPaid: 100 })).toBe('paid')
  })

  it('full payment via uncleared instruments is In Payment until cleared', () => {
    const inv = {
      status: 'posted', total: 100, amountPaid: 100,
      payments: [{ amount: 100, cleared: false }],
    }
    expect(invoicePaymentStatus(inv)).toBe('in_payment')
    expect(invoicePaymentStatus({ ...inv, payments: [{ amount: 100, cleared: true }] })).toBe('paid')
  })

  it('a reversed/cancelled invoice with prior payments is Reversed', () => {
    expect(invoicePaymentStatus({ status: 'cancelled', total: 100, amountPaid: 100 })).toBe('reversed')
    expect(invoicePaymentStatus({ status: 'cancelled', total: 100, amountPaid: 0 })).toBe('not_paid')
  })

  it('overdue is computed from due date + residual and does not change the document state', () => {
    const today = '2026-07-25'
    const overdue = { status: 'posted', total: 100, amountPaid: 20, dueDate: '2026-07-01' }
    expect(isInvoiceOverdue(overdue, today)).toBe(true)
    expect(invoiceDocState(overdue.status)).toBe('posted')
    expect(isInvoiceOverdue({ ...overdue, amountPaid: 100 }, today)).toBe(false)
    expect(isInvoiceOverdue({ ...overdue, dueDate: '2026-08-01' }, today)).toBe(false)
    expect(isInvoiceOverdue({ ...overdue, status: 'draft' }, today)).toBe(false)
  })
})

describe('cancellation guards', () => {
  it('quotations cancel freely', () => {
    expect(saleOrderCancelBlockers({ status: 'quotation', deliveries: [], invoices: [] })).toEqual([])
    expect(saleOrderCancelBlockers({
      status: 'quotation_sent',
      deliveries: [{ status: 'done' }],
      invoices: [{ status: 'posted', amountPaid: 50 }],
    })).toEqual([])
  })

  it('a sales order with completed deliveries, posted invoices or payments is blocked', () => {
    const blockers = saleOrderCancelBlockers({
      status: 'sale',
      deliveries: [{ status: 'done' }, { status: 'ready' }],
      invoices: [{ status: 'posted', amountPaid: 50 }],
    })
    expect(blockers).toHaveLength(3)
    expect(blockers[0]).toContain('completed delivery')
    expect(blockers[1]).toContain('posted invoice')
    expect(blockers[2]).toContain('payments registered')
  })

  it('a sales order with only pending records may cancel', () => {
    expect(saleOrderCancelBlockers({
      status: 'sale',
      deliveries: [{ status: 'ready' }, { status: 'waiting' }],
      invoices: [{ status: 'draft', amountPaid: 0 }, { status: 'cancelled', amountPaid: 0 }],
    })).toEqual([])
  })
})

describe('list filters', () => {
  const q = { status: 'quotation' as const, createdByUserId: 'u1', lines: [{ qty: 1 }] }
  const sent = { status: 'quotation_sent' as const, createdByUserId: 'u2', lines: [{ qty: 1 }] }
  const so = { status: 'sale' as const, createdByUserId: 'u2', lines: [{ qty: 2, qtyInvoiced: 0 }] }
  const invoiced = { status: 'sale' as const, createdByUserId: 'u2', lines: [{ qty: 2, qtyInvoiced: 2 }] }
  const cancelled = { status: 'cancelled' as const, createdByUserId: 'u1', lines: [] }

  it('distinguishes quotations, quotation sent, sales orders and cancelled', () => {
    expect(matchesSalesListFilter(q, 'quotations')).toBe(true)
    expect(matchesSalesListFilter(sent, 'quotations')).toBe(true)
    expect(matchesSalesListFilter(so, 'quotations')).toBe(false)
    expect(matchesSalesListFilter(sent, 'quotation_sent')).toBe(true)
    expect(matchesSalesListFilter(so, 'sales_orders')).toBe(true)
    expect(matchesSalesListFilter(cancelled, 'cancelled')).toBe(true)
  })

  it('supports My Quotations, To Invoice and Fully Invoiced', () => {
    expect(matchesSalesListFilter(q, 'my_quotations', 'u1')).toBe(true)
    expect(matchesSalesListFilter(sent, 'my_quotations', 'u1')).toBe(false)
    expect(matchesSalesListFilter(so, 'to_invoice')).toBe(true)
    expect(matchesSalesListFilter(invoiced, 'to_invoice')).toBe(false)
    expect(matchesSalesListFilter(invoiced, 'fully_invoiced')).toBe(true)
  })
})
