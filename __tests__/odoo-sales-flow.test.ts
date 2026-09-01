import { describe, it, expect } from 'vitest'
import {
  normalizeSaleStatus,
  normalizeSaleOrderForClient,
  legacyApprovalFromStatus,
  isQuotationStage,
  isQuotationDraft,
  saleOrderLooksConfirmed,
  remainingUndeliveredByProduct,
  openDeliveryDemandByProduct,
  deliveriesForSaleOrder,
  SALE_STATUS_BAR,
  SALE_STATUS_LABELS,
  invoiceableQty,
  saleOrderInvoiceStatus,
  saleOrderInvoicePrimaryAction,
  splitDeliveryForBackorder,
  normalizeDeliveryStatus,
  invoiceDocState,
  invoicePaymentStatus,
  isInvoiceOverdue,
  invoiceResidual,
  isOpenInvoice,
  shouldReplaceCancelledDelivery,
  saleOrderCancelBlockers,
  matchesSalesListFilter,
  matchesSalesListTab,
  saleTransitionError,
  initialDeliveryState,
  hasGeneratedDeliveryNote,
  hasValidatedDeliveryForInvoice,
  effectiveDeliveryLineQty,
  deliveryDeliveredTotal,
  deliveredByProductFromDoneDeliveries,
  canGenerateDeliveryNote,
  isHollowDoneDelivery,
  deliveryFulfillmentWriteError,
} from '@/lib/odoo-sales-flow'

