// Server-side authoritative money math for invoices.
//
// The UI syncs invoice documents with client-computed totals. Any endpoint that
// persists an invoice to the Prisma ledger must NOT trust those totals — a
// tampered client could post an invoice whose header total does not match its
// line items. These helpers recompute the money from the line items so the
// stored figures always tie back to qty × unitPrice (− line discount + tax).

export interface RawInvoiceLine {
  qty?: number | string
  unitPrice?: number | string
  taxRate?: number | string
  /** Per-line discount percent (0–100). Alias: `discount`. */
  discountPct?: number | string
  discount?: number | string
  subtotal?: number | string
  lineSubtotal?: number | string
}

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export interface ComputedInvoiceLineMoney {
  qty: number
  unitPrice: number
  taxRate: number
  discountPct: number
  gross: number
  discountAmount: number
  lineSubtotal: number
  lineTax: number
  lineTotal: number
}

/**
 * Per-line money: discount % off gross, then tax on the discounted net.
 * Mirrors quotation line math (Disc% → net → VAT).
 */
export function computeInvoiceLineMoney(line: RawInvoiceLine): ComputedInvoiceLineMoney {
  const qty = num(line.qty ?? 1)
  const unitPrice = num(line.unitPrice)
  const taxRate = Math.max(0, num(line.taxRate))
  const discountPct = Math.min(100, Math.max(0, num(line.discountPct ?? line.discount)))
  const hasQtyPrice = unitPrice !== 0 || qty !== 0
  const gross = hasQtyPrice
    ? round2(qty * unitPrice)
    : round2(num(line.lineSubtotal ?? line.subtotal))
  const discountAmount = round2((gross * discountPct) / 100)
  const lineSubtotal = round2(Math.max(0, gross - discountAmount))
  const lineTax = round2((lineSubtotal * taxRate) / 100)
  const lineTotal = round2(lineSubtotal + lineTax)
  return { qty, unitPrice, taxRate, discountPct, gross, discountAmount, lineSubtotal, lineTax, lineTotal }
}

export interface ComputedInvoiceTotals {
  subtotal: number
  taxAmount: number
  discountAmount: number
  totalAmount: number
}

/**
 * Recompute invoice totals from line items.
 *
 * - With line `discountPct`: subtotal is net after discount; tax is on the net;
 *   header `opts.discount` is ignored (line discounts are authoritative).
 * - Without line discounts: subtotal is qty × unitPrice (gross); optional header
 *   `opts.discount` is subtracted from the total (legacy POS/repair pattern).
 * - Client-supplied header `subtotal` / `totalAmount` are intentionally ignored.
 */
export function computeInvoiceTotals(
  lines: RawInvoiceLine[],
  opts: { headerTax?: number | string; discount?: number | string } = {},
): ComputedInvoiceTotals {
  const safeLines = Array.isArray(lines) ? lines : []
  const money = safeLines.map(computeInvoiceLineMoney)
  const hasLineDiscount = money.some(l => l.discountPct > 0)

  const subtotal = round2(money.reduce((sum, l) => sum + l.lineSubtotal, 0))
  const lineDiscountTotal = round2(money.reduce((sum, l) => sum + l.discountAmount, 0))

  const taxFromLines = round2(money.reduce((sum, l) => sum + l.lineTax, 0))
  const taxAmount = taxFromLines > 0 ? taxFromLines : Math.max(0, round2(num(opts.headerTax)))

  const headerDiscount = hasLineDiscount ? 0 : Math.max(0, round2(num(opts.discount)))
  const discountAmount = round2(lineDiscountTotal + headerDiscount)
  const totalAmount = Math.max(0, round2(subtotal + taxAmount - headerDiscount))

  return { subtotal, taxAmount, discountAmount, totalAmount }
}

/**
 * Clamp a client-supplied amountPaid into the valid [0, totalAmount] range.
 * Used only on invoice creation (e.g. already-paid POS/repair invoices);
 * subsequent payments must go through the dedicated payments endpoint.
 */
export function clampAmountPaid(amountPaid: unknown, totalAmount: number): number {
  return Math.min(Math.max(0, round2(num(amountPaid))), totalAmount)
}

/** Client-store invoice line shape (deed_invoices). */
export interface ClientInvoiceLine {
  id: string
  description: string
  qty: number
  unitPrice: number
  taxRate: number
  discountPct?: number
  subtotal: number
  productId?: string
  lineType?: 'item' | 'section'
}

