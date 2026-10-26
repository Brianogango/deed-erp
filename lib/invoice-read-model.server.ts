import 'server-only'

import prisma from '@/lib/prisma'
import { invoiceDocumentType } from '@/lib/accounting/invoice-document-type'
import { mapDbInvoiceItemsToClientLines } from '@/lib/finance-invoice'
import { OPENING_BALANCE_MARKER } from '@/lib/finance/opening-balance'
import { cachedByFingerprint, clearReadModelCache, incrementalRows } from '@/lib/read-model-cache'
import { legacyBankIdFromNotes } from '@/lib/accounting/bank-account-ref'

/**
 * Invoices and bills as the screens use them, read from the invoices table.
 *
 * The deed_invoices screen copy used to be what every screen read, kept in
 * step with the table by mirror code; the two drifting apart was behind
 * paid documents showing unpaid, documents missing from Finance and
 * duplicate payments. The table is now the source: header, money, status,
 * lines and payments all come from it.
 *
 * The screen copy is frozen (no longer written) and only consulted, read-only,
 * for details the table never stored — a line's serial number, a payment
 * listed on a document that predates the payments table — and for documents
 * that never reached the table at all, so nothing disappears from a screen.
 */

type Row = Record<string, any>

function mapStatus(status: string): string {
  // Posted documents; whether they are paid comes from amountPaid.
  if (status === 'approved' || status === 'invoiced' || status === 'paid' || status === 'partially_paid') return 'posted'
  if (status === 'pending_approval') return 'draft'
  return status
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : undefined)
const day = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '')


type DbInvoice = Awaited<ReturnType<typeof loadRows>>[number]

async function loadRows(ids?: string[]) {
  return prisma.invoice.findMany({
    where: ids ? { id: { in: ids } } : undefined,
    include: {
      client: { select: { name: true } },
      items: true,
      payments: { include: { createdBy: { select: { username: true } }, voidedBy: { select: { username: true } } } },
      paymentAllocations: { include: { payment: { include: { createdBy: { select: { username: true } }, voidedBy: { select: { username: true } } } } } },
    },
    orderBy: { invoiceDate: 'desc' },
  })
}

function personName(u: { username: string } | null | undefined) {
  return u?.username ?? ''
}

/** Payments recorded against the document: direct, or through an allocation. */
function paymentsOf(inv: DbInvoice) {
  const seen = new Map<string, { payment: any; amount: number; reversed: boolean }>()
  for (const a of inv.paymentAllocations) {
    const prev = seen.get(a.paymentId)
    const reversed = Boolean(a.reversedAt) || a.payment.isVoided
    seen.set(a.paymentId, { payment: a.payment, amount: (prev?.amount ?? 0) + Number(a.amount), reversed: (prev?.reversed ?? true) && reversed })
  }
  for (const p of inv.payments) {
    if (!seen.has(p.id)) seen.set(p.id, { payment: p, amount: Number(p.amount), reversed: p.isVoided })
  }
  const active: Row[] = []
  const voided: Row[] = []
  for (const { payment: p, amount, reversed } of seen.values()) {
    const entry: Row = {
      id: p.id,
      date: day(p.paidAt),
      amount,
      // Supplier credit uses / refunds are stored on the enum's nearest member
      // ('credit', 'bank_transfer'…); the note keeps what they really are.
      method: /method:vendor_credit\b/.test(String(p.notes ?? '')) ? 'vendor_credit' : String(p.paymentMethod),
      ...(/method:vendor_refund\b/.test(String(p.notes ?? '')) ? { supplierRefund: true } : {}),
      ...(p.reference ? { reference: p.reference } : {}),
      // The column only holds real bank_accounts ids; a payment into a built-in
      // or later-added account ('absa', 'ncba', …) keeps its id in the notes.
      // Without this the cashbook fell back to NCBA for every such payment.
      ...((p.bankAccountId ?? legacyBankIdFromNotes(p.notes)) ? { bankAccountId: p.bankAccountId ?? legacyBankIdFromNotes(p.notes) } : {}),
      ...(p.journalId ? { journalEntryId: p.journalId } : {}),
      recordedBy: personName(p.createdBy),
    }
    if (reversed) {
      voided.push({ ...entry, reversedAt: iso(p.voidedAt), reversedBy: personName(p.voidedBy), reversalReason: p.voidReason ?? undefined })
    } else {
      active.push(entry)
    }
  }
  const byDate = (a: Row, b: Row) => String(a.date).localeCompare(String(b.date))
  return { active: active.sort(byDate), voided: voided.sort(byDate) }
}

