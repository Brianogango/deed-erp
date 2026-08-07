// Server-side authoritative money math for sale orders (quotations + confirmed
// orders). Mirrors lib/finance-invoice.ts's approach: a tampered or buggy
// client can submit a header total that does not tie back to its line items,
// so any endpoint that persists a sale order must recompute subtotal / tax /
// total from the lines themselves rather than trusting client-declared totals.
//
// This module has no server-only dependency so it can also be imported from
// client components that need the exact same preview math (avoiding drift
// between what the UI shows while drafting a quotation and what the server
// actually persists).

export interface RawSaleOrderLine {
  lineType?: string
  qty?: number | string
  unitPrice?: number | string
  taxRate?: number | string
  /** Per-line discount percent (0-100). Alias: discountPercent. */
  discount?: number | string
  discountPercent?: number | string
}

const round0 = (n: number) => Math.round(Number.isFinite(n) ? n : 0)
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export interface ComputedSaleOrderLineMoney {
  qty: number
  unitPrice: number
  taxRate: number
  discountPct: number
  /** Net of line discount, pre-tax. */
  lineTotal: number
  lineTax: number
}

/** Section headings and blank lines always carry zero money. */
export function calcSaleOrderLineMoney(line: RawSaleOrderLine): ComputedSaleOrderLineMoney {
  if (line?.lineType === 'section') {
    return { qty: 0, unitPrice: 0, taxRate: 0, discountPct: 0, lineTotal: 0, lineTax: 0 }
  }
  const qty = Math.max(0, num(line?.qty))
  const unitPrice = Math.max(0, num(line?.unitPrice))
  const taxRate = Math.max(0, num(line?.taxRate))
  const discountPct = Math.min(100, Math.max(0, num(line?.discount ?? line?.discountPercent)))
  const lineTotal = round0(qty * unitPrice * (1 - discountPct / 100))
  const lineTax = round0((lineTotal * taxRate) / 100)
  return { qty, unitPrice, taxRate, discountPct, lineTotal, lineTax }
}

export interface ComputedSaleOrderTotals {
  subtotal: number
  taxAmount: number
  discountAmount: number
  totalAmount: number
}

/**
 * Recompute sale-order header totals from line items plus an optional header
 * discount amount (a manual markdown a sales rep applies on top of the lines,
 * subject to the discount-approval workflow — this is a legitimate lever, not
 * tampering, so it is accepted as an input rather than derived).
 */
export function calcSaleOrderTotals(
  lines: RawSaleOrderLine[],
  opts: { headerDiscount?: number | string } = {},
): ComputedSaleOrderTotals {
  const safeLines = Array.isArray(lines) ? lines : []
  const money = safeLines.map(calcSaleOrderLineMoney)
  const subtotal = round0(money.reduce((sum, l) => sum + l.lineTotal, 0))
  const taxAmount = round0(money.reduce((sum, l) => sum + l.lineTax, 0))
  const headerDiscount = Math.max(0, Math.min(subtotal + taxAmount, round0(num(opts.headerDiscount))))
  const totalAmount = Math.max(0, subtotal + taxAmount - headerDiscount)
  return { subtotal, taxAmount, discountAmount: headerDiscount, totalAmount }
}

/** Prisma SaleOrderItem shape (lineTotal is already net of any line discount). */
export interface PersistedSaleOrderLine {
  lineTotal?: number | string
  taxRate?: number | string
}

/**
 * Recompute header totals from already-persisted lines (their lineTotal is
 * net of discount already, so discountPct is treated as 0 here) plus a new
 * header discount. Used when a request changes the header discount without
 * resubmitting line items.
 */
export function calcSaleOrderTotalsFromPersistedLines(
  lines: PersistedSaleOrderLine[],
  headerDiscount: number | string,
): ComputedSaleOrderTotals {
  const safeLines = Array.isArray(lines) ? lines : []
  const subtotal = round0(safeLines.reduce((sum, l) => sum + num(l.lineTotal), 0))
  const taxAmount = round0(
    safeLines.reduce((sum, l) => sum + round0((num(l.lineTotal) * num(l.taxRate)) / 100), 0),
  )
  const discountAmount = Math.max(0, Math.min(subtotal + taxAmount, round0(num(headerDiscount))))
  const totalAmount = Math.max(0, subtotal + taxAmount - discountAmount)
  return { subtotal, taxAmount, discountAmount, totalAmount }
}
