// Server-side authoritative money math for invoices.
//
// The UI syncs invoice documents with client-computed totals. Any endpoint that
// persists an invoice to the Prisma ledger must NOT trust those totals — a
// tampered client could post an invoice whose header total does not match its
// line items. These helpers recompute the money from the line items so the
// stored figures always tie back to qty × unitPrice (+ tax − discount).

export interface RawInvoiceLine {
  qty?: number | string
  unitPrice?: number | string
  taxRate?: number | string
  subtotal?: number | string
  lineSubtotal?: number | string
}

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
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
 * - `subtotal` is always the sum of qty × unitPrice across lines.
 * - `taxAmount` is derived from per-line tax rates when any line carries one;
 *   otherwise it falls back to the caller-supplied header tax (used by POS and
 *   repair invoices that apply VAT at the document level with zero-rate lines).
 * - `totalAmount` is subtotal + tax − discount, never negative.
 *
 * Client-supplied `subtotal` / `totalAmount` are intentionally ignored.
 */
export function computeInvoiceTotals(
  lines: RawInvoiceLine[],
  opts: { headerTax?: number | string; discount?: number | string } = {},
): ComputedInvoiceTotals {
  const safeLines = Array.isArray(lines) ? lines : []

  const subtotal = round2(
    safeLines.reduce((sum, l) => {
      const qty = num(l.qty ?? 1)
      const unitPrice = num(l.unitPrice)
      // Prefer explicit line subtotal only when qty/unitPrice are absent.
      const explicit = num(l.lineSubtotal ?? l.subtotal)
      const lineBase = unitPrice !== 0 || qty !== 0 ? qty * unitPrice : explicit
      return sum + lineBase
    }, 0),
  )

  const taxFromLines = round2(
    safeLines.reduce((sum, l) => {
      const qty = num(l.qty ?? 1)
      const unitPrice = num(l.unitPrice)
      const rate = num(l.taxRate)
      if (rate <= 0) return sum
      return sum + (qty * unitPrice * rate) / 100
    }, 0),
  )

  const taxAmount = taxFromLines > 0 ? taxFromLines : Math.max(0, round2(num(opts.headerTax)))
  const discountAmount = Math.max(0, round2(num(opts.discount)))
  const totalAmount = Math.max(0, round2(subtotal + taxAmount - discountAmount))

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
  subtotal: number
  productId?: string
}

/**
 * Map Prisma InvoiceItem rows to client-store lines.
 * Uses pretax `lineSubtotal` — never tax-inclusive `lineTotal` as UI subtotal.
 */
export function mapDbInvoiceItemsToClientLines(
  items: Array<{
    id?: string
    description?: string | null
    qty?: unknown
    unitPrice?: unknown
    taxRate?: unknown
    lineSubtotal?: unknown
    productId?: string | null
  }> | null | undefined,
): ClientInvoiceLine[] {
  return (items ?? []).map((item, idx) => {
    const qty = num(item.qty)
    const unitPrice = num(item.unitPrice)
    const explicit = item.lineSubtotal != null ? num(item.lineSubtotal) : null
    return {
      id: item.id ?? `line-${idx}`,
      description: item.description ?? '',
      qty,
      unitPrice,
      taxRate: num(item.taxRate),
      subtotal: explicit != null ? explicit : round2(qty * unitPrice),
      ...(item.productId ? { productId: item.productId } : {}),
    }
  })
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
