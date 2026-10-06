import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  journals: [] as Array<{ ref: string; journalCode: string; lines: Array<{ accountLabel: string; debit: number; credit: number }> }>,
  requireRole: vi.fn(),
  objects: new Map<string, Buffer>(),
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
      findFirst: vi.fn(async ({ where }: any) => (where.id === 'agent-1' ? { id: 'agent-1', name: 'Jane Agent' } : null)),
    },
    accountCode: { findUnique: vi.fn(async () => null) },
  },
}))

vi.mock('@/lib/infra/object-store', () => ({
  putObject: vi.fn(async (input: any) => { h.objects.set(input.key, input.body); return { uri: input.key } }),
  getObject: vi.fn(async (_b: string, key: string) => h.objects.get(key) ?? null),
  deleteObject: vi.fn(async (_b: string, key: string) => { h.objects.delete(key) }),
}))

import { GET, PUT } from '@/app/api/agents/route'
import { GET as GET_BILL, POST as ADD_BILL, DELETE as CANCEL_BILL } from '@/app/api/agents/commissions/route'
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

describe('manual agent commission bills', () => {
  const pdf = () => new File([Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF')], 'agent invoice.pdf', { type: 'application/pdf' })
  const form = (fields: Record<string, string>, file?: File) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(fields)) f.append(k, v)
    if (file) f.append('file', file)
    return new Request('http://localhost/api/agents/commissions', { method: 'POST', body: f })
  }

  it('raises a bill with an attachment: due at once, Dr 6403 / Cr 3314, paid with the next payout', async () => {
    const res = await ADD_BILL(form({ agentId: 'agent-1', amount: '3500', date: '2026-10-06', saleRef: 'INV-77', description: 'Referral — Kisumu school' }, pdf()))
    expect(res.status).toBe(201)
    const { commission } = await res.json()
    expect(commission).toMatchObject({ id: 'AGB/0001', sourceKind: 'manual', status: 'due', amount: 3500, sourceRef: 'INV-77', agentName: 'Jane Agent' })
    expect(commission.attachment.name).toBe('agent_invoice.pdf')
    const journal = h.journals.find(j => j.ref === 'JRN/AGB/0001')!
    expect(debitOf(journal, '6403')).toBe(3500)
    expect(debitOf(journal, '3314')).toBe(-3500)

    const file = await GET_BILL(new Request('http://localhost/api/agents/commissions?file=AGB%2F0001'))
    expect(file.status).toBe(200)
    expect(file.headers.get('Content-Type')).toBe('application/pdf')

    // The sales sync leaves it alone, and it is paid like any other line.
    const body = await (await GET()).json()
    expect(body.commissions.find((r: any) => r.id === 'AGB/0001').status).toBe('due')
    const paid = await PAY(json({ agentId: 'agent-1', commissionIds: ['AGB/0001'], method: 'cash', reference: '', paidAt: '2026-10-06' }))
    expect((await paid.json()).payout.gross).toBe(3500)
    expect((await CANCEL_BILL(new Request('http://localhost/api/agents/commissions?id=AGB%2F0001', { method: 'DELETE' }))).status).toBe(409)
  })

  it('the attachment is optional; a JSON bill works too', async () => {
    const res = await ADD_BILL(json({ agentId: 'agent-1', amount: 1000, date: '2026-10-06' }))
    expect(res.status).toBe(201)
    const { commission } = await res.json()
    expect(commission.attachment).toBeUndefined()
    expect(commission.sourceRef).toBe('AGB/0001')
  })

  it('refuses a bill for a sale that already pays this agent, and non-agents', async () => {
    ;(h.state.deed_invoices as any[])[0].amountPaid = 50000
    await GET()
    expect((await ADD_BILL(json({ agentId: 'agent-1', amount: 500, date: '2026-10-06', saleRef: 'so/0001' }))).status).toBe(409)
    expect((await ADD_BILL(json({ agentId: 'someone', amount: 500, date: '2026-10-06' }))).status).toBe(422)
    expect((await ADD_BILL(json({ agentId: 'agent-1', amount: 0, date: '2026-10-06' }))).status).toBe(409)
  })

  it('refuses a disguised file and leaves no bill behind', async () => {
    const fake = new File([Buffer.from('MZ not a pdf')], 'x.pdf', { type: 'application/pdf' })
    expect((await ADD_BILL(form({ agentId: 'agent-1', amount: '100', date: '2026-10-06' }, fake))).status).toBe(415)
    expect(h.state.deed_agentCommissions).toBeUndefined()
  })

  it('cancels an unpaid bill by reversing its journal', async () => {
    await ADD_BILL(json({ agentId: 'agent-1', amount: 1200, date: '2026-10-06' }))
    const res = await CANCEL_BILL(new Request('http://localhost/api/agents/commissions?id=AGB%2F0001', { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect((await res.json()).commission.status).toBe('cancelled')
    const rev = h.journals.find(j => j.ref === 'JRN/AGB/0001-REV')!
    expect(debitOf(rev, '3314')).toBe(1200)
    expect(debitOf(rev, '6403')).toBe(-1200)
  })
})
