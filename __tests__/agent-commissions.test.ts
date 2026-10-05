import { describe, expect, it } from 'vitest'
import {
  AGENT_COMMISSION_EXPENSE,
  AGENT_COMMISSIONS_PAYABLE,
  WITHHOLDING_TAX_PAYABLE,
  commissionJournalLines,
  evaluateAgentSales,
  payoutJournalLines,
  planAgentPayout,
  reconcileAgentCommissions,
  type AgentCommission,
} from '@/lib/agents/agent-commissions'

const NOW = '2026-10-05T10:00:00.000Z'
const so = (over: Record<string, unknown> = {}) => ({ id: 'so1', ref: 'SO/0001', status: 'sale', total: 50000, customerName: 'Jane', agentId: 'ag1', agentName: 'Kevin', agentCommission: 2000, ...over })
const inv = (over: Record<string, unknown> = {}) => ({ id: 'inv1', saleOrderId: 'so1', status: 'posted', total: 50000, amountPaid: 0, date: '2026-10-01', ...over })
const run = (existing: AgentCommission[], sale: Record<string, unknown>, invoices: Array<Record<string, unknown>>) => {
  const evaluated = evaluateAgentSales({ saleOrders: [sale], posOrders: [], invoices, today: '2026-10-05' })
  const out = reconcileAgentCommissions({ existing, evaluated, now: NOW })
  // The server applies each journal's follow-up once the journal posts.
  return { ...out, applied: out.journals.reduce((rows, j) => j.afterJournal(rows), out.rows) }
}

describe('earned only when the customer has paid in full', () => {
  it('no payment / part payment → pending, nothing booked', () => {
    const a = run([], so(), [inv()])
    expect(a.applied[0]).toMatchObject({ status: 'pending', amount: 2000 })
    expect(a.journals).toEqual([])
    const b = run(a.applied, so(), [inv({ amountPaid: 30000 })])
    expect(b.applied[0].status).toBe('pending')
  })

  it('paid in full → due, Dr 6403 / Cr 3314 dated on the payment', () => {
    const { applied, journals } = run([], so(), [inv({ amountPaid: 50000, paidDate: '2026-10-03' })])
    expect(applied[0]).toMatchObject({ status: 'due', earnedAt: '2026-10-03', journalRef: 'JRN/AGC/SO/0001' })
    expect(journals[0]).toMatchObject({ kind: 'earn', date: '2026-10-03', amount: 2000 })
    expect(commissionJournalLines(journals[0]).map(l => [l.accountLabel, l.debit, l.credit])).toEqual([
      [AGENT_COMMISSION_EXPENSE, 2000, 0], [AGENT_COMMISSIONS_PAYABLE, 0, 2000],
    ])
  })

  it('paid across several invoices (deposit + balance) counts the total', () => {
    const { applied } = run([], so(), [inv({ id: 'a', total: 20000, amountPaid: 20000 }), inv({ id: 'b', total: 30000, amountPaid: 30000 })])
    expect(applied[0].status).toBe('due')
  })

  it('a sale without an agent or an amount earns nothing', () => {
    expect(run([], so({ agentId: undefined }), [inv({ amountPaid: 50000 })]).applied).toEqual([])
    expect(run([], so({ agentCommission: 0 }), [inv({ amountPaid: 50000 })]).applied).toEqual([])
  })

  it('a running sync posts nothing twice', () => {
    const first = run([], so(), [inv({ amountPaid: 50000 })])
    const second = run(first.applied, so(), [inv({ amountPaid: 50000 })])
    expect(second.journals).toEqual([])
  })
})

