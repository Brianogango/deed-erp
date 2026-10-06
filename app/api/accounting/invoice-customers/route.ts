/**
 * Invoices filed under the wrong customer (lib/finance/invoice-customer-check.ts).
 *
 * GET  — the list: each invoice whose customer differs from its till ticket,
 *        sale order or repair. Changes nothing.
 * POST — move those invoices (and credit notes raised against them) to the
 *        customer the source document names. Amounts and journals are untouched.
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState } from '@/lib/server-store'
import { resolveClientId } from '@/lib/legacy-compat'
import { appendInventoryAuditLog } from '@/lib/inventory/audit'
import { findMisfiledInvoices, type InvoiceForCheck, type MisfiledInvoice, type SourceCustomer } from '@/lib/finance/invoice-customer-check'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'finance_officer']
const SOURCE_LABEL = { pos: 'till ticket', sale_order: 'sale order', repair: 'repair' } as const

async function buildReport(): Promise<MisfiledInvoice[]> {
  const [rows, saleOrders, repairs, state] = await Promise.all([
    prisma.invoice.findMany({
      where: { documentType: 'customer_invoice', status: { notIn: ['cancelled', 'voided'] } },
      select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true, clientId: true, saleOrderId: true, repairId: true, isPosInvoice: true, client: { select: { name: true } } },
    }),
    prisma.saleOrder.findMany({ select: { id: true, clientId: true, client: { select: { name: true } } } }),
    prisma.repair.findMany({ select: { id: true, clientId: true, client: { select: { name: true } } } }),
    loadAppState(['deed_posOrders']),
  ])
  const invoices: InvoiceForCheck[] = rows.map(r => ({
    id: r.id,
    ref: r.invoiceNumber,
    date: r.invoiceDate ? new Date(r.invoiceDate).toISOString().slice(0, 10) : '',
    total: Number(r.totalAmount) || 0,
    clientId: r.clientId,
    clientName: r.client?.name ?? '',
    saleOrderId: r.saleOrderId,
    repairId: r.repairId,
    isPosInvoice: r.isPosInvoice,
  }))
  const idByRef = new Map(invoices.map(i => [i.ref, i.id]))
  const posByInvoiceId = new Map<string, SourceCustomer>()
  const posOrders = Array.isArray(state.deed_posOrders) ? state.deed_posOrders as Array<Record<string, unknown>> : []
  for (const order of posOrders) {
    const invoiceId = String(order.invoiceId ?? '') || idByRef.get(String(order.invoiceRef ?? '')) || ''
    if (!invoiceId) continue
    posByInvoiceId.set(invoiceId, {
      clientId: order.customerId ? String(order.customerId) : null,
      name: String(order.customerName ?? ''),
    })
  }
  const toMap = (list: Array<{ id: string; clientId: string; client: { name: string } | null }>) =>
    new Map<string, SourceCustomer>(list.map(x => [x.id, { clientId: x.clientId, name: x.client?.name ?? '' }]))
  return findMisfiledInvoices({ invoices, posByInvoiceId, saleOrders: toMap(saleOrders), repairs: toMap(repairs) })
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    return NextResponse.json({ rows: await buildReport() })
  })
}

export async function POST() {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const rows = await buildReport()
    const results: Array<{ ref: string; status: 'fixed' | 'failed'; message: string }> = []
    for (const row of rows) {
      try {
        // A POS ticket names the browser's contact, which the server may not
        // hold yet: resolveClientId creates it under that id (or finds it by
        // the same name). Sale orders and repairs name a server contact.
        const clientId = row.source === 'pos'
          ? await resolveClientId(prisma, row.targetClientId, { partnerName: row.shouldBe })
          : row.targetClientId
        if (!clientId) throw new Error('No customer on the source document')
        await prisma.$transaction([
          prisma.invoice.update({ where: { id: row.invoiceId }, data: { clientId } }),
          prisma.creditNote.updateMany({ where: { invoiceId: row.invoiceId }, data: { clientId } }),
        ])
        await appendInventoryAuditLog({
          action: 'invoice_customer_corrected',
          documentRef: row.ref,
          details: `Customer corrected: ${row.filedUnder} → ${row.shouldBe} (per the ${SOURCE_LABEL[row.source]})`,
          userId: actor.id,
          username: actor.username || actor.name,
        })
        results.push({ ref: row.ref, status: 'fixed', message: `${row.filedUnder} → ${row.shouldBe}` })
      } catch (err) {
        results.push({ ref: row.ref, status: 'failed', message: err instanceof Error ? err.message : 'failed' })
      }
    }
    if (results.some(r => r.status === 'fixed')) {
      const { refreshInvoicesBlob } = await import('@/lib/documents-broadcast.server')
      await refreshInvoicesBlob()
    }
    return NextResponse.json({ results })
  })
}
