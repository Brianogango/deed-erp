import type { ConsolidationPlan } from '@/lib/repair/consolidation-plan'

/**
 * The order of writes that bills several repairs on one invoice.
 *
 * 1. Write the merged sale order.
 * 2. Invoice it. If that fails, cancel the merged order again, so the repairs
 *    go back to exactly where they were.
 * 3. Only then cancel each repair's own order.
 *
 * The old orders are retired last on purpose. Cancelling them first and then
 * failing to invoice would leave finished repairs with no live order at all —
 * nothing to bill them from. Retiring them after the invoice exists means a
 * failure at that step leaves an order that looks unbilled, which is visible
 * and harmless, and is reported by name so it can be cancelled by hand.
 *
 * The IO is passed in so the sequence can be tested without a server, and so
 * it does not live inside store.tsx, where nothing is type-checked.
 */

type Ok<T> = { ok: true } & T
type Failed = { ok: false; error?: string }

export type ConsolidationDeps<Invoice> = {
  /** Persist the merged order. The server may mint its own id. */
  createSaleOrder: (order: Record<string, unknown>) => Promise<Ok<{ id: string }> | Failed>
  invoiceSaleOrder: (saleOrderId: string, order: Record<string, unknown>) => Promise<Ok<{ invoice: Invoice; saleOrderId: string }> | Failed>
  cancelSaleOrder: (saleOrderId: string) => Promise<Ok<object> | Failed>
}

type ConsolidationOutcome<Invoice> =
  | {
    ok: true
    invoice: Invoice
    saleOrderId: string
    /** Superseded orders that could not be cancelled — still open, still to tidy up. */
    stillOpenSaleOrderIds: string[]
  }
  | {
    ok: false
    error: string
    /** A merged order that was written but could not be cancelled after the failure. */
    strandedSaleOrderId?: string
  }

export function mergedSaleOrderFromPlan(
  plan: Extract<ConsolidationPlan, { ok: true }>,
  opts: { id: string; ref: string; customerName: string; createdByUserId?: string; now: string; date: string },
): Record<string, unknown> {
  return {
    id: opts.id,
    ref: opts.ref,
    status: 'sale',
    confirmedAt: opts.now,
    customerId: plan.clientId,
    customerName: opts.customerName,
    date: opts.date,
    // Repair billing is post-work invoicing; nothing is picked from stock.
    reserveStock: false,
    lines: plan.lines,
    subtotal: plan.subtotal,
    taxAmount: plan.taxTotal,
    taxTotal: plan.taxTotal,
    totalAmount: plan.total,
    total: plan.total,
    notes: plan.notes,
    ...(opts.createdByUserId ? { createdByUserId: opts.createdByUserId } : {}),
  }
}

export async function executeRepairConsolidation<Invoice>(
  plan: Extract<ConsolidationPlan, { ok: true }>,
  order: Record<string, unknown>,
  deps: ConsolidationDeps<Invoice>,
): Promise<ConsolidationOutcome<Invoice>> {
  const created = await deps.createSaleOrder(order)
  if (!created.ok) {
    return { ok: false, error: created.error || 'Could not save the combined sale order' }
  }

  const billed = await deps.invoiceSaleOrder(created.id, order)
  if (!billed.ok) {
    const undone = await deps.cancelSaleOrder(created.id)
    return {
      ok: false,
      error: billed.error || 'Could not invoice the combined sale order',
      ...(undone.ok ? {} : { strandedSaleOrderId: created.id }),
    }
  }

  const stillOpenSaleOrderIds: string[] = []
  for (const id of plan.supersededSaleOrderIds) {
    // The server may have re-minted the merged order's id; never cancel it.
    if (id === billed.saleOrderId || id === created.id) continue
    const cancelled = await deps.cancelSaleOrder(id)
    if (!cancelled.ok) stillOpenSaleOrderIds.push(id)
  }

  return { ok: true, invoice: billed.invoice, saleOrderId: billed.saleOrderId, stillOpenSaleOrderIds }
}
