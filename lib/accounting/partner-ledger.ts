/**
 * Customer and supplier ledgers (statements of account), built from invoices,
 * bills and the payments recorded on them.
 *
 * The balance is always "what is owed": for a customer, what they owe us; for
 * a supplier, what we owe them.
 *
 *  - Drafts are not on the ledger (nothing is owed until confirmed); they are
 *    counted separately as "not confirmed yet".
 *  - A cancelled document with nothing paid on it is left out. One that had
 *    payments shows the document, its cancellation and the payments, so the
 *    money paid shows as credit in the customer's favour.
 *  - Credit applied from one document to another (store credit, supplier
 *    credit notes) moves no money: the credit note itself already lowered the
 *    balance, so the application is shown for information only.
 */
import { invoiceDocState } from '@/lib/odoo-sales-flow'

export type LedgerSide = 'customer' | 'supplier'

type Payment = {
  id?: string
  date?: string
  amount: number
  method?: string
  reference?: string
  recordedBy?: string
  cleared?: boolean
}

export type LedgerDoc = {
  id: string
  ref: string
  type: string
  status: string
  partnerId?: string | null
  partnerName: string
  date: string
  dueDate?: string | null
  total: number
  amountPaid: number
  payments?: Payment[]
  subject?: string
  notes?: string
  lines?: Array<{ description?: string; lineType?: string }>
}

export type LedgerLineKind = 'invoice' | 'bill' | 'credit_note' | 'payment' | 'refund' | 'cancellation' | 'credit_applied'

export type LedgerLine = {
  id: string
  date: string
  kind: LedgerLineKind
  documentId: string
  documentRef: string
  reference: string
  description: string
  /** Raises what is owed (invoice to a customer, bill from a supplier). */
  charge: number
  /** Lowers what is owed (payment, credit note, cancellation). */
  payment: number
  balance: number
  /** False for a cheque or transfer not cleared yet. */
  cleared: boolean
  /** Information only: no money moved. */
  infoOnly?: boolean
}

export type OpenItem = {
  documentId: string
  ref: string
  date: string
  dueDate: string
  total: number
  paid: number
  balance: number
  daysOverdue: number
  bucket: AgingBucket
}

export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90'
export const AGING_LABELS: Record<AgingBucket, string> = {
  current: 'Not yet due',
  d1_30: '1–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90: 'Over 90 days',
}

export type PartnerLedger = {
  side: LedgerSide
  /** Balance brought forward from before the period. */
  opening: number
  lines: LedgerLine[]
  periodCharges: number
  periodPayments: number
  closing: number
  /** Unpaid confirmed documents, oldest first. */
  openItems: OpenItem[]
  outstanding: number
  overdue: number
  aging: Record<AgingBucket, number>
  /** Credit notes not used yet (what the supplier owes back / customer is owed). */
  unappliedCredit: number
  drafts: { count: number; total: number }
  uncleared: { count: number; total: number }
  lastPayment: { date: string; amount: number } | null
  /** Average days from document date to fully paid, over paid documents. */
  avgDaysToPay: number | null
}

const round = (n: number) => Math.round(n * 100) / 100
const day = (d?: string | null) => String(d ?? '').slice(0, 10)
const num = (v: unknown) => Number(v) || 0

const docSide = (doc: LedgerDoc): LedgerSide | null =>
  doc.type === 'customer_invoice' ? 'customer' : doc.type === 'vendor_bill' ? 'supplier' : null

const isDraft = (s: string) => invoiceDocState(s) === 'draft'
const isCancelled = (s: string) => invoiceDocState(s) === 'cancelled'

/** Payment methods that move credit between documents rather than money. */
const ALLOCATION_METHODS = new Set(['customer_credit', 'vendor_credit', 'store_credit', 'credit_note'])

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${day(from)}T00:00:00Z`)
  const b = Date.parse(`${day(to)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

function bucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current'
  if (daysOverdue <= 30) return 'd1_30'
  if (daysOverdue <= 60) return 'd31_60'
  if (daysOverdue <= 90) return 'd61_90'
  return 'd90'
}

function describe(doc: LedgerDoc): string {
  const lines = (doc.lines ?? [])
    .filter(l => l.lineType !== 'section')
    .map(l => l.description)
    .filter(Boolean)
    .slice(0, 2)
    .join('; ')
  return doc.subject || lines || (doc.type === 'customer_invoice' ? 'Invoice' : 'Bill')
}

