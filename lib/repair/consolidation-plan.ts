import {
  buildConsolidatedRepairInvoice,
  consolidationBlocker,
  type ConsolidatableRepair,
} from '@/lib/repair/consolidated-invoice'
import { CONSOLIDATED_REPAIR_NOTES_PREFIX } from '@/lib/repair/sale-order-link'
import { isOfficialRepairRef } from '@/lib/repair-ref'

/**
 * What has to happen to bill several of a client's repairs on one invoice.
 *
 * Repair invoices are raised from the repair's own sale order — one SO becomes
 * one invoice — so a single invoice covering several repairs cannot go through
 * that path as-is. The chosen route is to merge the selected repairs into one
 * sale order and invoice that, which keeps every downstream behaviour intact:
 * revenue recognition, invoiced quantities, and the SO→invoice link all work
 * exactly as they do for a single repair.
 *
 * This decides whether a batch is billable and produces the payload. It runs no
 * IO of its own, because the executor lives in store.tsx, a 21,000-line file
 * carrying `@ts-nocheck` where nothing is type-checked and a mistake is found
 * by a user rather than a compiler. The rules belong somewhere they can be
 * argued with and tested.
 */

export type ConsolidationSaleOrderLine = {
  productId: string
  productName: string
  description: string
  qty: number
  unitPrice: number
  discount: number
  taxRate: number
  subtotal: number
  serialIds: string[]
  lineType?: 'section' | 'service'
  unit?: 'service'
  invoicePolicy?: 'order'
}

export type ConsolidationPlan =
  | { ok: false; reason: string }
  | {
    ok: true
    clientId: string
    /** Repairs the invoice will cover, in the order given. */
    repairIds: string[]
    repairRefs: string[]
    /** Sale orders superseded by the merged one — cancelled, not invoiced. */
    supersededSaleOrderIds: string[]
    lines: ConsolidationSaleOrderLine[]
    subtotal: number
    taxTotal: number
    total: number
    mixedVat: boolean
    notes: string
  }

const money = (n: unknown) => {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
}

const refOf = (r: ConsolidatableRepair) => String(r.ref ?? r.id ?? '')

