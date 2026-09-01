import { invoiceDocState } from '@/lib/odoo-sales-flow'

export type RepairInvoiceJourneyAction = 'create' | 'align' | 'confirm' | 'view' | 'none'

export function repairInvoiceJourneyAction(opts: {
  repairStatus?: string | null
  noCharge?: boolean
  invoice?: { status?: unknown; amountPaid?: number | null } | null
  billingSyncNeeded?: boolean
  canRewriteInvoice?: boolean
  canManageBilling?: boolean
}): RepairInvoiceJourneyAction {
  const status = String(opts.repairStatus ?? '').toLowerCase()
  const terminal = new Set(['delivered', 'closed', 'cancelled', 'returned', 'retained', 'unrepairable']).has(status)
  const invoice = opts.invoice ?? null

  if (opts.noCharge) return invoice ? 'view' : 'none'

  if (invoice) {
    const docState = invoiceDocState(invoice.status)
    if (terminal) return 'view'
    if (docState === 'draft' && opts.canManageBilling) return 'confirm'
    if (
      opts.billingSyncNeeded
      && opts.canRewriteInvoice
      && opts.canManageBilling
      && Number(invoice.amountPaid ?? 0) <= 0
    ) return 'align'
    return 'view'
  }

  if (terminal) return 'none'
  if (!['ready', 'invoiced'].includes(status)) return 'none'
  return opts.billingSyncNeeded && opts.canManageBilling ? 'create' : 'none'
}

export function repairInvoiceJourneyLabel(action: RepairInvoiceJourneyAction): string | null {
  switch (action) {
    case 'create': return 'Create Invoice'
    case 'align': return 'Align Invoice with Quote'
    case 'confirm': return 'Confirm Invoice'
    case 'view': return 'View Invoice'
    default: return null
  }
}