/**
 * Map Prisma InvoiceItem rows to client-store lines.
 * Uses pretax `lineSubtotal` — never tax-inclusive `lineTotal` as UI subtotal.
 * Zero-qty / zero-price rows without a product are treated as section headings.
 */
export function mapDbInvoiceItemsToClientLines(
  items: Array<{
    id?: string
    description?: string | null
    qty?: unknown
    unitPrice?: unknown
    taxRate?: unknown
    discountPct?: unknown
    lineSubtotal?: unknown
    productId?: string | null
    sortOrder?: unknown
  }> | null | undefined,
): ClientInvoiceLine[] {
  const ordered = [...(items ?? [])].sort((a, b) => num(a.sortOrder) - num(b.sortOrder))
  return ordered.map((item, idx) => {
    const qty = num(item.qty)
    const unitPrice = num(item.unitPrice)
    const discountPct = Math.min(100, Math.max(0, num(item.discountPct)))
    const isSection = !item.productId && qty === 0 && unitPrice === 0
    if (isSection) {
      return {
        id: item.id ?? `line-${idx}`,
        lineType: 'section',
        description: item.description ?? '',
        qty: 0,
        unitPrice: 0,
        taxRate: 0,
        subtotal: 0,
      }
    }
    const explicit = item.lineSubtotal != null ? num(item.lineSubtotal) : null
    const fallback = computeInvoiceLineMoney({ qty, unitPrice, discountPct, taxRate: num(item.taxRate) })
    return {
      id: item.id ?? `line-${idx}`,
      lineType: 'item',
      description: item.description ?? '',
      qty,
      unitPrice,
      taxRate: num(item.taxRate),
      ...(discountPct > 0 ? { discountPct } : {}),
      subtotal: explicit != null ? explicit : fallback.lineSubtotal,
      ...(item.productId ? { productId: item.productId } : {}),
    }
  })
}

/**
 * Fields that make up the financial substance of a posted invoice. Once an
 * invoice's stored status is 'posted', none of these may change via a sync
 * write — corrections must go through a credit note, reversal, or the
 * cancellation transition, never a silent field edit.
 */
const POSTED_INVOICE_PROTECTED_FIELDS = [
  'lines', 'subtotal', 'taxTotal', 'total', 'date', 'dueDate',
  'partnerId', 'partnerName', 'currencyCode', 'exchangeRateToBase',
  'type', 'ref',
] as const

/** Status transitions a posted invoice may still make (nothing else). */
const ALLOWED_POSTED_STATUS_TRANSITIONS = new Set(['posted', 'cancelled'])

export interface RejectedPostedInvoiceEdit {
  id: string
  ref?: string
  fields: string[]
}

function fieldsDiffer(a: unknown, b: unknown): boolean {
  // Line arrays and scalars alike — JSON comparison is sufficient here since
  // both sides originate from the same JSON-serialisable store payloads.
  return JSON.stringify(a) !== JSON.stringify(b)
}

/**
 * Reject mutations to a posted invoice's financial substance arriving via any
 * whole-array sync write (POST /api/store, PUT /api/store/[key]). Draft
 * invoices, and non-protected fields on posted invoices (amountPaid,
 * paymentBlocked, notes, postedBy*, status→cancelled), pass through
 * unchanged. When a protected field differs, every protected field on that
 * invoice is restored to the currently-stored value — the invoice is not
 * dropped from the batch, only its protected fields are pinned — and the
 * invoice id/ref plus the attempted field names are reported in `rejected`
 * so the caller can write an audit entry.
 */
