import 'server-only'

import prisma from '@/lib/prisma'
import { invoiceDocumentType } from '@/lib/accounting/invoice-document-type'
import { mapDbInvoiceItemsToClientLines } from '@/lib/finance-invoice'
import { OPENING_BALANCE_MARKER } from '@/lib/finance/opening-balance'

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
      method: String(p.paymentMethod),
      ...(p.reference ? { reference: p.reference } : {}),
      ...(p.bankAccountId ? { bankAccountId: p.bankAccountId } : {}),
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
  const screen = Array.isArray(screenCopy) ? screenCopy as Row[] : []
  const screenById = new Map(screen.filter(r => r?.id).map(r => [String(r.id), r]))
  const rows = await loadRows()
  const posterIds = [...new Set(rows.map(r => r.postedById).filter((id): id is string => Boolean(id)))]
  const posters = new Map((await prisma.user.findMany({ where: { id: { in: posterIds } }, select: { id: true, username: true } }))
    .map(u => [u.id, personName(u)]))
  const out = rows.map(inv => toScreenInvoice(inv, screenById.get(inv.id), inv.postedById ? posters.get(inv.postedById) : undefined))
  const tableIds = new Set(rows.map(r => r.id))
  const tableRefs = new Set(rows.map(r => r.invoiceNumber))
  for (const r of screen) {
    if (r?.id && !tableIds.has(String(r.id)) && !tableRefs.has(String(r.ref ?? ''))) out.push(r)
  }
  return out
}
