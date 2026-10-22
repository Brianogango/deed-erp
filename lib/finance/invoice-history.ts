/**
 * The audit trail of an invoice or bill: who created, edited, confirmed,
 * emailed, paid, reversed or cancelled it, and when. Built from the server's
 * audit log, so it cannot be edited from the browser.
 */

export type FieldChange = { field: string; label: string; from: string; to: string }

export type HistoryEvent = {
  id: string
  /** ISO timestamp. */
  at: string
  action: string
  title: string
  by: string | null
  detail?: string
  changes?: FieldChange[]
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}

const money = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '—'
}
const dateOnly = (v: unknown) => {
  if (v == null || v === '') return '—'
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10)
}
const text = (v: unknown) => (v == null || v === '' ? '—' : String(v))

const STATUS_WORDS: Record<string, string> = {
  draft: 'Draft',
  approved: 'Confirmed',
  invoiced: 'Confirmed',
  posted: 'Confirmed',
  partial: 'Part paid',
  partially_paid: 'Part paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
  voided: 'Cancelled',
}
const statusWord = (s: unknown) => STATUS_WORDS[String(s ?? '')] ?? text(s)

type LineLike = { description?: unknown; qty?: unknown; unitPrice?: unknown; taxRate?: unknown; lineTotal?: unknown }
const lineKey = (l: LineLike) => [String(l.description ?? '').trim(), Number(l.qty) || 0, Number(l.unitPrice) || 0, Number(l.taxRate) || 0].join('|')
const lineLabel = (l: LineLike) => `${String(l.description ?? '').trim() || 'Line'} ×${Number(l.qty) || 0} @ ${money(l.unitPrice)}`

/** What a save changed, field by field, in words a person can read. Empty when nothing changed. */
export function invoiceEditChanges(args: {
  before: Record<string, any>
  data: Record<string, any>
  beforeLines?: LineLike[]
  afterLines?: LineLike[]
  partyNames?: { before?: string | null; after?: string | null }
}): FieldChange[] {
  const { before, data } = args
  const out: FieldChange[] = []
  const push = (field: string, label: string, from: string, to: string) => { if (from !== to) out.push({ field, label, from, to }) }
  const has = (k: string) => Object.prototype.hasOwnProperty.call(data, k) && data[k] !== undefined

  if (has('clientId') && String(data.clientId) !== String(before.clientId)) {
    push('clientId', before.documentType === 'vendor_bill' ? 'Vendor' : 'Customer', text(args.partyNames?.before ?? before.clientId), text(args.partyNames?.after ?? data.clientId))
  }
  if (has('invoiceNumber')) push('invoiceNumber', 'Number', text(before.invoiceNumber), text(data.invoiceNumber))
  if (has('invoiceDate')) push('invoiceDate', 'Date', dateOnly(before.invoiceDate), dateOnly(data.invoiceDate))
  if (has('dueDate')) push('dueDate', 'Due date', dateOnly(before.dueDate), dateOnly(data.dueDate))
  if (has('subject')) push('subject', 'Subject', text(before.subject), text(data.subject))
  if (has('customerPoNumber')) push('customerPoNumber', 'Customer PO', text(before.customerPoNumber), text(data.customerPoNumber))
  if (has('salespersonName')) push('salespersonName', 'Salesperson', text(before.salespersonName), text(data.salespersonName))
  if (has('notes')) push('notes', 'Notes', text(before.notes).trim(), text(data.notes).trim())
  if (has('paymentBlocked')) push('paymentBlocked', 'Payment', before.paymentBlocked ? 'Blocked (dispute)' : 'Open', data.paymentBlocked ? 'Blocked (dispute)' : 'Open')
  if (has('discountAmount')) push('discountAmount', 'Discount', money(before.discountAmount), money(data.discountAmount))
  if (has('taxAmount')) push('taxAmount', 'VAT', money(before.taxAmount), money(data.taxAmount))
  if (has('totalAmount')) push('totalAmount', 'Total', money(before.totalAmount), money(data.totalAmount))
  if (has('status') && statusWord(data.status) !== statusWord(before.status)) {
    out.push({ field: 'status', label: 'Status', from: statusWord(before.status), to: statusWord(data.status) })
  }

  if (args.afterLines) {
    const beforeLines = (args.beforeLines ?? []).filter(l => String(l.description ?? '').trim() || Number(l.qty))
    const afterLines = args.afterLines.filter(l => String(l.description ?? '').trim() || Number(l.qty))
    const beforeKeys = beforeLines.map(lineKey)
    const afterKeys = afterLines.map(lineKey)
    const removed = beforeLines.filter((l, i) => !afterKeys.includes(beforeKeys[i]))
    const added = afterLines.filter((l, i) => !beforeKeys.includes(afterKeys[i]))
    if (removed.length || added.length) {
      out.push({
        field: 'lines',
        label: 'Lines',
        from: removed.length ? removed.slice(0, 4).map(lineLabel).join('; ') + (removed.length > 4 ? ` +${removed.length - 4} more` : '') : '—',
        to: added.length ? added.slice(0, 4).map(lineLabel).join('; ') + (added.length > 4 ? ` +${added.length - 4} more` : '') : '—',
      })
    }
  }
  return out
}

