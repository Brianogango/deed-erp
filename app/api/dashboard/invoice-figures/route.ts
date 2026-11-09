import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { dashboardSectionsForUser, visibleDashboardRepairs, visibleDashboardSalesOrders } from '@/lib/dashboard-priority'
import { computeDashboardInvoiceFigures } from '@/lib/dashboard/invoice-figures'
import { loadViewerState } from '@/lib/store-viewer-state.server'

export const dynamic = 'force-dynamic'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const FINANCE_KEYS = ['deed_posOrders', 'deed_expenses', 'deed_journalEntries', 'deed_deposits', 'deed_bankStatementLines', 'deed_accounts', 'deed_bankAccounts', 'deed_payrollRuns']

const rows = (v: unknown): Record<string, any>[] => (Array.isArray(v) ? v : [])

/**
 * GET /api/dashboard/invoice-figures?today=YYYY-MM-DD
 *
 * Every dashboard figure that needs the invoice list (sales and repair
 * revenue, paid revenue by period, recent invoices, invoiced-not-delivered,
 * cash position and finance alerts), worked out here from the same rows the
 * user's browser would have downloaded. The dashboard no longer loads the
 * invoice list itself.
 */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const user = session.user
    const sections = dashboardSectionsForUser(user as never)
    const requested = request.nextUrl.searchParams.get('today')
    const today = requested && ISO_DAY.test(requested) ? requested : new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
    const withInvoicedNotDelivered = sections.sales || sections.inventory || sections.finance

    const keys = [
      'deed_invoices', 'deed_saleOrders', 'deed_repairs_v2',
      ...(withInvoicedNotDelivered ? ['deed_deliveries', 'deed_products'] : []),
      ...(sections.finance ? FINANCE_KEYS : []),
    ]
    const state = await loadViewerState(user as never, keys)
    const saleOrders = rows(state.deed_saleOrders)
    const figures = computeDashboardInvoiceFigures({
      today,
      invoices: rows(state.deed_invoices),
      visibleSaleOrders: visibleDashboardSalesOrders(user as never, saleOrders),
      saleOrders,
      visibleRepairs: visibleDashboardRepairs(user as never, rows(state.deed_repairs_v2) as never),
      deliveries: rows(state.deed_deliveries),
      products: rows(state.deed_products),
      withInvoicedNotDelivered,
      withRecent: sections.finance,
      finance: sections.finance
        ? {
            posOrders: rows(state.deed_posOrders),
            expenses: rows(state.deed_expenses),
            journalEntries: rows(state.deed_journalEntries),
            deposits: rows(state.deed_deposits),
            bankStatementLines: rows(state.deed_bankStatementLines),
            accounts: rows(state.deed_accounts),
            bankAccounts: rows(state.deed_bankAccounts),
            payrollRuns: rows(state.deed_payrollRuns),
          }
        : null,
    })
    return NextResponse.json(figures, { headers: { 'Cache-Control': 'no-store' } })
  })
}