export function planRepairConsolidation(opts: {
  repairs: ConsolidatableRepair[]
}): ConsolidationPlan {
  const repairs = (opts.repairs ?? []).filter(Boolean)

  if (repairs.length < 2) {
    return { ok: false, reason: 'Pick at least two repairs to bill together.' }
  }

  const ids = repairs.map(r => String(r.id ?? ''))
  if (new Set(ids).size !== ids.length) {
    return { ok: false, reason: 'The same repair is selected twice.' }
  }

  // One invoice has one customer. Mixing clients would bill somebody for
  // another customer's device.
  const clientOf = (r: ConsolidatableRepair) => String(r.clientId ?? r.customerId ?? '')
  const clientIds = new Set(repairs.map(clientOf))
  if (clientIds.size !== 1 || clientIds.has('')) {
    return { ok: false, reason: 'All repairs must belong to the same client.' }
  }
  const clientId = clientOf(repairs[0]!)

  // The server finds a merged order's repairs by the ticket numbers in its
  // notes. A repair without one would be billed on the invoice yet never linked
  // to it, and would go on showing as unbilled.
  const unreferenced = repairs.filter(r => !isOfficialRepairRef(r.ref))
  if (unreferenced.length > 0) {
    return { ok: false, reason: `No ticket number on: ${unreferenced.map(refOf).join(', ')}. Bill these on their own.` }
  }

  const alreadyBilled = repairs.filter(r => r.invoiceId)
  if (alreadyBilled.length > 0) {
    return { ok: false, reason: `Already invoiced: ${alreadyBilled.map(refOf).join(', ')}. Remove them from the selection.` }
  }

  const blocked = repairs
    .map(r => ({ ref: refOf(r), why: consolidationBlocker(r) }))
    .filter(b => b.why !== null)
  if (blocked.length > 0) {
    const nothing = blocked.filter(b => b.why === 'nothing to bill')
    if (nothing.length === blocked.length) {
      return { ok: false, reason: `Nothing to bill on: ${nothing.map(b => b.ref).join(', ')}.` }
    }
    return { ok: false, reason: `Cannot bill together: ${blocked.map(b => `${b.ref} (${b.why})`).join('; ')}.` }
  }

  const draft = buildConsolidatedRepairInvoice(repairs)
  if (draft.lines.length === 0 || draft.total <= 0) {
    return { ok: false, reason: 'The selected repairs have nothing to bill.' }
  }

  const lines: ConsolidationSaleOrderLine[] = []
  let subtotal = 0
  let taxTotal = 0

  for (const line of draft.lines) {
    if (line.lineType === 'section') {
      lines.push({
        productId: '',
        productName: line.description,
        description: line.description,
        qty: 0,
        unitPrice: 0,
        discount: 0,
        taxRate: 0,
        subtotal: 0,
        serialIds: [],
        lineType: 'section',
      })
      continue
    }
    const lineSubtotal = money(line.subtotal)
    subtotal += lineSubtotal
    taxTotal += Math.round(lineSubtotal * line.taxRate / 100)
    const productId = String(line.productId ?? '').trim()
    // Section headings live on the sale order but the invoice bills only lines
    // with a quantity, so they do not survive onto it. Each charge names its
    // own repair so the customer can still tell which machine it was for.
    const description = `${line.repairRef} · ${line.description}`
    lines.push({
      productId,
      productName: description,
      description,
      qty: money(line.qty),
      unitPrice: money(line.unitPrice),
      discount: 0,
      // Each line keeps the rate its own repair was quoted at, so a batch may
      // legitimately carry more than one.
      taxRate: line.taxRate,
      subtotal: lineSubtotal,
      serialIds: [],
      // Same rule as a single repair's order (saleLineFieldsForRepairQuoteLine):
      // a charge with no catalogue product is a service and must not wait on
      // a delivery note that can never exist.
      ...(productId ? {} : { unit: 'service' as const, invoicePolicy: 'order' as const, lineType: 'service' as const }),
    })
  }

  const repairRefs = repairs.map(refOf)
  const supersededSaleOrderIds = Array.from(new Set(
    repairs.map(r => String(r.saleOrderId ?? '')).filter(Boolean),
  ))

  return {
    ok: true,
    clientId,
    repairIds: ids,
    repairRefs,
    supersededSaleOrderIds,
    lines,
    subtotal: money(subtotal),
    taxTotal: money(taxTotal),
    total: money(subtotal + taxTotal),
    mixedVat: draft.mixedVat,
    notes: `${CONSOLIDATED_REPAIR_NOTES_PREFIX}${repairRefs.join(', ')}`,
  }
}

type SupersededOrder = { id: string; ref?: string | null; status?: string | null }
type OrderInvoice = { saleOrderId?: string | null; status?: string | null; ref?: string | null }
type OrderDelivery = { saleOrderId?: string | null; status?: string | null }

/**
 * Why the repairs' own sale orders cannot be retired, checked before anything
 * is written.
 *
 * The merged order bills the work, so each repair's own order is cancelled.
 * An order that already carries a live invoice or a completed delivery cannot
 * simply be cancelled — and finding that out after the merged order had been
 * invoiced would leave the customer billed twice for the same repair.
 */
export function supersededOrderBlockers(input: {
  orders: SupersededOrder[]
  invoices: OrderInvoice[]
  deliveries: OrderDelivery[]
}): string[] {
  const blockers: string[] = []
  for (const order of input.orders) {
    const label = order.ref || order.id
    if (String(order.status ?? '').toLowerCase() === 'cancelled') continue
    const live = input.invoices.filter(inv =>
      inv.saleOrderId === order.id && !['cancelled', 'voided'].includes(String(inv.status ?? '').toLowerCase()))
    if (live.length > 0) {
      blockers.push(`${label} already has ${live.map(inv => inv.ref || 'an invoice').join(', ')}`)
      continue
    }
    const done = input.deliveries.filter(d =>
      d.saleOrderId === order.id && String(d.status ?? '').toLowerCase() === 'done')
    if (done.length > 0) blockers.push(`${label} has a completed delivery — return the stock first`)
  }
  return blockers
}
