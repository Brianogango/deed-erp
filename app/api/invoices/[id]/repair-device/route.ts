import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { canReadInvoiceRow } from '@/lib/auth/authorization'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'
import { loadAppState } from '@/lib/server-store'
import { findRepairForInvoice, repairDeviceHeading, type RepairDeviceLike } from '@/lib/repair-invoice-device-section'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/invoices/[id]/repair-device
 * The device a repair invoice was for, as the heading its PDF prints above the
 * charges ("HP EliteBook 840 G8 · S/N 5CG123"), or null when the invoice is
 * not for a repair.
 *
 * The Finance screens do not load the repair list, so the PDF could not work
 * this out in the browser — the heading only appeared for someone who had
 * opened Repairs earlier in the session.
 */
export async function GET(_: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { id } = await resolveRouteParams(params)
    if (!UUID_RE.test(id)) return NextResponse.json({ heading: null })

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, repairId: true, saleOrderId: true, documentType: true },
    })
    if (!invoice || !canReadInvoiceRow(session.user, invoice)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if ((invoice.documentType ?? 'customer_invoice') !== 'customer_invoice') {
      return NextResponse.json({ heading: null })
    }

    const state = await loadAppState(['deed_repairs_v2', 'deed_saleOrders'])
    const repairs = (Array.isArray(state.deed_repairs_v2) ? state.deed_repairs_v2 : []) as RepairDeviceLike[]
    const saleOrders = (Array.isArray(state.deed_saleOrders) ? state.deed_saleOrders : []) as Array<{ id?: string; repairId?: string }>
    const saleOrderRepairId = invoice.saleOrderId
      ? saleOrders.find(o => o?.id === invoice.saleOrderId)?.repairId ?? null
      : null

    const repair = findRepairForInvoice({ id: invoice.id, repairId: invoice.repairId }, repairs, saleOrderRepairId)
    return NextResponse.json({ heading: repair ? repairDeviceHeading(repair) || null : null })
  })
}