describe('refunds', () => {
  const due = () => run([], so(), [inv({ amountPaid: 50000 })]).applied

  it('full refund before payout → cancelled, accrual reversed', () => {
    const { applied, journals } = run(due(), so(), [inv({ amountPaid: 50000 }), { id: 'cn1', isCreditNote: true, sourceInvoiceId: 'inv1', total: -50000, status: 'posted' }])
    expect(applied[0].status).toBe('cancelled')
    expect(journals[0].kind).toBe('reverse')
    expect(commissionJournalLines(journals[0]).map(l => [l.accountLabel, l.debit, l.credit])).toEqual([
      [AGENT_COMMISSIONS_PAYABLE, 2000, 0], [AGENT_COMMISSION_EXPENSE, 0, 2000],
    ])
  })

  it('full refund after payout → a negative line the next payout deducts', () => {
    const paid = due().map(r => ({ ...r, status: 'paid' as const, payoutId: 'p1' }))
    const { applied, journals } = run(paid, so({ status: 'cancelled' }), [inv({ amountPaid: 50000 })])
    expect(journals[0].kind).toBe('clawback')
    const claw = applied.find(r => r.clawbackOf)
    expect(claw).toMatchObject({ amount: -2000, status: 'due', agentId: 'ag1' })
    // …and only once.
    expect(run(applied, so({ status: 'cancelled' }), [inv({ amountPaid: 50000 })]).journals).toEqual([])
  })

  it('partial refund → flagged for Finance, commission left as it is', () => {
    const { applied, journals } = run(due(), so(), [inv({ amountPaid: 50000 }), { id: 'cn1', isCreditNote: true, sourceInvoiceId: 'inv1', total: -10000, status: 'posted' }])
    expect(applied[0].status).toBe('due')
    expect(applied[0].flag).toMatch(/Partly refunded/)
    expect(journals).toEqual([])
  })

  it('agent removed from a pending sale → line disappears; from a due sale → reversed', () => {
    const pending = run([], so(), [inv()]).applied
    expect(run(pending, so({ agentId: undefined }), [inv()]).applied).toEqual([])
    const { journals } = run(due(), so({ agentId: undefined }), [inv({ amountPaid: 50000 })])
    expect(journals[0].kind).toBe('reverse')
  })

  it('agent or amount changed after earning is not applied — and is flagged', () => {
    const { applied, journals } = run(due(), so({ agentCommission: 5000 }), [inv({ amountPaid: 50000 })])
    expect(applied[0].amount).toBe(2000)
    expect(applied[0].flag).toMatch(/changed after it was earned/)
    expect(journals).toEqual([])
  })
})

describe('POS sales', () => {
  it('a POS ticket is paid at the till → due on the sale date', () => {
    const evaluated = evaluateAgentSales({
      saleOrders: [],
      posOrders: [{ id: 'pos1', ref: 'POS/0001', total: 30000, date: '2026-10-04', agentId: 'ag1', agentName: 'Kevin', agentCommission: 1000, invoiceId: 'pinv' }],
      invoices: [{ id: 'pinv', status: 'posted', total: 30000, amountPaid: 30000 }],
      today: '2026-10-05',
    })
    expect(evaluated[0]).toMatchObject({ state: 'earned', earnedAt: '2026-10-04', sourceKind: 'pos_order' })
  })
})

describe('payouts', () => {
  const row = (id: string, amount: number, over: Partial<AgentCommission> = {}): AgentCommission => ({
    id, sourceKind: 'sale_order', sourceId: id, sourceRef: id, agentId: 'ag1', agentName: 'Kevin', customerName: 'x', saleTotal: 1,
    amount, status: 'due', createdAt: NOW, updatedAt: NOW, ...over,
  })

  it('pays the chosen lines, always netting what the agent owes back', () => {
    const plan = planAgentPayout({ rows: [row('a', 2000), row('b', 1500), row('claw', -500, { clawbackOf: 'old' })], agentId: 'ag1', commissionIds: ['a', 'b'], settings: { withholdingEnabled: false, withholdingRate: 5 } })
    expect(plan).toMatchObject({ gross: 3000, withholdingTax: 0, net: 3000 })
    expect(plan.lines.map(l => l.id).sort()).toEqual(['a', 'b', 'claw'])
  })

  it('withholding tax when switched on', () => {
    const plan = planAgentPayout({ rows: [row('a', 2000)], agentId: 'ag1', commissionIds: ['a'], settings: { withholdingEnabled: true, withholdingRate: 5 } })
    expect(plan).toMatchObject({ gross: 2000, withholdingTax: 100, net: 1900 })
    expect(payoutJournalLines({ ...plan, bankLabel: '2211 - Petty Cash / Mobile Money', agentName: 'Kevin', ref: 'AGP/0001' }).map(l => [l.accountLabel, l.debit, l.credit])).toEqual([
      [AGENT_COMMISSIONS_PAYABLE, 2000, 0], ['2211 - Petty Cash / Mobile Money', 0, 1900], [WITHHOLDING_TAX_PAYABLE, 0, 100],
    ])
  })

  it('refuses lines that are not due to this agent, or a payout refunds wipe out', () => {
    expect(planAgentPayout({ rows: [row('a', 2000, { status: 'paid' })], agentId: 'ag1', commissionIds: ['a'], settings: { withholdingEnabled: false, withholdingRate: 5 } }).error).toBeTruthy()
    expect(planAgentPayout({ rows: [row('a', 2000, { agentId: 'other' })], agentId: 'ag1', commissionIds: ['a'], settings: { withholdingEnabled: false, withholdingRate: 5 } }).error).toBeTruthy()
    expect(planAgentPayout({ rows: [row('a', 500), row('c', -800, { clawbackOf: 'x' })], agentId: 'ag1', commissionIds: ['a'], settings: { withholdingEnabled: false, withholdingRate: 5 } }).error).toMatch(/Nothing to pay/)
  })
})
