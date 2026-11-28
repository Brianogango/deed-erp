import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { canReadInvoiceRow } from '@/lib/auth/authorization'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'
import { loadAppState } from '@/lib/server-store'
import { invoiceExchangeView, exchangeRefOf, type ExchangeSourceRecord } from '@/lib/after-sales/exchange-document'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/invoices/[id]/exchange
 * For an invoice raised for an exchange's balance: the machines handed back
 * and given (serials, specs, values) and the ± rows that add up to it, or
 * { exchange: null }. The invoice screen and its PDF both show them; the
 * exchange list is not loaded on the Finance screens.
 */
export async function GET(_: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { id } = await resolveRouteParams(params)
    if (!UUID_RE.test(id)) return NextResponse.json({ exchange: null })

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true, saleOrderId: true, repairId: true, documentType: true, notes: true, subtotal: true, totalAmount: true,
        items: { select: { description: true, taxCode: true }, orderBy: { sortOrder: 'asc' } },
      },
    })
    if (!invoice || !canReadInvoiceRow(session.user, invoice)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if ((invoice.documentType ?? 'customer_invoice') !== 'customer_invoice') return NextResponse.json({ exchange: null })
    const doc = {
      notes: invoice.notes,
      subtotal: Number(invoice.subtotal),
      total: Number(invoice.totalAmount),
      lines: invoice.items.map(i => ({ description: i.description, lineType: i.taxCode === 'SECTION' ? 'section' : undefined })),
    }
    const ref = exchangeRefOf(doc)
    if (!ref) return NextResponse.json({ exchange: null })

    const state = await loadAppState(['deed_clientExchanges'])
    const exchanges = (Array.isArray(state.deed_clientExchanges) ? state.deed_clientExchanges : []) as ExchangeSourceRecord[]
    const exc = exchanges.find(e => e?.ref === ref)
    if (!exc) return NextResponse.json({ exchange: null })
    const serialIds = [...(exc.returnLines ?? []), ...(exc.newLines ?? [])]
      .flatMap(l => l.serialIds ?? [])
      .filter(sid => UUID_RE.test(String(sid)))
    const rows = serialIds.length
      ? await prisma.serialNumber.findMany({ where: { id: { in: serialIds } }, select: { id: true, serialNumber: true, notes: true, screenExtras: true } })
      : []
    const serials = rows.map(r => {
      const extras = (r.screenExtras && typeof r.screenExtras === 'object' ? r.screenExtras : {}) as Record<string, unknown>
      return {
        id: r.id,
        serial: r.serialNumber,
        specs: typeof extras.specs === 'string' ? extras.specs : (r.notes || undefined),
        unitName: typeof extras.unitName === 'string' ? extras.unitName : undefined,
      }
    })
    return NextResponse.json({ exchange: invoiceExchangeView(doc, [exc], serials) })
  })
}