/** Does this document belong to the partner? By id when there is one, otherwise by exact name. */
export function belongsToPartner(doc: Pick<LedgerDoc, 'partnerId' | 'partnerName'>, partner: { id?: string | null; name: string }): boolean {
  if (partner.id && doc.partnerId) return doc.partnerId === partner.id
  return doc.partnerName.trim().toLowerCase() === partner.name.trim().toLowerCase()
}

export function buildPartnerLedger(args: {
  docs: LedgerDoc[]
  side: LedgerSide
  from?: string
  to?: string
  /** "Today" for aging; defaults to the period end or the real date. */
  asOf?: string
}): PartnerLedger {
  const asOf = day(args.asOf || args.to || new Date().toISOString())
  const from = day(args.from)
  const to = day(args.to)
  const docs = args.docs.filter(d => docSide(d) === args.side)
  const raw: Omit<LedgerLine, 'balance'>[] = []
  const drafts = { count: 0, total: 0 }
  const uncleared = { count: 0, total: 0 }
  const openItems: OpenItem[] = []
  let unappliedCredit = 0
  let lastPayment: { date: string; amount: number } | null = null
  const payDays: number[] = []

  for (const doc of docs) {
    const status = String(doc.status ?? '')
    const total = num(doc.total)
    if (isDraft(status)) { drafts.count++; drafts.total = round(drafts.total + total); continue }
    const payments = (doc.payments ?? []).filter(p => num(p.amount) > 0)
    const cancelled = isCancelled(status)
    if (cancelled && !payments.length && num(doc.amountPaid) <= 0) continue

    const isCredit = total < 0
    raw.push({
      id: `doc-${doc.id}`,
      date: day(doc.date),
      kind: isCredit ? 'credit_note' : args.side === 'customer' ? 'invoice' : 'bill',
      documentId: doc.id,
      documentRef: doc.ref,
      reference: doc.ref,
      description: isCredit ? (doc.notes?.split('\n')[0] || 'Credit note') : describe(doc),
      charge: isCredit ? 0 : total,
      payment: isCredit ? -total : 0,
      cleared: true,
    })
    if (cancelled && !isCredit) {
      raw.push({
        id: `cancel-${doc.id}`,
        date: day(doc.date),
        kind: 'cancellation',
        documentId: doc.id,
        documentRef: doc.ref,
        reference: doc.ref,
        description: `${doc.ref} cancelled`,
        charge: 0,
        payment: total,
        cleared: true,
      })
    }

    let recorded = 0
    let lastPaidOn = ''
    payments.forEach((p, i) => {
      const amount = num(p.amount)
      recorded += amount
      const allocation = ALLOCATION_METHODS.has(String(p.method ?? ''))
      const isCleared = p.cleared !== false
      const date = day(p.date) || day(doc.date)
      if (date > lastPaidOn) lastPaidOn = date
      if (!allocation && !isCleared) { uncleared.count++; uncleared.total = round(uncleared.total + amount) }
      if (!allocation && (!lastPayment || date > lastPayment.date)) lastPayment = { date, amount }
      const method = String(p.method ?? 'payment').replace(/_/g, ' ')
      raw.push({
        id: `pay-${doc.id}-${p.id ?? i}`,
        date,
        kind: allocation ? 'credit_applied' : 'payment',
        documentId: doc.id,
        documentRef: doc.ref,
        reference: p.reference || doc.ref,
        description: allocation
          ? `Credit ${p.reference ?? ''} used on ${doc.ref}`.replace(/\s+/g, ' ')
          : `${args.side === 'customer' ? 'Received' : 'Paid'} by ${method}${p.reference ? ` · ${p.reference}` : ''}${isCleared ? '' : ' · not cleared yet'}`,
        charge: 0,
        payment: allocation ? 0 : amount,
        cleared: isCleared,
        infoOnly: allocation || undefined,
      })
    })
    // Older records carry only a paid total, with no payment lines.
    const remainder = round(num(doc.amountPaid) - recorded)
    if (!isCredit && remainder > 0.005) {
      raw.push({
        id: `pay-legacy-${doc.id}`,
        date: day(doc.date),
        kind: 'payment',
        documentId: doc.id,
        documentRef: doc.ref,
        reference: doc.ref,
        description: `${args.side === 'customer' ? 'Received' : 'Paid'} (no payment details recorded)`,
        charge: 0,
        payment: remainder,
        cleared: true,
      })
    }

    if (isCredit) {
      unappliedCredit = round(unappliedCredit + Math.max(0, Math.abs(total) - Math.abs(num(doc.amountPaid))))
      continue
    }
    if (cancelled) continue
    const balance = round(Math.max(0, total - num(doc.amountPaid)))
    if (balance > 0.005) {
      const due = day(doc.dueDate) || day(doc.date)
      const daysOverdue = Math.max(0, daysBetween(due, asOf))
      openItems.push({
        documentId: doc.id, ref: doc.ref, date: day(doc.date), dueDate: due,
        total, paid: round(num(doc.amountPaid)), balance, daysOverdue, bucket: bucketFor(daysOverdue),
      })
    } else if (total > 0 && lastPaidOn) {
      payDays.push(Math.max(0, daysBetween(doc.date, lastPaidOn)))
    }
  }

  const kindOrder: Record<LedgerLineKind, number> = { invoice: 0, bill: 0, credit_note: 1, cancellation: 2, payment: 3, refund: 3, credit_applied: 4 }
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.documentRef.localeCompare(b.documentRef) || kindOrder[a.kind] - kindOrder[b.kind])

  let opening = 0
  let running = 0
  let periodCharges = 0
  let periodPayments = 0
  const lines: LedgerLine[] = []
  for (const l of raw) {
    if (to && l.date > to) continue
    running = round(running + l.charge - l.payment)
    if (from && l.date < from) { opening = running; continue }
    periodCharges = round(periodCharges + l.charge)
    periodPayments = round(periodPayments + l.payment)
    lines.push({ ...l, balance: running })
  }

  openItems.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const aging: Record<AgingBucket, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 }
  for (const o of openItems) aging[o.bucket] = round(aging[o.bucket] + o.balance)
  const outstanding = round(openItems.reduce((s, o) => s + o.balance, 0))

  return {
    side: args.side,
    opening,
    lines,
    periodCharges,
    periodPayments,
    closing: running,
    openItems,
    outstanding,
    overdue: round(outstanding - aging.current),
    aging,
    unappliedCredit,
    drafts,
    uncleared,
    lastPayment,
    avgDaysToPay: payDays.length ? Math.round(payDays.reduce((s, d) => s + d, 0) / payDays.length) : null,
  }
}