export type AuditRow = {
  id: string
  action: string
  entityType: string
  userId: string | null
  createdAt: Date | string
  oldValues: any
  newValues: any
  approvalReason?: string | null
}

const ACTION_TITLES: Record<string, string> = {
  create_invoice: 'Created',
  create_invoice_from_so: 'Created from sale order',
  update_invoice: 'Edited',
  post_invoice: 'Confirmed',
  void_invoice: 'Cancelled',
  record_invoice_payment: 'Payment recorded',
  reverse_invoice_payment: 'Payment reversed',
  repair_invoice_reissue: 'Reissued from repair',
  reverse_duplicate_invoice_journals: 'Duplicate accounting entry reversed',
  reverse_duplicate_credit_application: 'Duplicate credit reversed',
  rebook_bill_booked_as_sale: 'Re-booked as a bill',
  rebook_edited_document: 'Accounting entry re-booked after edit',
  book_till_receipt: 'Till receipt booked',
  reverse_duplicate_payment_journal: 'Duplicate payment entry reversed',
  rebook_unbooked_document: 'Accounting entry booked',
  record_payment_from_ledger_entry: 'Payment recorded from ledger entry',
  book_missing_payment_entry: 'Missing payment entry booked',
  invoice_customer_corrected: 'Customer corrected',
  portal_quote_approval: 'Updated from customer approval (portal)',
  create_bill: 'Bill created from purchase order',
  invoice_repair: 'Invoiced from repair',
  auto_invoice: 'Invoiced automatically',
  schedule_invoice_delivery: 'Delivery scheduled',
  reverse_invoice: 'Invoice reversed',
  sales_credit_note: 'Credit note issued',
  rma_credit_note: 'Credit note issued (return)',
}

/** Screen-side entries that repeat a server record already in the trail. */
const UI_DUPLICATES = new Set(['post_invoice', 'cancel_invoice', 'reverse_payment', 'reset_invoice_draft', 'register_payment', 'record_payment'])

const humanize = (action: string) => action.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

/**
 * One audit row → one line in the history. A save that changed nothing (the
 * screens re-save documents in the background) returns null.
 */
