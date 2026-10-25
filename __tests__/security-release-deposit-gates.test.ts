import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Real lib/auth/api role checks; only the session and the database are mocked.
const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  releaseUpdate: vi.fn(),
  addDepositReceipt: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: m.getServerSession }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/prisma', () => ({ default: { outboundRelease: { update: m.releaseUpdate } } }))
vi.mock('@/lib/server-store', () => ({ loadAppState: vi.fn(async () => ({})), saveStoreKeys: vi.fn(), notifyStoreKeysChanged: vi.fn() }))
vi.mock('@/lib/portal-repairs', () => ({ registerPortalRepair: vi.fn() }))
vi.mock('@/lib/accounting/deposit-service', () => ({ addDepositReceipt: m.addDepositReceipt }))

import { PATCH } from '@/app/api/outbound-releases/[id]/route'
import { POST as depositReceipt } from '@/app/api/deposits/[id]/payments/route'

const session = (role: string) => ({ user: { id: '22222222-2222-4222-8222-222222222222', name: 'U', username: 'u', role, modules: [] } })
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const patch = (body: unknown) => new NextRequest('http://localhost/api/outbound-releases/r1', { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

describe('PATCH /api/outbound-releases/[id]', () => {
  beforeEach(() => { vi.clearAllMocks(); m.releaseUpdate.mockResolvedValue({ id: 'r1' }) })

  it('refuses non-verifier roles (previously any session could rewrite the release)', async () => {
    m.getServerSession.mockResolvedValue(session('technician'))
    const res = await PATCH(patch({ initiatedBy: { update: { role: 'director' } } }), params('r1'))
    expect(res.status).toBe(403)
    expect(m.releaseUpdate).not.toHaveBeenCalled()
  })

  it('never passes status, actor ids or relation writes to the database', async () => {
    m.getServerSession.mockResolvedValue(session('director'))
    const res = await PATCH(patch({
      status: 'released', verifiedById: 'x', initiatedBy: { update: { role: 'director' } }, auditLog: { deleteMany: {} },
      releaseNotes: 'Handed over at the counter',
    }), params('r1'))
    expect(res.status).toBe(200)
    expect(m.releaseUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { releaseNotes: 'Handed over at the counter' } })
  })

  it('rejects a body with nothing editable', async () => {
    m.getServerSession.mockResolvedValue(session('director'))
    const res = await PATCH(patch({ initiatedBy: { connect: { id: 'x' } } }), params('r1'))
    expect(res.status).toBe(400)
    expect(m.releaseUpdate).not.toHaveBeenCalled()
  })
})

describe('POST /api/deposits/[id]/payments', () => {
  const pay = () => new Request('http://localhost/api/deposits/dep-1/payments', { method: 'POST', body: JSON.stringify({ amount: 900, method: 'cash' }), headers: { 'Content-Type': 'application/json' } })
  beforeEach(() => { vi.clearAllMocks(); m.addDepositReceipt.mockResolvedValue({ id: 'dep-1' }) })

  it('refuses roles that cannot manage deposits', async () => {
    for (const role of ['technician', 'inventory_officer', 'sales_rep']) {
      m.getServerSession.mockResolvedValue(session(role))
      const res = await depositReceipt(pay(), params('dep-1'))
      expect(res.status).toBe(403)
    }
    expect(m.addDepositReceipt).not.toHaveBeenCalled()
  })

  it('finance can record a receipt', async () => {
    m.getServerSession.mockResolvedValue(session('finance_officer'))
    const res = await depositReceipt(pay(), params('dep-1'))
    expect(res.status).toBe(200)
    expect(m.addDepositReceipt).toHaveBeenCalledOnce()
  })
})