/**
 * Lines from the table. When the screen copy has the same lines (same count,
 * same descriptions), its line ids and table-less details (serial numbers)
 * are kept so links made against those ids still resolve.
 */
function linesOf(inv: DbInvoice, screen: Row | undefined) {
  const table = mapDbInvoiceItemsToClientLines(inv.items as any) as Row[]
  const old = Array.isArray(screen?.lines) ? screen!.lines as Row[] : []
  const sameShape = old.length === table.length
    && table.every((l, i) => String(l.description ?? '').trim() === String(old[i]?.description ?? '').trim())
  return table.map((l, i) => {
    const item = inv.items[i]
    const base: Row = sameShape ? { ...old[i] } : {}
    return {
      ...base,
      ...l,
      ...(sameShape && old[i]?.id ? { id: old[i].id } : {}),
      ...(item?.serialNumberId ? { serialNumberId: item.serialNumberId } : {}),
      ...(item?.taxCategory && item.taxCategory !== 'not_selected' ? { taxCategory: item.taxCategory } : {}),
    }
  })
}

export function toScreenInvoice(inv: DbInvoice, screen?: Row, postedByName?: string): Row {
  const { active, voided } = paymentsOf(inv)
  // A document from before the payments table keeps its listed payments for display.
  const payments = active.length || voided.length ? active : (Array.isArray(screen?.payments) ? screen!.payments : [])
  return {
    ...(screen ?? {}),
    id: inv.id,
    ref: inv.invoiceNumber,
    type: invoiceDocumentType(inv),
    status: mapStatus(String(inv.status)),
    partnerId: inv.clientId,
    partnerName: inv.client?.name ?? screen?.partnerName ?? '',
    date: day(inv.invoiceDate),
    dueDate: day(inv.dueDate),
    lines: linesOf(inv, screen),
    subtotal: Number(inv.subtotal),
    taxTotal: Number(inv.taxAmount),
    discountAmount: Number(inv.discountAmount) || undefined,
    total: Number(inv.totalAmount),
    amountPaid: Number(inv.amountPaid),
    payments,
    voidedPayments: voided.length ? voided : (screen?.voidedPayments ?? undefined),
    isOpeningBalance: String(inv.internalNotes ?? '').includes(OPENING_BALANCE_MARKER) || undefined,
    saleOrderId: inv.saleOrderId ?? undefined,
    purchaseOrderId: inv.purchaseOrderId ?? undefined,
    repairId: inv.repairId ?? undefined,
    receiptId: inv.receiptId ?? screen?.receiptId ?? undefined,
    deliveryJobId: inv.deliveryJobId ?? screen?.deliveryJobId ?? undefined,
    salespersonId: inv.salespersonId ?? screen?.salespersonId ?? undefined,
    salespersonName: inv.salespersonName ?? screen?.salespersonName ?? undefined,
    notes: inv.notes ?? '',
    subject: inv.subject ?? undefined,
    invoiceAddress: inv.invoiceAddress ?? undefined,
    customerPoNumber: inv.customerPoNumber ?? undefined,
    deliveryAddress: inv.deliveryAddress ?? undefined,
    currencyCode: inv.currencyCode ?? 'KES',
    baseCurrencyCode: inv.baseCurrencyCode ?? 'KES',
    exchangeRateToBase: Number(inv.exchangeRateToBase ?? 1) || 1,
    paymentBlocked: Boolean(inv.paymentBlocked),
    isPosInvoice: inv.isPosInvoice || undefined,
    isDownPayment: inv.isDownPayment || undefined,
    downPaymentPercent: inv.downPaymentPercent != null ? Number(inv.downPaymentPercent) : undefined,
    downPaymentAppliedToId: inv.downPaymentAppliedToId ?? undefined,
    postedByUserId: inv.postedById ?? screen?.postedByUserId ?? undefined,
    postedByName: postedByName || screen?.postedByName || undefined,
    postedAt: iso(inv.postedAt) ?? screen?.postedAt ?? undefined,
    lockVersion: Number(inv.lockVersion ?? 0),
  }
}

/**
 * The full invoice list for the screens: every table row, plus any document
 * only the frozen screen copy has (never reached the table) so it stays
 * visible until it is booked or cleared.
 */
