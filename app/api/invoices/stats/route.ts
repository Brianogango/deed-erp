import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { invoiceReadScope } from '@/lib/auth/authorization'
import { buildInvoiceStats, nairobiToday } from '@/lib/accounting/invoice-stats.server'

export const dynamic = 'force-dynamic'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/invoices/stats
 *
 * The dashboard's finance tiles: revenue, outstanding, payables, and the
 * overdue and pending-bill counts. Previously derived by looping the whole
 * invoice blob in the browser.
 *
 * `today` decides what counts as overdue. The caller passes its own Nairobi
 * date so the tiles agree with the rest of that page even if the server's
 * clock has rolled past midnight; anything malformed falls back to the
 * server's own Nairobi date rather than being trusted into the comparison.
 */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    // Revenue, receivables and payables are whole-ledger figures. Roles that
    // see only a slice get 403; the dashboard then totals its own slice.
    if (invoiceReadScope(session.user) !== 'all') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const requested = request.nextUrl.searchParams.get('today')
    const today = requested && ISO_DAY.test(requested) ? requested : nairobiToday()
    const stats = await buildInvoiceStats(today)
    return NextResponse.json(stats, { headers: { 'Cache-Control': 'no-store' } })
  })
}
