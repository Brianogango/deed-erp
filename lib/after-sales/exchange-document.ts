/**
 * What an exchange swapped, as its invoice and printed note show it: the
 * machines the customer handed back and the ones given, each with its serial
 * and value.
 *
 * The invoice itself keeps one line for the balance (invoice lines cannot be
 * negative), so the "given / returned" rows are built here from the exchange
 * record. They add up to that balance, so the amounts on the document never
 * change — this works the same for invoices raised before it existed.
 */

export const EXCHANGE_REF_RE = /\bEXC\/\d{4}\/\d+\b/

export interface ExchangeLineSource {
  productId?: string
  productName: string
  qty: number
  serialIds?: string[]
  unitPrice: number
}

export interface ExchangeSourceRecord {
  id: string
  ref: string
  customerName?: string
  originalSORef?: string
  status?: string
  date?: string
  completedDate?: string
  returnLines?: ExchangeLineSource[]
  newLines?: ExchangeLineSource[]
  returnTotal?: number
  newTotal?: number
  priceDiff?: number
}

export interface ExchangeSerialSource {
  id: string
  serial?: string
  specs?: string
  unitName?: string
}

export interface ExchangeMachine {
  productName: string
  specs?: string
  serial?: string
  qty: number
  /** Value of this row (qty × unit price), always positive. */
  amount: number
}

export interface ExchangeRow {
  kind: 'given' | 'returned'
  description: string
  serial?: string
  qty: number
  /** Negative for a machine handed back. */
  unitPrice: number
  subtotal: number
}

export interface ExchangeDocumentView {
  ref: string
  originalSORef?: string
  date?: string
  returned: ExchangeMachine[]
  given: ExchangeMachine[]
  returnedTotal: number
  givenTotal: number
  /** givenTotal − returnedTotal: positive = the customer pays, negative = owed to them. */
  balance: number
  rows: ExchangeRow[]
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/** The exchange an invoice was raised for (EXC/… in its lines or notes), or null. */
export function exchangeRefOf(doc: { notes?: string | null; lines?: Array<{ description?: string | null }> | null }): string | null {
  for (const l of doc.lines ?? []) {
    const m = EXCHANGE_REF_RE.exec(String(l?.description ?? ''))
    if (m && /^\s*Exchange\b/i.test(String(l?.description ?? ''))) return m[0]
  }
  const fromNotes = /from exchange\s+(EXC\/\d{4}\/\d+)/i.exec(String(doc.notes ?? ''))
  return fromNotes ? fromNotes[1] : null
}

/** A serialised line becomes one machine per serial; a bulk line stays one row. */
function machines(lines: ExchangeLineSource[] | undefined, serialById: Map<string, ExchangeSerialSource>): ExchangeMachine[] {
  const out: ExchangeMachine[] = []
  for (const l of lines ?? []) {
    const price = Math.abs(Number(l.unitPrice) || 0)
    const ids = (l.serialIds ?? []).filter(Boolean)
    if (ids.length) {
      for (const id of ids) {
        const s = serialById.get(id)
        out.push({
          productName: s?.unitName || l.productName,
          specs: s?.specs || undefined,
          serial: s?.serial || undefined,
          qty: 1,
          amount: round2(price),
        })
      }
      const rest = Math.max(0, (Number(l.qty) || 0) - ids.length)
      if (rest) out.push({ productName: l.productName, qty: rest, amount: round2(rest * price) })
    } else {
      const qty = Math.max(1, Number(l.qty) || 1)
      out.push({ productName: l.productName, qty, amount: round2(qty * price) })
    }
  }
  return out
}

function rowDescription(kind: 'given' | 'returned', m: ExchangeMachine): string {
  const name = m.specs && !m.productName.includes(m.specs) ? `${m.productName} — ${m.specs}` : m.productName
  return `${kind === 'given' ? 'Given' : 'Returned'}: ${name}`
}

/** Both sides of an exchange, and the ± rows that add up to its balance. */
export function exchangeDocumentView(exc: ExchangeSourceRecord, serials: ExchangeSerialSource[]): ExchangeDocumentView {
  const serialById = new Map(serials.map(s => [s.id, s]))
  const given = machines(exc.newLines, serialById)
  const returned = machines(exc.returnLines, serialById)
  const givenTotal = round2(given.reduce((t, m) => t + m.amount, 0))
  const returnedTotal = round2(returned.reduce((t, m) => t + m.amount, 0))
  const rows: ExchangeRow[] = [
    ...given.map(m => ({
      kind: 'given' as const, description: rowDescription('given', m), serial: m.serial,
      qty: m.qty, unitPrice: round2(m.amount / m.qty), subtotal: m.amount,
    })),
    ...returned.map(m => ({
      kind: 'returned' as const, description: rowDescription('returned', m), serial: m.serial,
      qty: m.qty, unitPrice: -round2(m.amount / m.qty), subtotal: -m.amount,
    })),
  ]
  return {
    ref: exc.ref,
    originalSORef: exc.originalSORef || undefined,
    date: exc.completedDate || exc.date,
    returned, given, returnedTotal, givenTotal,
    balance: round2(givenTotal - returnedTotal),
    rows,
  }
}

/**
 * The exchange view for an invoice, or null when it was not raised for one.
 * `replacesLines` is true when the invoice is still the single balance line
 * and the ± rows add up to it — only then do they stand in for it; otherwise
 * (an edited invoice) the stored lines stay and only the summary is shown.
 */
export function invoiceExchangeView(
  inv: { notes?: string | null; subtotal?: number; total?: number; lines?: Array<{ description?: string | null; lineType?: string }> | null },
  exchanges: ExchangeSourceRecord[],
  serials: ExchangeSerialSource[],
): (ExchangeDocumentView & { replacesLines: boolean }) | null {
  const ref = exchangeRefOf(inv)
  if (!ref) return null
  const exc = exchanges.find(e => e?.ref === ref)
  if (!exc) return null
  const view = exchangeDocumentView(exc, serials)
  const itemLines = (inv.lines ?? []).filter(l => l.lineType !== 'section')
  const amount = Number(inv.subtotal ?? inv.total) || 0
  const replacesLines = itemLines.length === 1
    && view.rows.length > 0
    && Math.abs(view.balance - amount) < 0.01
  return { ...view, replacesLines }
}