export type PartnerSummary = {
  key: string
  partnerId: string | null
  name: string
  side: LedgerSide
  outstanding: number
  overdue: number
  over90: number
  unappliedCredit: number
  openCount: number
  oldestDue: string | null
  lastActivity: string
  aging: Record<AgingBucket, number>
}

/** One row per customer and per supplier with money still open, biggest first. */
export function buildPartnerSummaries(docs: LedgerDoc[], asOf?: string): PartnerSummary[] {
  const groups = new Map<string, { side: LedgerSide; partnerId: string | null; name: string; docs: LedgerDoc[] }>()
  for (const d of docs) {
    const side = docSide(d)
    if (!side) continue
    const id = d.partnerId || null
    const key = `${side}:${id ?? d.partnerName.trim().toLowerCase()}`
    const g = groups.get(key) ?? { side, partnerId: id, name: d.partnerName, docs: [] }
    g.docs.push(d)
    groups.set(key, g)
  }
  const out: PartnerSummary[] = []
  for (const [key, g] of groups) {
    const l = buildPartnerLedger({ docs: g.docs, side: g.side, asOf })
    out.push({
      key,
      partnerId: g.partnerId,
      name: g.name,
      side: g.side,
      outstanding: l.outstanding,
      overdue: l.overdue,
      over90: l.aging.d90,
      unappliedCredit: l.unappliedCredit,
      openCount: l.openItems.length,
      oldestDue: l.openItems[0]?.dueDate ?? null,
      lastActivity: g.docs.map(d => day(d.date)).sort().at(-1) ?? '',
      aging: l.aging,
    })
  }
  return out.sort((a, b) => b.outstanding - a.outstanding || b.unappliedCredit - a.unappliedCredit)
}
