import {
  buildConsolidatedRepairInvoice,
  isConsolidatable,
  repairSectionTitle,
  type ConsolidatableRepair,
} from '@/lib/repair/consolidated-invoice'

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
  lineType?: 'section'
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

export function planRepairConsolidation(opts: {
  repairs: ConsolidatableRepair[]
}): ConsolidationPlan {
  const repairs = (opts.repairs ?? []).filter(Boolean)

  if (repairs.length < 2) {
    return { ok: false, reason: 'Pick at least two repairs to bill together.' }
  }

  // One invoice has one customer. Mixing clients would bill somebody for
  // another customer's device.
  const clientIds = new Set(repairs.map(r => String(r.clientId ?? '')))
  if (clientIds.size !== 1 || clientIds.has('')) {
    return { ok: false, reason: 'All repairs must belong to the same client.' }
  }
  const clientId = repairs[0]!.clientId as string

  const alreadyBilled = repairs.filter(r => r.invoiceId)
  if (alreadyBilled.length > 0) {
    const refs = alreadyBilled.map(r => r.ref ?? r.id).join(', ')
    return { ok: false, reason: `Already invoiced: ${refs}. Remove them from the selection.` }
  }

  const notBillable = repairs.filter(r => !isConsolidatable(r))
  if (notBillable.length > 0) {
    const refs = notBillable.map(r => r.ref ?? r.id).join(', ')
    return { ok: false, reason: `Nothing to bill on: ${refs}.` }
  }

  const draft = buildConsolidatedRepairInvoice(repairs)
  if (draft.lines.length === 0 || draft.total <= 0) {
    return { ok: false, reason: 'The selected repairs have nothing to bill.' }
  }

  const lines: ConsolidationSaleOrderLine[] = []
  let subtotal = 0
  let taxTotal = 0

  for (const repair of repairs) {
    const own = buildConsolidatedRepairInvoice([repair])
    if (own.lines.length === 0) continue

    lines.push({
      productId: '',
      productName: repairSectionTitle(repair),
      description: repairSectionTitle(repair),
      qty: 0,
      unitPrice: 0,
      discount: 0,
      taxRate: 0,
      subtotal: 0,
      serialIds: [],
      lineType: 'section',
    })

    for (const charge of own.lines.filter(l => l.lineType !== 'section')) {
      const lineSubtotal = money(charge.subtotal)
      const lineTax = Math.round(lineSubtotal * (Number(charge.taxRate) || 0) / 100)
      subtotal += lineSubtotal
      taxTotal += lineTax
      lines.push({
        productId: String(charge.productId ?? ''),
        productName: charge.description,
        description: charge.description,
        qty: money(charge.qty),
        unitPrice: money(charge.unitPrice),
        discount: 0,
        // Each line keeps the rate its own repair was quoted at, so a batch may
        // legitimately carry more than one.
        taxRate: Number(charge.taxRate) || 0,
        subtotal: lineSubtotal,
        serialIds: [],
      })
    }
  }

  const repairRefs = repairs.map(r => String(r.ref ?? r.id ?? ''))
  const supersededSaleOrderIds = Array.from(new Set(
    repairs.map(r => String((r as { saleOrderId?: unknown }).saleOrderId ?? '')).filter(Boolean),
  ))

  return {
    ok: true,
    clientId,
    repairIds: repairs.map(r => String(r.id ?? '')),
    repairRefs,
    supersededSaleOrderIds,
    lines,
    subtotal: money(subtotal),
    taxTotal: money(taxTotal),
    total: money(subtotal + taxTotal),
    mixedVat: draft.mixedVat,
    notes: `Consolidated repair billing — ${repairRefs.join(', ')}`,
  }
}
