import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  user: { id: 'u-1', role: 'director' } as Record<string, unknown>,
  invoices: [] as Array<Record<string, unknown>>,
  sales: true,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/api', () => ({
  getRequiredSession: vi.fn(async () => ({ user: h.user })),
  withApiErrorHandling: async (handler: () => Promise<any>) => handler(),
}))
vi.mock('@/lib/dashboard-priority', () => ({
  dashboardSectionsForUser: () => ({ sales: h.sales }),
}))
vi.mock('@/lib/store-viewer-state.server', () => ({
  loadViewerState: async () => ({ deed_invoices: h.invoices }),
}))

import { GET } from '@/app/api/dashboard/customer-revenue/route'

const url = (query: string) => new Request(`http://localhost/api/dashboard/customer-revenue?${query}`) as never

const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'i1', type: 'customer_invoice', status: 'posted',
  partnerId: 'c1', partnerName: 'Sumba Harun', date: '2026-11-04', total: 56000, ...over,
})

describe('GET /api/dashboard/customer-revenue', () => {
  beforeEach(() => { h.sales = true; h.invoices = [] })

  it('ranks customers by posted invoice value over the window', async () => {
    h.invoices = [
      invoice({ id: 'a', total: 56000 }),
      invoice({ id: 'b', partnerId: 'c2', partnerName: 'Proactive Networks Ltd', repairId: 'r1', total: 9000, date: '2026-10-20' }),
      invoice({ id: 'c', partnerId: 'c2', partnerName: 'Proactive Networks Ltd', total: 48000 }),
      invoice({ id: 'd', partnerId: 'c3', partnerName: 'Old Debt Ltd', isOpeningBalance: true, total: 900000 }),
      invoice({ id: 'e', partnerId: 'c4', partnerName: 'Last Year Ltd', date: '2025-11-04', total: 700000 }),
    ]
    const res = await GET(url('end=2026-11&months=3'))
    const body = await res.json()
    expect(body.rows[0]).toMatchObject({ name: 'Proactive Networks Ltd', revenue: 57000, orders: 2 })
    expect(body.rows[1]).toMatchObject({ name: 'Sumba Harun', revenue: 56000 })
    expect(body.total).toBe(113000)      // the carried-over balance and last year are out
    expect(body.customers).toBe(2)
    expect(body.end).toBe('2026-11')
    expect(body.months).toBe(3)
  })

  it('refuses a reader who does not get the sales section', async () => {
    h.sales = false
    expect((await GET(url('end=2026-11&months=1'))).status).toBe(403)
  })

  it('rejects a month it cannot read', async () => {
    expect((await GET(url('end=November&months=1'))).status).toBe(400)
    expect((await GET(url('months=1'))).status).toBe(400)
  })

  it('clamps the window and the size of the list', async () => {
    h.invoices = [invoice()]
    const wide = await (await GET(url('end=2026-11&months=999&limit=999'))).json()
    expect(wide.months).toBe(24)
    const narrow = await (await GET(url('end=2026-11&months=0&limit=0'))).json()
    expect(narrow.months).toBe(1)
    expect(narrow.rows).toHaveLength(1)
  })
})
