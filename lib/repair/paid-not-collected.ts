import { invoiceDocState } from '@/lib/odoo-sales-flow'

/**
 * A repair that is paid in full but still waits at Ready / Invoiced. Staff
 * often took the money and handed the device over without "Mark collected",
 * so the job never closed (25 jobs sat at Ready for weeks). Flagged so the
 * handover gets recorded. Pure.
 */

type RepairLike = { id: string; status: string; invoiceId?: string; linkedInvoiceId?: string }
type InvoiceLike = { id: string; repairId?: string; status: string; total: number; amountPaid: number }

const AWAITING_PICKUP = new Set(['ready', 'invoiced'])

/** The repair's invoice: its own link first, else an invoice that names the repair. */
export function repairInvoiceFor<I extends InvoiceLike>(r: RepairLike, invoices: I[]): I | undefined {
  const linked = r.invoiceId ?? r.linkedInvoiceId
  return (linked ? invoices.find(i => i.id === linked) : undefined) ?? invoices.find(i => i.repairId === r.id)
}

export function isPaidNotCollected(r: RepairLike, invoices: InvoiceLike[]): boolean {
  if (!AWAITING_PICKUP.has(r.status)) return false
  const inv = repairInvoiceFor(r, invoices)
  if (!inv || invoiceDocState(inv.status) !== 'posted') return false
  const total = Number(inv.total) || 0
  return total > 0 && (Number(inv.amountPaid) || 0) >= total - 0.005
}
