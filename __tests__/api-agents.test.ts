import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  journals: [] as Array<{ ref: string; journalCode: string; lines: Array<{ accountLabel: string; debit: number; credit: number }> }>,
  requireRole: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/api', () => ({
  getRequiredSession: vi.fn(async () => ({ user: { id: 'u-1' } })),
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try { return await handler() } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status, headers: { 'Content-Type': 'application/json' } })
    }
  },
  requireRole: h.requireRole,
}))
vi.mock('@/lib/server-store', () => {
  const read = async (keys: string[]) => Object.fromEntries(keys.map(k => [k, h.state[k]]))
  return {
    loadAppState: read,
    loadAppStateForWrite: read,
    saveStoreKeys: async (entries: Record<string, string>) => {
      for (const [k, v] of Object.entries(entries)) h.state[k] = JSON.parse(v)
    },
    withAppStateKeyLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  }
})
vi.mock('@/lib/accounting/journal-service', () => ({
  createJournalEntry: vi.fn(async (entry: any) => {
    if (entry.skipIfExists && h.journals.some(j => j.ref === entry.ref)) return
    h.journals.push(entry)
  }),
}))
vi.mock('@/lib/accounting/ensure-template-accounts', () => ({ ensureTemplateAccounts: vi.fn(async () => undefined) }))
vi.mock('@/lib/accounting/coa-roles', () => ({
  labelForRole: (role: string) => (role === 'bank_absa' ? '2201 - ABSA Bank' : '2211 - Petty Cash / Mobile Money'),
}))
vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      findMany: vi.fn(async () => [{ id: 'agent-1', name: 'Jane Agent', phone: '0700', email: null, kraPin: null }]),
      findFirst: vi.fn(async ({ where }: any) => (where.id === 'agent-1' ? { name: 'Jane Agent' } : null)),
    },
    accountCode: { findUnique: vi.fn(async () => null) },
  },
}))

import { GET, PUT } from '@/app/api/agents/route'
import { POST as PAY } from '@/app/api/agents/payouts/route'
import { GET as GET_ASSIGN, PUT as ASSIGN } from '@/app/api/agents/assign/route'

const json = (body: unknown, method = 'POST') => new Request('http://localhost/api/agents', {
  method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
})
const debitOf = (j: (typeof h.journals)[number], code: string) => j.lines.filter(l => l.accountLabel.startsWith(code)).reduce((s, l) => s + l.debit - l.credit, 0)

beforeEach(() => {
  h.journals.length = 0
  h.state = {
    deed_saleOrders: [{ id: 'so-1', ref: 'SO/0001', status: 'sale', total: 50000, customerName: 'Acme', agentId: 'agent-1', agentName: 'Jane Agent', agentCommission: 2000 }],
    deed_posOrders: [],
    deed_invoices: [{ id: 'inv-1', saleOrderId: 'so-1', status: 'posted', total: 50000, amountPaid: 20000, date: '2026-10-01' }],
  }
  h.requireRole.mockResolvedValue({ id: 'u-1', name: 'Finance', username: 'finance', role: 'finance_officer' })
})

