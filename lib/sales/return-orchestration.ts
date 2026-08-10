/**
 * Pure helpers for the post-DN / post-invoice / post-ORC customer return flow.
 * Keeps DN historical, stamps ORC audit without voiding released certificates,
 * and resolves which posted invoice a credit note should hit when possible.
 */

export interface ReturnStampLine {
  productId: string
  qty: number
  serialIds?: string[]
}

export interface DeliveryStampLine {
  productId: string
  productName?: string
  qty: number
  qtyDone: number
  qtyReturned?: number
  serialIds?: string[]
  sourceLocation?: string
}

export interface DeliveryStampInput {
  id: string
  saleOrderId: string
  status: string
  lines: DeliveryStampLine[]
}

export interface StampedDelivery {
  deliveryId: string
  lines: DeliveryStampLine[]
}

/**
 * Stamp qtyReturned onto done delivery lines for a sale order.
 * Prefer lines that still hold matching serials; otherwise FIFO by remaining
 * returnable capacity (qtyDone − qtyReturned). Never reduces historical qtyDone.
 */
export function stampDeliveryReturnQtys(args: {
  deliveries: DeliveryStampInput[]
  saleOrderId: string
  returnLines: ReturnStampLine[]
}): StampedDelivery[] {
  const remaining = new Map<string, number>()
  for (const line of args.returnLines) {
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    if (qty <= 0 || !line.productId) continue
    remaining.set(line.productId, (remaining.get(line.productId) || 0) + qty)
  }
  if (remaining.size === 0) return []

  const returnSerials = new Set(
    args.returnLines.flatMap(l => (l.serialIds ?? []).map(String)).filter(Boolean),
  )

  const touched = new Map<string, DeliveryStampLine[]>()

  const candidates = args.deliveries
    .filter(d => d.saleOrderId === args.saleOrderId && d.status === 'done')
    .slice()
    // Prefer deliveries that still contain returned serials.
    .sort((a, b) => {
      const aHit = a.lines.some(l => (l.serialIds ?? []).some(s => returnSerials.has(String(s)))) ? 0 : 1
      const bHit = b.lines.some(l => (l.serialIds ?? []).some(s => returnSerials.has(String(s)))) ? 0 : 1
      return aHit - bHit
    })

  for (const delivery of candidates) {
    const nextLines = delivery.lines.map(line => {
      const need = remaining.get(line.productId) || 0
      if (need <= 0) return { ...line, qtyReturned: Math.max(0, Math.floor(Number(line.qtyReturned) || 0)) }

      const shipped = Math.max(0, Math.floor(Number(line.qtyDone) || 0))
      const already = Math.max(0, Math.floor(Number(line.qtyReturned) || 0))
      const capacity = Math.max(0, shipped - already)
      if (capacity <= 0) return { ...line, qtyReturned: already }

      // Prefer consuming capacity on lines that still hold the returned serials.
      const serialMatch = (line.serialIds ?? []).filter(s => returnSerials.has(String(s))).length
      const apply = serialMatch > 0
        ? Math.min(need, capacity, serialMatch)
        : Math.min(need, capacity)
      if (apply <= 0) return { ...line, qtyReturned: already }

      remaining.set(line.productId, need - apply)
      return { ...line, qtyReturned: already + apply }
    })

    const changed = nextLines.some((l, i) =>
      Math.max(0, Math.floor(Number(l.qtyReturned) || 0)) !==
      Math.max(0, Math.floor(Number(delivery.lines[i]?.qtyReturned) || 0)),
    )
    if (changed) touched.set(delivery.id, nextLines)
  }

  return [...touched.entries()].map(([deliveryId, lines]) => ({ deliveryId, lines }))
}

export interface PostedInvoiceCandidate {
  id: string
  ref: string
  lines?: Array<{ productId?: string; qty?: number }> | null
}

export type PickPostedInvoiceResult =
  | { ok: true; invoice: PostedInvoiceCandidate; coverage: number }
  | { ok: false; reason: 'none' | 'ambiguous'; count: number; coverage?: number }

