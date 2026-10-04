import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { CONTENT_FILTERED_STORE_KEYS, canReadStoreKey, filterStoreValueForRole } from '@/lib/auth/authorization'
import { loadAppState } from '@/lib/server-store'
import { financeInvoicePath } from '@/lib/finance-invoice'
import { searchRecords } from '@/lib/universal-search'

export const dynamic = 'force-dynamic'

const KEYS = ['deed_repairs_v2', 'deed_saleOrders', 'deed_invoices', 'deed_serials', 'deed_contacts', 'deed_deliveries', 'deed_purchaseOrders']

/**
 * GET /api/search?q=… — every collection the person may read, whatever page
 * they are on. Same read rules as /api/store: unreadable keys are dropped and
 * content-filtered ledgers are sliced for the role.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = String(request.nextUrl.searchParams.get('q') ?? '').slice(0, 80)
  if (q.trim().length < 2) return NextResponse.json({ results: [] })

  const state = await loadAppState(KEYS)
  const list = (key: string): Record<string, any>[] => {
    if (!canReadStoreKey(session.user, key)) return []
    const value = CONTENT_FILTERED_STORE_KEYS.has(key) ? filterStoreValueForRole(session.user, key, state[key]) : state[key]
    return Array.isArray(value) ? value as Record<string, any>[] : []
  }

  const results = searchRecords({
    repairs: list('deed_repairs_v2'),
    saleOrders: list('deed_saleOrders'),
    invoices: list('deed_invoices'),
    serials: list('deed_serials'),
    contacts: list('deed_contacts'),
    deliveries: list('deed_deliveries'),
    purchaseOrders: list('deed_purchaseOrders'),
  }, q, id => financeInvoicePath(id))

  return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
}