describe('delivery-note invoice gate', () => {
  it('DN stamp helper still requires generated note + delivered qty > 0', () => {
    const deliveries = [
      { saleOrderId: 'so-1', status: 'ready', deliveryNoteGeneratedAt: '2026-07-28', lines: [{ qty: 1, qtyDone: 1 }] },
      {
        saleOrderId: 'so-2',
        status: 'done',
        deliveryNoteGeneratedAt: '2026-07-28',
        lines: [{ qty: 1, qtyDone: 1, serialIds: [] }],
      },
      { saleOrderId: 'so-1', status: 'done', lines: [{ qty: 1, qtyDone: 1 }] },
      {
        saleOrderId: 'so-3',
        status: 'done',
        deliveryNoteGeneratedAt: '2026-08-01',
        lines: [{ qty: 1, qtyDone: 0, serialIds: [] }],
      },
    ]
    expect(hasGeneratedDeliveryNote(deliveries, 'so-1')).toBe(false)
    expect(hasGeneratedDeliveryNote(deliveries, 'so-2')).toBe(true)
    expect(hasGeneratedDeliveryNote(deliveries, 'so-3')).toBe(false)
  })

  it('invoice unlocks after validated Done delivery even without printing the DN', () => {
    const deliveries = [
      { saleOrderId: 'so-1', status: 'ready', lines: [{ qty: 1, qtyDone: 1 }] },
      { saleOrderId: 'so-2', status: 'done', lines: [{ qty: 1, qtyDone: 1, serialIds: [] }] },
      {
        saleOrderId: 'so-3',
        status: 'done',
        deliveryNoteGeneratedAt: '2026-08-01',
        lines: [{ qty: 1, qtyDone: 0, serialIds: [] }],
      },
    ]
    expect(hasValidatedDeliveryForInvoice(deliveries, 'so-1')).toBe(false)
    expect(hasValidatedDeliveryForInvoice(deliveries, 'so-2')).toBe(true)
    expect(hasValidatedDeliveryForInvoice(deliveries, 'so-3')).toBe(false)
  })

  it('blocks Generate DN and Done writes when delivered qty is 0', () => {
    const hollow = { status: 'done', lines: [{ qty: 1, qtyDone: 0, serialIds: [] }] }
    expect(isHollowDoneDelivery(hollow)).toBe(true)
    expect(canGenerateDeliveryNote(hollow)).toBe(false)
    expect(deliveryFulfillmentWriteError(hollow, { status: 'ready', preparedAt: '2026-08-01' }))
      .toMatch(/delivered quantity is 0/i)

    const good = {
      status: 'done',
      preparedAt: '2026-08-01',
      lines: [{ qty: 1, qtyDone: 1, serialIds: [] }],
    }
    expect(canGenerateDeliveryNote(good)).toBe(true)
    expect(deliveryFulfillmentWriteError(good, { status: 'ready', preparedAt: '2026-08-01' })).toBeNull()
  })

  it('rejects Done without Ready + preparedAt', () => {
    const next = { status: 'done', lines: [{ qty: 1, qtyDone: 1 }] }
    expect(deliveryFulfillmentWriteError(next, { status: 'waiting' }))
      .toMatch(/Prepare and reserve/i)
  })
})

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

  it('treats SO number / confirmedAt as confirmed even when status drifted', () => {
    expect(saleOrderLooksConfirmed({ status: 'sale' })).toBe(true)
    expect(saleOrderLooksConfirmed({ status: 'quotation', orderNumber: 'SO/2026/0006' })).toBe(true)
    expect(saleOrderLooksConfirmed({ status: 'quotation_sent', confirmedAt: '2026-08-03' })).toBe(true)
    expect(saleOrderLooksConfirmed({ status: 'quotation', orderNumber: 'SQ/2026/0014' })).toBe(false)
    expect(saleOrderLooksConfirmed({ status: 'cancelled', orderNumber: 'SO/2026/0006' })).toBe(false)
  })

  it('computes remaining undelivered qty and open delivery demand', () => {
    expect(remainingUndeliveredByProduct([
      { productId: 'p1', qty: 2, qtyDelivered: 1 },
      { productId: 'p2', qty: 1, qtyDelivered: 1 },
      { productId: 'p3', qty: 3, lineType: 'section' },
    ])).toEqual({ p1: 1, p2: 0 })

    expect(openDeliveryDemandByProduct([
      { saleOrderId: 'so-1', status: 'waiting', lines: [{ productId: 'p1', qty: 1 }] },
      { saleOrderId: 'so-1', status: 'ready', lines: [{ productId: 'p1', qty: 1 }] },
      { saleOrderId: 'so-1', status: 'done', lines: [{ productId: 'p1', qty: 1 }] },
      { saleOrderId: 'so-1', status: 'cancelled', lines: [{ productId: 'p1', qty: 9 }] },
      { saleOrderId: 'so-2', status: 'waiting', lines: [{ productId: 'p1', qty: 5 }] },
    ], 'so-1')).toEqual({ p1: 2 })

    expect(deliveriesForSaleOrder([
      { saleOrderId: 'so-1', status: 'waiting' },
      { saleOrderId: 'so-1', status: 'cancelled' },
      { saleOrderId: 'so-2', status: 'ready' },
    ], 'so-1')).toHaveLength(1)
    expect(deliveriesForSaleOrder([
      { saleOrderId: 'so-1', status: 'waiting' },
      { saleOrderId: 'so-1', status: 'cancelled' },
    ], 'so-1', { includeCancelled: true })).toHaveLength(2)
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

  it('treats only quotation as an editable draft', () => {
    expect(isQuotationDraft('quotation')).toBe(true)
    expect(isQuotationDraft('quotation_sent')).toBe(false)
    expect(isQuotationDraft('sale')).toBe(false)
    expect(isQuotationDraft('cancelled')).toBe(false)
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

  it('creates a replacement DN when the only picking was cancelled', () => {
    expect(shouldReplaceCancelledDelivery({
      soStatus: 'sale',
      deliveries: [{ status: 'cancelled' }],
    })).toBe(true)
    expect(shouldReplaceCancelledDelivery({
      soStatus: 'sale',
      deliveries: [{ status: 'waiting' }],
    })).toBe(false)
    expect(shouldReplaceCancelledDelivery({
      soStatus: 'sale',
      deliveries: [{ status: 'done' }],
    })).toBe(false)
    expect(shouldReplaceCancelledDelivery({
      soStatus: 'cancelled',
      deliveries: [{ status: 'cancelled' }],
    })).toBe(false)
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

  it('falls back to assigned serials when requested qty / qtyDone is 0', () => {
    const lines = [{
      productId: 'p1',
      productName: 'ThinkPad',
      qty: 1,
      qtyDone: 0,
      serialIds: ['sid-1'],
    }]
    expect(effectiveDeliveryLineQty(lines[0])).toBe(1)
    expect(effectiveDeliveryLineQty(lines[0], 0)).toBe(1)
    const { doneLines, backorderLines } = splitDeliveryForBackorder(lines, { p1: 0 })
    expect(doneLines).toEqual([{
      productId: 'p1',
      productName: 'ThinkPad',
      qty: 1,
      qtyDone: 1,
      serialIds: ['sid-1'],
    }])
    expect(backorderLines).toHaveLength(0)
    expect(deliveryDeliveredTotal({ lines })).toBe(1)
  })

  it('validates duplicate product rows (SO/2026/0029 ThinkPad 1+2+1) without false serial-split errors', () => {
    const thinkpad = 'prod-thinkpad'
    const lines = [
      { productId: thinkpad, productName: 'ThinkPad T495s', qty: 1, qtyDone: 1, serialIds: ['s1'] },
      { productId: thinkpad, productName: 'ThinkPad T495s', qty: 2, qtyDone: 2, serialIds: ['s2', 's3'] },
      { productId: thinkpad, productName: 'ThinkPad T495s', qty: 1, qtyDone: 1, serialIds: ['s4'] },
    ]
    // Collapsed Object.fromEntries map (last wins = 1) — must still ship all rows.
    const collapsed = Object.fromEntries(
      lines.map(line => [line.productId, effectiveDeliveryLineQty(line)]),
    )
    expect(collapsed[thinkpad]).toBe(1)

    const { doneLines, backorderLines, lineDone } = splitDeliveryForBackorder(lines, collapsed)
    expect(lineDone).toEqual([1, 2, 1])
    expect(doneLines.map(l => l.qty)).toEqual([1, 2, 1])
    expect(backorderLines).toHaveLength(0)

    // Summed pool (correct UI path) also works.
    const summed = { [thinkpad]: 4 }
    const full = splitDeliveryForBackorder(lines, summed)
    expect(full.lineDone).toEqual([1, 2, 1])
    expect(full.backorderLines).toHaveLength(0)
  })

  it('does not let .find(productId) semantics affect per-line done (qty-1 then qty-2)', () => {
    const thinkpad = 'prod-thinkpad'
    const lines = [
      { productId: thinkpad, productName: 'ThinkPad', qty: 1, qtyDone: 1, serialIds: ['a'] },
      { productId: thinkpad, productName: 'ThinkPad', qty: 2, qtyDone: 2, serialIds: ['b', 'c'] },
    ]
    const { lineDone } = splitDeliveryForBackorder(lines, { [thinkpad]: 1 })
    // First line consumes local=1; second keeps its own local=2 even if pool was collapsed.
    expect(lineDone[0]).toBe(1)
    expect(lineDone[1]).toBe(2)
    // The old guard used doneLines.find(productId).qty === 1 against line qty 2 → false error.
    expect(lineDone[1] < lines[1].qty).toBe(false)
  })

  it('heals delivered-by-product from Done deliveries with serials', () => {
    const map = deliveredByProductFromDoneDeliveries([
      {
        saleOrderId: 'so-1',
        status: 'done',
        lines: [{ productId: 'p1', qty: 1, qtyDone: 0, serialIds: ['s1'] }],
      },
      {
        saleOrderId: 'so-1',
        status: 'ready',
        lines: [{ productId: 'p1', qty: 1, qtyDone: 1, serialIds: ['s2'] }],
      },
      {
        saleOrderId: 'so-2',
        status: 'done',
        lines: [{ productId: 'p1', qty: 1, qtyDone: 1, serialIds: [] }],
      },
    ], 'so-1')
    expect(map).toEqual({ p1: 1 })
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

  it('falls back to invoice date when dueDate is missing (same rule as Needs attention)', () => {
    const today = '2026-08-27'
    expect(isInvoiceOverdue({
      status: 'posted', total: 100, amountPaid: 0, date: '2026-08-01',
    }, today)).toBe(true)
    expect(isInvoiceOverdue({
      status: 'posted', total: 100, amountPaid: 0, date: '2026-08-28',
    }, today)).toBe(false)
  })
})

describe('saleTransitionError role gates', () => {
  it('blocks sales_rep from cancelling or resetting a confirmed sale', () => {
    expect(saleTransitionError('sale', 'cancelled', 'sales_rep')).toMatch(/Finance, Admin Officer, or Director/i)
    expect(saleTransitionError('sale', 'quotation', 'sales_rep')).toMatch(/Finance, Admin Officer, or Director/i)
  })

  it('allows Finance, Admin Officer, and Director to cancel or reset a confirmed sale', () => {
    expect(saleTransitionError('sale', 'cancelled', 'finance_officer')).toBeNull()
    expect(saleTransitionError('sale', 'quotation', 'director')).toBeNull()
    expect(saleTransitionError('sale', 'cancelled', 'admin_officer')).toBeNull()
    expect(saleTransitionError('sale', 'quotation', 'admin_officer')).toBeNull()
  })

  it('allows sales staff to cancel quotations', () => {
    expect(saleTransitionError('quotation', 'cancelled', 'sales_rep')).toBeNull()
    expect(saleTransitionError('quotation_sent', 'quotation', 'sales_rep')).toBeNull()
  })

  it('blocks sales_rep from resetting a cancelled-but-previously-confirmed order', () => {
    expect(
      saleTransitionError('cancelled', 'quotation', 'sales_rep', { previouslyConfirmed: true }),
    ).toMatch(/Finance, Admin Officer, or Director/i)
    expect(
      saleTransitionError('cancelled', 'quotation', 'finance_officer', { previouslyConfirmed: true }),
    ).toBeNull()
    expect(
      saleTransitionError('cancelled', 'quotation', 'admin_officer', { previouslyConfirmed: true }),
    ).toBeNull()
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

  it('keeps cancelled SO/… rows on Orders, not Quotations (same-document tabs)', () => {
    const draftQuote = { status: 'quotation', ref: 'QUO/2026/0132' }
    const sentQuote = { status: 'quotation_sent', ref: 'QUO/2026/0120' }
    const cancelledQuote = { status: 'cancelled', ref: 'QUO/2026/0100' }
    // Screenshot bug: cancelled sales orders with SO prefix but no confirmedAt
    // were incorrectly listed under Quotations.
    const cancelledSoNoConfirmedAt = { status: 'cancelled', ref: 'SO/2026/0030' }
    const cancelledSoWithConfirmedAt = {
      status: 'cancelled',
      orderNumber: 'SO/2026/0028',
      confirmedAt: '2026-07-01',
    }
    const liveSo = { status: 'sale', ref: 'SO/2026/0040', quotationRef: 'QUO/2026/0099' }

    expect(matchesSalesListTab(draftQuote, 'quotations')).toBe(true)
    expect(matchesSalesListTab(sentQuote, 'quotations')).toBe(true)
    expect(matchesSalesListTab(cancelledQuote, 'quotations')).toBe(true)
    expect(matchesSalesListTab(cancelledSoNoConfirmedAt, 'quotations')).toBe(false)
    expect(matchesSalesListTab(cancelledSoWithConfirmedAt, 'quotations')).toBe(false)
    expect(matchesSalesListTab(liveSo, 'quotations')).toBe(false)

    expect(matchesSalesListTab(draftQuote, 'orders')).toBe(false)
    expect(matchesSalesListTab(cancelledQuote, 'orders')).toBe(false)
    expect(matchesSalesListTab(cancelledSoNoConfirmedAt, 'orders')).toBe(true)
    expect(matchesSalesListTab(cancelledSoWithConfirmedAt, 'orders')).toBe(true)
    expect(matchesSalesListTab(liveSo, 'orders')).toBe(true)
  })
})


describe('sales order invoice primary action', () => {
  it('shows Confirm invoice when a regular draft invoice already exists', () => {
    expect(saleOrderInvoicePrimaryAction({
      invoices: [{ id: 'inv-draft', status: 'draft', total: 1000, type: 'customer_invoice' }],
      orderTotal: 1000,
      canCreateInvoiceNow: true,
      invoiceStatus: 'to_invoice',
    })).toEqual({ kind: 'confirm', invoiceId: 'inv-draft' })
  })

  it('shows View invoice for a posted full-value invoice even when qty counters are stale', () => {
    expect(saleOrderInvoicePrimaryAction({
      invoices: [{ id: 'inv-posted', status: 'posted', total: 314360, type: 'customer_invoice' }],
      orderTotal: 314360,
      canCreateInvoiceNow: true,
      invoiceStatus: 'to_invoice',
    })).toEqual({ kind: 'view', invoiceId: 'inv-posted' })
  })

  it('still allows another invoice after a posted partial invoice', () => {
    expect(saleOrderInvoicePrimaryAction({
      invoices: [{ id: 'inv-partial', status: 'posted', total: 500, type: 'customer_invoice' }],
      orderTotal: 1000,
      canCreateInvoiceNow: true,
      invoiceStatus: 'to_invoice',
    })).toEqual({ kind: 'create' })
  })

  it('ignores down-payment invoices for the regular invoice CTA', () => {
    expect(saleOrderInvoicePrimaryAction({
      invoices: [{ id: 'deposit', status: 'posted', total: 300, type: 'customer_invoice', isDownPayment: true }],
      orderTotal: 1000,
      canCreateInvoiceNow: true,
      invoiceStatus: 'to_invoice',
    })).toEqual({ kind: 'create' })
  })
})