/**
 * Resolve which posted invoice a credit note should hit.
 * Prefer an explicit RMA hint; otherwise unique coverage of returned products.
 */
export function pickPostedInvoiceForReturn(args: {
  invoices: PostedInvoiceCandidate[]
  returnLines: ReturnStampLine[]
  preferredInvoiceId?: string | null
}): PickPostedInvoiceResult {
  const invoices = args.invoices ?? []
  if (invoices.length === 0) return { ok: false, reason: 'none', count: 0 }

  if (args.preferredInvoiceId) {
    const preferred = invoices.find(i => i.id === args.preferredInvoiceId)
    if (preferred) {
      return { ok: true, invoice: preferred, coverage: scoreInvoiceCoverage(preferred, args.returnLines) }
    }
  }

  if (invoices.length === 1) {
    return { ok: true, invoice: invoices[0], coverage: scoreInvoiceCoverage(invoices[0], args.returnLines) }
  }

  const scored = invoices
    .map(inv => ({ invoice: inv, coverage: scoreInvoiceCoverage(inv, args.returnLines) }))
    .sort((a, b) => b.coverage - a.coverage)

  const best = scored[0]
  const second = scored[1]
  if (!best || best.coverage <= 0) {
    return { ok: false, reason: 'ambiguous', count: invoices.length, coverage: 0 }
  }
  if (second && second.coverage === best.coverage) {
    return { ok: false, reason: 'ambiguous', count: invoices.length, coverage: best.coverage }
  }
  return { ok: true, invoice: best.invoice, coverage: best.coverage }
}

function scoreInvoiceCoverage(invoice: PostedInvoiceCandidate, returnLines: ReturnStampLine[]): number {
  const remaining = new Map<string, number>()
  for (const line of invoice.lines ?? []) {
    const pid = String(line.productId || '')
    if (!pid) continue
    remaining.set(pid, (remaining.get(pid) || 0) + Math.max(0, Math.floor(Number(line.qty) || 0)))
  }
  let covered = 0
  for (const ret of returnLines) {
    const need = Math.max(0, Math.floor(Number(ret.qty) || 0))
    if (need <= 0 || !ret.productId) continue
    const have = remaining.get(ret.productId) || 0
    const take = Math.min(need, have)
    covered += take
    remaining.set(ret.productId, have - take)
  }
  return covered
}

export interface OrcStampCandidate {
  id: string
  ref?: string
  status: string
  invoiceId?: string | null
  deliveryNoteId?: string | null
}

export interface OrcPartialReturnTarget {
  releaseId: string
  releaseRef?: string
}

/** Released ORCs tied to stamped DNs or the credited invoice — history only, never void. */
export function findReleasedOrcsForReturn(args: {
  releases: OrcStampCandidate[]
  deliveryIds: string[]
  invoiceIds: string[]
}): OrcPartialReturnTarget[] {
  const dnSet = new Set(args.deliveryIds.filter(Boolean))
  const invSet = new Set(args.invoiceIds.filter(Boolean))
  const out: OrcPartialReturnTarget[] = []
  for (const r of args.releases) {
    if (r.status !== 'released') continue
    const hitDn = r.deliveryNoteId && dnSet.has(r.deliveryNoteId)
    const hitInv = r.invoiceId && invSet.has(r.invoiceId)
    if (!hitDn && !hitInv) continue
    out.push({ releaseId: r.id, releaseRef: r.ref })
  }
  return out
}

/** Default process amount: explicit UI amount → RMA hint → allocation credit. */
export function resolveReturnCreditAmount(args: {
  explicitAmount?: number | null
  creditTotalHint?: number | null
  allocationCreditTotal?: number | null
  fallbackAmount?: number | null
}): number {
  const explicit = Math.max(0, Number(args.explicitAmount) || 0)
  if (explicit > 0) return explicit
  const hint = Math.max(0, Number(args.creditTotalHint) || 0)
  if (hint > 0) return hint
  const alloc = Math.max(0, Number(args.allocationCreditTotal) || 0)
  if (alloc > 0) return alloc
  return Math.max(0, Number(args.fallbackAmount) || 0)
}