describe('agent commissions API', () => {
  it('only directors and finance officers may open it', async () => {
    h.requireRole.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))
    expect((await GET()).status).toBe(403)
    expect(h.requireRole).toHaveBeenCalledWith(['director', 'finance_officer'])
  })

  it('keeps the commission pending until the customer has paid in full, then posts it once', async () => {
    let body = await (await GET()).json()
    expect(body.commissions).toHaveLength(1)
    expect(body.commissions[0].status).toBe('pending')
    expect(h.journals).toHaveLength(0)

    ;(h.state.deed_invoices as any[])[0].amountPaid = 50000
    body = await (await GET()).json()
    expect(body.commissions[0].status).toBe('due')
    expect(h.journals.map(j => j.ref)).toEqual(['JRN/AGC/SO/0001'])
    expect(debitOf(h.journals[0], '6403')).toBe(2000)
    expect(debitOf(h.journals[0], '3314')).toBe(-2000)

    await GET()
    expect(h.journals).toHaveLength(1)
  })

  it('pays due lines by M-Pesa: Dr payable, Cr mobile money, lines marked paid', async () => {
    ;(h.state.deed_invoices as any[])[0].amountPaid = 50000
    await GET()
    const res = await PAY(json({ agentId: 'agent-1', commissionIds: ['sale_order:so-1'], method: 'mpesa', reference: 'SJK12AB', paidAt: '2026-10-05' }))
    expect(res.status).toBe(201)
    const { payout } = await res.json()
    expect(payout).toMatchObject({ ref: 'AGP/0001', gross: 2000, withholdingTax: 0, net: 2000, paidBy: 'Finance' })
    const journal = h.journals.find(j => j.ref === 'JRN/AGP/0001')!
    expect(journal.journalCode).toBe('CSH')
    expect(debitOf(journal, '3314')).toBe(2000)
    expect(debitOf(journal, '2211')).toBe(-2000)
    expect((h.state.deed_agentCommissions as any[])[0].status).toBe('paid')

    const again = await PAY(json({ agentId: 'agent-1', commissionIds: ['sale_order:so-1'], method: 'mpesa', reference: 'SJK12AC', paidAt: '2026-10-05' }))
    expect(again.status).toBe(409)
  })

  it('withholds tax when switched on', async () => {
    expect((await PUT(json({ withholdingEnabled: true, withholdingRate: 5 }, 'PUT'))).status).toBe(200)
    ;(h.state.deed_invoices as any[])[0].amountPaid = 50000
    const res = await PAY(json({ agentId: 'agent-1', commissionIds: ['sale_order:so-1'], method: 'bank', reference: 'TRF1', paidAt: '2026-10-05' }))
    const { payout } = await res.json()
    expect(payout).toMatchObject({ gross: 2000, withholdingTax: 100, net: 1900 })
    const journal = h.journals.find(j => j.ref === 'JRN/AGP/0001')!
    expect(journal.journalCode).toBe('BNK')
    expect(debitOf(journal, '2201')).toBe(-1900)
    expect(debitOf(journal, '3307')).toBe(-100)
  })

  it('requires the M-Pesa code', async () => {
    const res = await PAY(json({ agentId: 'agent-1', commissionIds: ['x'], method: 'mpesa', reference: '', paidAt: '2026-10-05' }))
    expect(res.status).toBe(422)
  })

  it('a refund after payout is recovered from the next payout', async () => {
    ;(h.state.deed_invoices as any[])[0].amountPaid = 50000
    await PAY(json({ agentId: 'agent-1', commissionIds: ['sale_order:so-1'], method: 'cash', reference: '', paidAt: '2026-10-05' }))
    ;(h.state.deed_invoices as any[]).push({ id: 'cn-1', isCreditNote: true, sourceInvoiceId: 'inv-1', total: -50000, status: 'posted' })
    const body = await (await GET()).json()
    const clawback = body.commissions.find((r: any) => r.amount < 0)
    expect(clawback).toMatchObject({ amount: -2000, status: 'due' })
    expect(h.journals.some(j => j.ref === 'JRN/AGC-CLAW/SO/0001')).toBe(true)
  })

  it('an agent set on a sale order through /assign earns once paid, and is then locked', async () => {
    const so = (h.state.deed_saleOrders as any[])[0]
    delete so.agentId; delete so.agentName; delete so.agentCommission
    expect((await ASSIGN(json({ saleOrderId: 'so-1', agentId: 'nobody', agentCommission: 10 }, 'PUT'))).status).toBe(422)
    expect((await ASSIGN(json({ saleOrderId: 'so-1', agentId: 'agent-1', agentCommission: 2500 }, 'PUT'))).status).toBe(200)
    const got = await (await GET_ASSIGN(new Request('http://localhost/api/agents/assign?saleOrderId=so-1'))).json()
    expect(got.agent).toMatchObject({ agentId: 'agent-1', agentName: 'Jane Agent', agentCommission: 2500, setByName: 'Finance' })

    ;(h.state.deed_invoices as any[])[0].amountPaid = 50000
    const body = await (await GET()).json()
    expect(body.commissions[0]).toMatchObject({ amount: 2500, status: 'due', agentName: 'Jane Agent' })
    expect((await ASSIGN(json({ saleOrderId: 'so-1', agentId: '' }, 'PUT'))).status).toBe(409)
  })
})