export async function loadScreenInvoices(screenCopy: unknown): Promise<Row[]> {
  const copy = Array.isArray(screenCopy) ? screenCopy as Row[] : []
  let fingerprint = ''
  return cachedByFingerprint(
    'invoices',
    async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ fp: string | null }>>(`
        SELECT concat_ws('|',
          (SELECT max(updated_at)::text || ':' || count(*) FROM invoices),
          (SELECT count(*) || ':' || coalesce(sum(line_total), 0) || ':' || coalesce(sum(qty), 0) FROM invoice_items),
          (SELECT count(*) || ':' || max(created_at)::text || ':' || count(*) FILTER (WHERE is_voided) || ':' || coalesce(sum(amount), 0) FROM payments),
          (SELECT count(*) || ':' || max(created_at)::text || ':' || count(reversed_at) || ':' || coalesce(sum(amount), 0) FROM payment_allocations),
          (SELECT md5(coalesce(string_agg(id::text || ':' || username, ',' ORDER BY id), '')) FROM users),
          (SELECT md5(coalesce(string_agg(id::text || ':' || name, ',' ORDER BY id), '')) FROM clients)
        ) AS fp`)
      fingerprint = `${rows[0]?.fp ?? ''}|copy:${copy.length}:${String(copy[0]?.id ?? '')}:${String(copy[copy.length - 1]?.id ?? '')}`
      return fingerprint
    },
    // The last three parts (user names, client names, the frozen copy) touch
    // every row; while they are unchanged only changed documents are re-read.
    // Counted from the end: concat_ws skips an empty table's part.
    () => buildScreenInvoices(screenCopy, fingerprint.split('|').slice(-3).join('|')),
  )
}

/**
 * One hash per document over its own row, its lines, its payments and its
 * allocations (with their payments), in list order. Whole rows are hashed so
 * any column change counts, without listing columns here.
 */
async function documentSignatures(): Promise<Array<{ id: string; sig: string }>> {
  return prisma.$queryRawUnsafe<Array<{ id: string; sig: string }>>(`
    WITH it AS (SELECT invoice_id, string_agg(ii::text, ',' ORDER BY ii.id) AS s FROM invoice_items ii GROUP BY invoice_id),
         pa AS (SELECT invoice_id, string_agg(p::text, ',' ORDER BY p.id) AS s FROM payments p WHERE invoice_id IS NOT NULL GROUP BY invoice_id),
         al AS (SELECT a.invoice_id, string_agg(a::text || p::text, ',' ORDER BY a.id) AS s
                FROM payment_allocations a JOIN payments p ON p.id = a.payment_id GROUP BY a.invoice_id)
    SELECT i.id::text AS id,
           md5(i::text || '#' || coalesce(it.s, '') || '#' || coalesce(pa.s, '') || '#' || coalesce(al.s, '')) AS sig
    FROM invoices i
    LEFT JOIN it ON it.invoice_id = i.id
    LEFT JOIN pa ON pa.invoice_id = i.id
    LEFT JOIN al ON al.invoice_id = i.id
    ORDER BY i.invoice_date DESC, i.id`)
}

export function clearInvoiceRowCache(): void {
  clearReadModelCache('invoices')
}

async function convert(rows: DbInvoice[], screenById: Map<string, Row>): Promise<Map<string, Row>> {
  const posterIds = [...new Set(rows.map(r => r.postedById).filter((id): id is string => Boolean(id)))]
  const posters = posterIds.length
    ? new Map((await prisma.user.findMany({ where: { id: { in: posterIds } }, select: { id: true, username: true } }))
      .map(u => [u.id, personName(u)]))
    : new Map<string, string>()
  return new Map(rows.map(inv => [inv.id, toScreenInvoice(inv, screenById.get(inv.id), inv.postedById ? posters.get(inv.postedById) : undefined)]))
}

/**
 * A payment on one invoice used to re-read and convert all of them (0.4–1 s
 * on production, several times a minute); now only that one is.
 */
async function buildScreenInvoices(screenCopy: unknown, base = ''): Promise<Row[]> {
  const screen = Array.isArray(screenCopy) ? screenCopy as Row[] : []
  const screenById = new Map(screen.filter(r => r?.id).map(r => [String(r.id), r]))
  const ordered = await incrementalRows<Row>({
    name: 'invoices',
    base,
    signatures: documentSignatures,
    load: async ids => convert(await loadRows(ids ?? undefined), screenById),
  })
  const out = [...ordered]
  const tableIds = new Set(out.map(r => String(r.id)))
  const tableRefs = new Set(out.map(r => String(r.ref ?? '')))
  for (const r of screen) {
    if (r?.id && !tableIds.has(String(r.id)) && !tableRefs.has(String(r.ref ?? ''))) out.push(r)
  }
  return out
}
