import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  state: {} as Record<string, unknown>,
  saveStoreKeys: vi.fn(),
  repairFindFirst: vi.fn(),
  endpointCreate: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/server', () => ({ getServerSession: m.getServerSession }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn(async (keys: string[]) => Object.fromEntries(keys.filter(k => k in m.state).map(k => [k, m.state[k]]))),
  saveStoreKeys: m.saveStoreKeys,
  findStoreItem: vi.fn(async (key: string, id: string) => {
    const list = m.state[key]
    return Array.isArray(list) ? list.find((e: any) => e?.id === id) ?? null : null
  }),
}))
vi.mock('@/lib/prisma', () => ({
  default: {
    repair: { findFirst: m.repairFindFirst },
    notificationEndpoint: { findFirst: vi.fn(async () => null), create: m.endpointCreate, update: vi.fn() },
  },
}))

import { GET as receiptGet, POST as receiptPost } from '@/app/api/expense-receipts/[expenseId]/route'
import { POST as registerEndpoint } from '@/app/api/notifications/endpoints/route'
import { isAllowedPushEndpoint } from '@/lib/notifications/web-push'
import { trackRepairTool } from '@/lib/jarvis/tools/track-repair'

const session = (role: string, id = 'u1') => ({ user: { id, name: 'U', username: 'u', role, modules: ['expenses', 'repair'] } })
const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64')
const htmlAsPdf = 'data:application/pdf;base64,' + Buffer.from('<html><script>alert(1)</script>').toString('base64')
const params = (id: string) => ({ params: Promise.resolve({ expenseId: id }) })
const post = (dataUrl: string) => new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ dataUrl }), headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  m.state = { deed_expenses: [{ id: 'exp-1', submittedByUserId: 'claimant' }] }
})

describe('expense receipts', () => {
  it('refuses a file that is not really a picture or PDF', async () => {
    m.getServerSession.mockResolvedValue(session('sales_rep', 'claimant'))
    expect((await receiptPost(post('data:text/html;base64,' + Buffer.from('<script>').toString('base64')), params('exp-1'))).status).toBe(415)
    expect((await receiptPost(post(htmlAsPdf), params('exp-1'))).status).toBe(415)
    expect(m.saveStoreKeys).not.toHaveBeenCalled()
  })

  it('only the claimant or finance can attach to or read a claim', async () => {
    m.getServerSession.mockResolvedValue(session('sales_rep', 'someone-else'))
    expect((await receiptPost(post(pdf), params('exp-1'))).status).toBe(403)
    m.state['expense_receipt_exp-1'] = pdf
    expect((await receiptGet(new NextRequest('http://x'), params('exp-1'))).status).toBe(404)
    m.getServerSession.mockResolvedValue(session('finance_officer'))
    expect((await receiptGet(new NextRequest('http://x'), params('exp-1'))).status).toBe(200)
  })

  it('serves an old stored HTML receipt as a download, not a page', async () => {
    m.getServerSession.mockResolvedValue(session('finance_officer'))
    m.state['expense_receipt_exp-1'] = 'data:text/html;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64')
    const res = await receiptGet(new NextRequest('http://x'), params('exp-1'))
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('the claimant can attach a PDF; it is stored with its real type', async () => {
    m.getServerSession.mockResolvedValue(session('sales_rep', 'claimant'))
    expect((await receiptPost(post(pdf), params('exp-1'))).status).toBe(200)
    expect(m.saveStoreKeys.mock.calls[0][0]['expense_receipt_exp-1']).toMatch(/^data:application\/pdf;base64,/)
  })
})

describe('web push endpoints', () => {
  it('accepts only browser push services', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true)
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true)
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true)
    expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true)
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isAllowedPushEndpoint('https://localhost:3000/api/admin')).toBe(false)
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false)
  })

  it('registration refuses other hosts', async () => {
    m.getServerSession.mockResolvedValue(session('technician'))
    const res = await registerEndpoint(new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ endpoint: 'https://10.0.0.5/internal', keys: { p256dh: 'a', auth: 'b' } }) }))
    expect(res.status).toBe(400)
    expect(m.endpointCreate).not.toHaveBeenCalled()
  })
})

describe('Jarvis track_repair', () => {
  it('limits a technician to their own jobs', async () => {
    m.repairFindFirst.mockResolvedValue(null)
    await trackRepairTool.run({ user: { id: 'tech-a', role: 'technician', modules: ['repair'] } } as any, { query: 'SN123' })
    expect(JSON.stringify(m.repairFindFirst.mock.calls[0][0].where)).toContain('tech-a')
    m.repairFindFirst.mockClear()
    await trackRepairTool.run({ user: { id: 'lead', role: 'technical_lead', modules: ['repair'] } } as any, { query: 'SN123' })
    expect(m.repairFindFirst.mock.calls[0][0].where.AND).toBeUndefined()
  })
})
