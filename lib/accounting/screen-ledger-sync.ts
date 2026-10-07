/**
 * Documents and payments that are on the screens (the deed_invoices copy)
 * but never reached the ledger.
 *
 *  - A document missing from the ledger entirely — e.g. a bill imported from
 *    a spreadsheet whose date came in as an Excel serial (46326 = 31 Oct
 *    2026), which the invoice route rejects. It is booked through the normal
 *    invoice route with the date converted.
 *  - A document paid on screen but not in the ledger: each payment listed on
 *    screen that the ledger does not have is booked through the normal
 *    payment route (same id, so it can never be booked twice). A document
 *    with a paid amount but no listed payments cannot be booked blind — it
 *    is shown for manual registration.
 *
 * Pure — screen-ledger-sync.server.ts does the posting.
 */

type Row = Record<string, any>

/**
 * There is no cutover in the data: the ledger holds the full history from
 * June 2026 and no opening-balance entries were ever posted (integrity
 * drill-down, 7 Oct). Older documents and payments are booked like any
 * other; nothing is "carried in opening balances".
 */

const CLOSED = new Set(['draft', 'cancelled', 'canceled', 'voided', 'void'])
const money = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100

/** '2026-10-31', '2026-10-31T…', 46326 or '46326' (Excel serial) → '2026-10-31'; '' if unusable. */
export function normalizeDocDate(value: unknown): { iso: string; fromSerial: boolean } {
  const raw = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return { iso: raw.slice(0, 10), fromSerial: false }
  const n = Number(raw)
  if (Number.isFinite(n) && n >= 20000 && n <= 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000)
    return { iso: d.toISOString().slice(0, 10), fromSerial: true }
  }
  return { iso: '', fromSerial: false }
}

export type MissingDocPlan = {
  id: string
  ref: string
  type: string
  partner: string
  total: number
  date: string
  dueDate: string
  fixedDates: boolean
  /** Why it cannot be booked automatically. */
  problem?: string
}

export function planMissingDocs(screen: Row[], ledgerIds: Set<string>): MissingDocPlan[] {
  return screen
    .filter(r => r?.id && !ledgerIds.has(String(r.id)) && !CLOSED.has(String(r.status ?? '')))
    .map(r => {
      const date = normalizeDocDate(r.date ?? r.invoiceDate)
      const due = normalizeDocDate(r.dueDate)
      const dueIso = due.iso && date.iso && due.iso >= date.iso
        ? due.iso
        : date.iso ? new Date(Date.parse(`${date.iso}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10) : ''
      const total = money(r.total ?? r.totalAmount)
      const problem = !date.iso ? 'No usable date — enter it on the document'
        : !(Math.abs(total) >= 1) ? 'Total is below 1'
        : !r.partnerId ? 'No supplier/customer on the document'
        : undefined
      return {
        id: String(r.id),
        ref: String(r.ref ?? r.invoiceNumber ?? r.id),
        type: String(r.type ?? 'customer_invoice'),
        partner: String(r.partnerName ?? ''),
        total,
        date: date.iso,
        dueDate: dueIso,
        fixedDates: date.fromSerial || due.fromSerial,
        problem,
      }
    })
}

export type UnbookedPaymentPlan = {
  invoiceId: string
  ref: string
  type: string
  screenPaid: number
  ledgerPaid: number
  /** Payments listed on screen that the ledger lacks — booked with their own ids. */
  book: Array<{ id: string; amount: number; date: string; method: string; reference?: string }>
  /** Paid on screen with no payment listed: register by hand. */
  manual: boolean
}

export function planUnbookedPayments(
  screen: Row[],
  ledger: Map<string, { amountPaid: number; paymentIds: Set<string> }>,
): UnbookedPaymentPlan[] {
  const out: UnbookedPaymentPlan[] = []
  for (const r of screen) {
    const l = ledger.get(String(r?.id))
    if (!l || CLOSED.has(String(r.status ?? ''))) continue
    const screenPaid = money(r.amountPaid)
    if (!(screenPaid > l.amountPaid + 0.5)) continue
    let gap = money(screenPaid - l.amountPaid)
    const book: UnbookedPaymentPlan['book'] = []
    for (const p of Array.isArray(r.payments) ? r.payments : []) {
      if (!p?.id || l.paymentIds.has(String(p.id)) || gap <= 0.5) continue
      const paidOn = normalizeDocDate(p.date).iso || normalizeDocDate(r.date).iso
      const amount = Math.min(money(p.amount), gap)
      if (!(amount > 0)) continue
      book.push({
        id: String(p.id),
        amount,
        date: paidOn,
        method: String(p.method || 'cash'),
        reference: p.reference ? String(p.reference) : undefined,
      })
      gap = money(gap - amount)
    }
    out.push({
      invoiceId: String(r.id),
      ref: String(r.ref ?? r.id),
      type: String(r.type ?? 'customer_invoice'),
      screenPaid,
      ledgerPaid: l.amountPaid,
      book,
      manual: book.length === 0,
    })
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref))
}
