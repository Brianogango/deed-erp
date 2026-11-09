import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { buildJobTrail, type TrailStart } from '@/lib/job-trail'
import { financeInvoicePath } from '@/lib/finance-invoice'
import { loadViewerState } from '@/lib/store-viewer-state.server'

export const dynamic = 'force-dynamic'

const KINDS = new Set<TrailStart['kind']>(['repair', 'sale_order', 'invoice', 'delivery'])
const rows = (v: unknown) => (Array.isArray(v) ? v : []) as never[]

/**
 * GET /api/job-trail?kind=invoice&id=…
 *
 * The job trail (Repair → Quote → Sale order → Invoice → Delivery) for screens
 * that do not load those lists, such as Finance. Built from the rows the user
 * may see, as the browser would.
 */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const kind = request.nextUrl.searchParams.get('kind') as TrailStart['kind'] | null
    const id = String(request.nextUrl.searchParams.get('id') ?? '').trim()
    if (!kind || !KINDS.has(kind) || !id) {
      return NextResponse.json({ error: 'kind and id are required' }, { status: 400 })
    }
    const state = await loadViewerState(session.user as never, ['deed_repairs_v2', 'deed_saleOrders', 'deed_quotes', 'deed_invoices', 'deed_deliveries'])
    const trail = buildJobTrail({ kind, id }, {
      repairs: rows(state.deed_repairs_v2),
      saleOrders: rows(state.deed_saleOrders),
      quotes: rows(state.deed_quotes),
      invoices: rows(state.deed_invoices),
      deliveries: rows(state.deed_deliveries),
      invoiceHref: invoiceId => financeInvoicePath(invoiceId),
    })
    return NextResponse.json(trail, { headers: { 'Cache-Control': 'no-store' } })
  })
}
