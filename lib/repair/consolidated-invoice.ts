import { isRepairNoCharge } from '@/lib/repair-billing-exempt'
import {
  buildRepairInvoiceCharges,
  isUnrepairableRepair,
  type RepairInvoiceChargeLine,
  type RepairInvoiceSource,
} from '@/lib/repair-invoice'
import { isRepairFulfillmentReady } from '@/lib/repair/sale-order-link'

/**
 * The charges of several repairs laid out as one document.
 *
 * Each repair is billed exactly as it would be on its own —
 * buildRepairInvoiceCharges decides what a single repair owes, including the
 * VAT its quote actually carried and any diagnosis fee still outstanding.
 * This only puts those charges side by side under a heading per repair. A
 * batch must never price a repair differently from the invoice it would have
 * had alone, or billing two repairs together would change what the customer
 * owes for either of them.
 */

export type ConsolidatableRepair = RepairInvoiceSource & {
  id?: string | null
  ref?: string | null
  productName?: string | null
  serialNumber?: string | null
  /** The billed customer. The store calls it customerId. */
  clientId?: string | null
  customerId?: string | null
  invoiceId?: string | null
  saleOrderId?: string | null
}

export type ConsolidatedInvoiceLine = RepairInvoiceChargeLine & {
  repairId: string
  repairRef: string
  lineType?: 'section'
}

export type ConsolidatedInvoiceDraft = {
  lines: ConsolidatedInvoiceLine[]
  subtotal: number
  taxTotal: number
  total: number
  /** Some lines carry VAT and some do not — worth a second look before posting. */
  mixedVat: boolean
}

export function repairSectionTitle(repair: ConsolidatableRepair): string {
  const ref = String(repair.ref ?? repair.id ?? '').trim()
  const device = String(repair.productName ?? '').trim()
  return device ? `Repair ${ref} — ${device}` : `Repair ${ref}`
}

/**
 * Why a repair cannot go into a combined invoice, or null when it can.
 *
 * Kept as a reason rather than a boolean because the person picking repairs
 * needs to know which one is wrong and what to do about it.
 */
export function consolidationBlocker(repair: ConsolidatableRepair): string | null {
  if (isRepairNoCharge(repair)) return 'no-charge or full warranty'
  // An unrepairable job's bill is the diagnosis fee, and Finance decides case
  // by case whether anything else belongs on it. That judgement is made on the
  // repair's own invoice, not inside somebody else's batch.
  if (isUnrepairableRepair(repair)) return 'unrepairable — bill it on its own'
  // The server invoices a repair order without a delivery note only once the
  // workshop has finished with it. Anything earlier would be refused there,
  // after the merged order had already been written.
  if (!isRepairFulfillmentReady(repair.status)) return 'not ready — finish QC first'
  const charges = buildRepairInvoiceCharges(repair)
  const owed = charges.reduce((sum, line) => sum + line.subtotal, 0)
  if (charges.length === 0 || owed < 1) return 'nothing to bill'
  return null
}

export function isConsolidatable(repair: ConsolidatableRepair): boolean {
  return consolidationBlocker(repair) === null
}

export function buildConsolidatedRepairInvoice(
  repairs: ConsolidatableRepair[],
): ConsolidatedInvoiceDraft {
  const lines: ConsolidatedInvoiceLine[] = []
  let subtotal = 0
  let taxTotal = 0
  const rates = new Set<number>()

  for (const repair of repairs ?? []) {
    if (!repair) continue
    const charges = buildRepairInvoiceCharges(repair)
    if (charges.length === 0) continue
    const repairId = String(repair.id ?? '')
    const repairRef = String(repair.ref ?? repair.id ?? '')

    lines.push({
      repairId,
      repairRef,
      lineType: 'section',
      description: repairSectionTitle(repair),
      qty: 0,
      unitPrice: 0,
      taxRate: 0,
      subtotal: 0,
    })
    for (const charge of charges) {
      const taxRate = Math.round((Number(charge.taxRate) || 0) * 100) / 100
      subtotal += charge.subtotal
      taxTotal += Math.round(charge.subtotal * taxRate / 100)
      rates.add(taxRate > 0 ? 1 : 0)
      lines.push({ ...charge, taxRate, repairId, repairRef })
    }
  }

  return {
    lines,
    subtotal,
    taxTotal,
    total: subtotal + taxTotal,
    mixedVat: rates.size > 1,
  }
}

const CLOSED_OUT = new Set(['cancelled', 'declined', 'returned', 'retained', 'closed'])

export type ConsolidationCandidate<T extends ConsolidatableRepair> = {
  repair: T
  /** Why it cannot join the batch, or null when it can. */
  blocker: string | null
}

/**
 * The client's other repairs that could share an invoice with `anchor`.
 *
 * Jobs that are already billed or closed out are left off entirely. Jobs that
 * are unbilled but not yet billable (still on the bench, no charge) are listed
 * with the reason, so the person billing can see why a machine they expected
 * is not selectable instead of wondering where it went.
 */
export function consolidationCandidates<T extends ConsolidatableRepair>(
  repairs: T[],
  anchor: T,
): ConsolidationCandidate<T>[] {
  const client = String(anchor.clientId ?? anchor.customerId ?? '')
  if (!client) return []
  return (repairs ?? [])
    .filter(r => r
      && String(r.clientId ?? r.customerId ?? '') === client
      && !r.invoiceId
      && !CLOSED_OUT.has(String(r.status ?? '').toLowerCase()))
    .map(repair => ({ repair, blocker: consolidationBlocker(repair) }))
    .sort((a, b) => {
      if (a.repair.id === anchor.id) return -1
      if (b.repair.id === anchor.id) return 1
      return Number(a.blocker !== null) - Number(b.blocker !== null)
    })
}