export function enforcePostedInvoiceImmutability(
  current: unknown,
  incoming: unknown,
): { merged: unknown; rejected: RejectedPostedInvoiceEdit[] } {
  if (!Array.isArray(incoming)) return { merged: incoming, rejected: [] }
  if (!Array.isArray(current)) return { merged: incoming, rejected: [] }

  const currentById = new Map<string, Record<string, unknown>>()
  for (const row of current) {
    if (row && typeof row === 'object' && (row as { id?: unknown }).id != null) {
      currentById.set(String((row as { id: unknown }).id), row as Record<string, unknown>)
    }
  }

  const rejected: RejectedPostedInvoiceEdit[] = []
  const merged = incoming.map((row: unknown) => {
    if (!row || typeof row !== 'object' || (row as { id?: unknown }).id == null) return row
    const next = row as Record<string, unknown>
    const prev = currentById.get(String(next.id))
    // No stored counterpart (new invoice) or stored copy is not posted — fully editable.
    if (!prev || prev.status !== 'posted') return row

    const incomingStatus = typeof next.status === 'string' ? next.status : prev.status
    const statusChangeAllowed = ALLOWED_POSTED_STATUS_TRANSITIONS.has(incomingStatus)

    const changedFields = POSTED_INVOICE_PROTECTED_FIELDS.filter(field => fieldsDiffer(prev[field], next[field]))
    if (changedFields.length === 0 && statusChangeAllowed) return row

    if (changedFields.length > 0 || !statusChangeAllowed) {
      const restored: Record<string, unknown> = { ...next }
      for (const field of POSTED_INVOICE_PROTECTED_FIELDS) restored[field] = prev[field]
      if (!statusChangeAllowed) restored.status = prev.status
      rejected.push({
        id: String(next.id),
        ref: typeof prev.ref === 'string' ? prev.ref : undefined,
        fields: [...changedFields, ...(!statusChangeAllowed ? ['status'] : [])],
      })
      return restored
    }
    return row
  })

  return { merged, rejected }
}

/**
 * When syncing deed_invoices, refuse to wipe non-empty line items with [].
 * Protects the server mirror if a client briefly holds an empty-line shell
 * (e.g. after SO→invoice when the API response omitted lines).
 */
export function preserveInvoiceLinesOnStoreWrite(current: unknown, incoming: unknown): unknown {
  if (!Array.isArray(current) || !Array.isArray(incoming)) return incoming

  const currentById = new Map<string, Record<string, unknown>>()
  for (const row of current) {
    if (row && typeof row === 'object' && (row as { id?: unknown }).id != null) {
      currentById.set(String((row as { id: unknown }).id), row as Record<string, unknown>)
    }
  }

  return incoming.map((row: unknown) => {
    if (!row || typeof row !== 'object' || (row as { id?: unknown }).id == null) return row
    const next = row as Record<string, unknown>
    const prev = currentById.get(String(next.id))
    if (!prev) return row

    const incomingLines = Array.isArray(next.lines) ? next.lines : []
    const prevLines = Array.isArray(prev.lines) ? prev.lines : []
    if (incomingLines.length === 0 && prevLines.length > 0) {
      return {
        ...next,
        lines: prevLines,
        subtotal: prev.subtotal ?? next.subtotal,
        taxTotal: prev.taxTotal ?? next.taxTotal,
        total: prev.total ?? next.total,
      }
    }
    return row
  })
}

/**
 * Map Prisma DocumentStatus → client InvoiceStatus.
 * Payment progress is never stored on the client row.
 */
export function mapDbInvoiceStatusToClient(status: unknown): 'draft' | 'posted' | 'cancelled' {
  const s = String(status ?? '')
  if (s === 'draft' || s === 'pending_approval' || s === 'rejected') return 'draft'
  if (s === 'cancelled' || s === 'voided' || s === 'void') return 'cancelled'
  return 'posted'
}

export function invoiceTypeFromRef(ref: string | null | undefined): 'customer_invoice' | 'vendor_bill' {
  const value = String(ref ?? '').toUpperCase()
  if (value.startsWith('BILL') || value.startsWith('DRAFT/BILL')) return 'vendor_bill'
  return 'customer_invoice'
}

function isoDateOnly(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  const raw = String(value ?? '')
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}