export function describeAuditRow(row: AuditRow, docLabel: 'Invoice' | 'Bill' | 'Credit note', userName: (id: string | null) => string | null): HistoryEvent | null {
  const at = (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString()
  const by = userName(row.userId) ?? (row.newValues && typeof row.newValues === 'object' && (row.newValues as any).username && (row.newValues as any).username !== 'system' ? String((row.newValues as any).username) : null)
  const nv = (row.newValues ?? {}) as Record<string, any>
  const ov = (row.oldValues ?? {}) as Record<string, any>
  const base = { id: `audit-${row.id}`, at, action: row.action, by }
  if (row.entityType === 'document' && UI_DUPLICATES.has(row.action)) return null

  switch (row.action) {
    case 'create_invoice':
    case 'create_invoice_from_so':
      return { ...base, title: `${docLabel} ${ACTION_TITLES[row.action].toLowerCase()}`, detail: [nv.invoiceNumber, nv.totalAmount != null ? money(nv.totalAmount) : '', nv.status ? statusWord(nv.status) : '', row.approvalReason || ''].filter(Boolean).join(' · '), tone: 'neutral' }
    case 'update_invoice': {
      const changes: FieldChange[] = Array.isArray(nv.changes) ? nv.changes : []
      if (!changes.length) {
        // Older rows only carry status and total.
        const legacy: FieldChange[] = []
        if (ov.status !== undefined && nv.status !== undefined && statusWord(ov.status) !== statusWord(nv.status)) legacy.push({ field: 'status', label: 'Status', from: statusWord(ov.status), to: statusWord(nv.status) })
        if (ov.totalAmount !== undefined && nv.totalAmount !== undefined && Number(ov.totalAmount) !== Number(nv.totalAmount)) legacy.push({ field: 'totalAmount', label: 'Total', from: money(ov.totalAmount), to: money(nv.totalAmount) })
        if (!legacy.length) return null
        return { ...base, title: `${docLabel} edited`, changes: legacy, tone: 'neutral' }
      }
      const statusOnly = changes.length === 1 && changes[0].field === 'status'
      const title = statusOnly
        ? (changes[0].to === 'Cancelled' ? `${docLabel} cancelled` : changes[0].to === 'Draft' ? `${docLabel} reset to draft` : `Status changed to ${changes[0].to}`)
        : `${docLabel} edited`
      return { ...base, title, changes: statusOnly ? undefined : changes, detail: statusOnly ? `${changes[0].from} → ${changes[0].to}` : undefined, tone: statusOnly && changes[0].to === 'Cancelled' ? 'bad' : 'neutral' }
    }
    case 'post_invoice': {
      const changes: FieldChange[] = Array.isArray(nv.changes) ? nv.changes.filter((c: FieldChange) => c.field !== 'status') : []
      return { ...base, title: `${docLabel} confirmed`, detail: [nv.invoiceNumber, nv.totalAmount != null ? money(nv.totalAmount) : ''].filter(Boolean).join(' · ') || 'Accounting entry posted', changes: changes.length ? changes : undefined, tone: 'good' }
    }
    case 'portal_quote_approval': {
      const changes: FieldChange[] = Array.isArray(nv.changes) ? nv.changes : []
      return { ...base, title: ACTION_TITLES[row.action], detail: row.approvalReason || undefined, changes: changes.length ? changes : undefined, tone: 'neutral' }
    }
    case 'void_invoice':
      return { ...base, title: `${docLabel} cancelled`, detail: ov.totalAmount != null ? `Was ${money(ov.totalAmount)}` : undefined, tone: 'bad' }
    case 'record_invoice_payment':
      return { ...base, title: docLabel === 'Invoice' ? 'Receipt recorded' : 'Payment recorded', detail: [money(nv.paymentAmount), nv.paymentMethod ? String(nv.paymentMethod).replace(/_/g, ' ') : '', nv.reference].filter(Boolean).join(' · '), tone: 'good' }
    case 'reverse_invoice_payment':
      return { ...base, title: 'Payment reversed', detail: [ov.amount != null ? money(ov.amount) : '', nv.reason ? `Reason: ${nv.reason}` : ''].filter(Boolean).join(' · '), tone: 'bad' }
    default:
      return { ...base, title: ACTION_TITLES[row.action] ?? humanize(row.action), detail: row.approvalReason || (typeof nv.details === 'string' ? nv.details : undefined), tone: 'neutral' }
  }
}

/** Newest first; same-second events keep a stable order. */
export function sortHistory(events: HistoryEvent[]): HistoryEvent[] {
  return [...events].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
}