/** Prisma invoice (+ items + client) → deed_invoices client row. */
export function mapDbInvoiceToClientStore(invoice: {
  id: string
  invoiceNumber: string
  status: unknown
  clientId: string
  client?: { name?: string | null } | null
  invoiceDate?: unknown
  dueDate?: unknown
  subtotal?: unknown
  taxAmount?: unknown
  totalAmount?: unknown
  amountPaid?: unknown
  saleOrderId?: string | null
  repairId?: string | null
  quoteId?: string | null
  notes?: string | null
  invoiceAddress?: string | null
  deliveryAddress?: string | null
  paymentBlocked?: boolean | null
  currencyCode?: string | null
  baseCurrencyCode?: string | null
  exchangeRateToBase?: unknown
  approvedById?: string | null
  approvedAt?: unknown
  items?: Parameters<typeof mapDbInvoiceItemsToClientLines>[0]
}): Record<string, unknown> {
  const ref = invoice.invoiceNumber
  const total = num(invoice.totalAmount)
  const row: Record<string, unknown> = {
    id: invoice.id,
    ref,
    type: invoiceTypeFromRef(ref),
    status: mapDbInvoiceStatusToClient(invoice.status),
    partnerId: invoice.clientId,
    partnerName: invoice.client?.name ?? '',
    date: isoDateOnly(invoice.invoiceDate),
    dueDate: isoDateOnly(invoice.dueDate ?? invoice.invoiceDate),
    lines: mapDbInvoiceItemsToClientLines(invoice.items),
    subtotal: num(invoice.subtotal),
    taxTotal: num(invoice.taxAmount),
    total,
    amountPaid: clampAmountPaid(invoice.amountPaid, total),
    notes: invoice.notes ?? '',
  }
  if (invoice.saleOrderId) row.saleOrderId = invoice.saleOrderId
  if (invoice.repairId) row.repairId = invoice.repairId
  if (invoice.quoteId) row.quoteId = invoice.quoteId
  if (invoice.invoiceAddress) row.invoiceAddress = invoice.invoiceAddress
  if (invoice.deliveryAddress) row.deliveryAddress = invoice.deliveryAddress
  if (invoice.paymentBlocked) row.paymentBlocked = true
  if (invoice.currencyCode) row.currencyCode = invoice.currencyCode
  if (invoice.baseCurrencyCode) row.baseCurrencyCode = invoice.baseCurrencyCode
  if (invoice.exchangeRateToBase != null) row.exchangeRateToBase = num(invoice.exchangeRateToBase)
  if (invoice.approvedById) row.postedByUserId = invoice.approvedById
  if (invoice.approvedAt) row.postedAt = isoDateOnly(invoice.approvedAt)
  return row
}

/**
 * Stale full-access clients must not drop non-draft invoices that already exist
 * on the server. Draft removals still pass (deleteInvoice strips drafts locally).
 * Posted/cancelled rows missing from the write are appended back.
 */
export function preserveMissingInvoicesOnStoreWrite(current: unknown, incoming: unknown): unknown {
  if (!Array.isArray(current) || !Array.isArray(incoming)) return incoming

  const incomingIds = new Set<string>()
  for (const row of incoming) {
    if (row && typeof row === 'object' && (row as { id?: unknown }).id != null) {
      incomingIds.add(String((row as { id: unknown }).id))
    }
  }

  const restored: unknown[] = []
  for (const row of current) {
    if (!row || typeof row !== 'object' || (row as { id?: unknown }).id == null) continue
    const id = String((row as { id: unknown }).id)
    if (incomingIds.has(id)) continue
    const status = String((row as { status?: unknown }).status ?? '')
    if (status === 'draft') continue
    restored.push(row)
  }

  if (restored.length === 0) return incoming
  return [...incoming, ...restored]
}

/**
 * Merge Prisma invoices into a deed_invoices array by id.
 * Existing blob rows win for identity fields (keeps vendor-only keys like
 * purchaseOrderId); amountPaid is refreshed from Prisma when present.
 */
export function mergePrismaInvoicesIntoBlob(
  currentBlob: unknown,
  prismaInvoices: Array<Parameters<typeof mapDbInvoiceToClientStore>[0]>,
): { merged: Record<string, unknown>[]; added: number; refreshedPaid: number } {
  const blob: Record<string, unknown>[] = Array.isArray(currentBlob)
    ? currentBlob.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : []
  const byId = new Map<string, Record<string, unknown>>()
  for (const row of blob) {
    if (row.id != null) byId.set(String(row.id), { ...row })
  }

  let added = 0
  let refreshedPaid = 0
  for (const inv of prismaInvoices) {
    const mapped = mapDbInvoiceToClientStore(inv)
    const id = String(mapped.id)
    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, mapped)
      added += 1
      continue
    }
    const nextPaid = num(mapped.amountPaid)
    if (num(existing.amountPaid) !== nextPaid) {
      existing.amountPaid = nextPaid
      refreshedPaid += 1
    }
    // Prefer Prisma status when blob is missing a terminal state.
    if (mapped.status === 'cancelled' && existing.status !== 'cancelled') {
      existing.status = 'cancelled'
    }
  }

  return { merged: [...byId.values()], added, refreshedPaid }
}
