import { describe, expect, it } from 'vitest'
import { applyReversalToInvoices, keepReversedPaymentsOff, reversalBlockedForMethod, reversalJournalForStore } from '@/lib/accounting/payment-reversal'
import { reconcileAgentCommissions, type AgentCommission, type EvaluatedSale } from '@/lib/agents/agent-commissions'

const info = { paymentId: 'pay-1', amount: 42000, reason: 'Customer paid 15,000', reversedAt: '2026-10-06T10:00:00.000Z', reversedBy: 'Finance' }
const invoice = () => ({
  id: 'inv-1', ref: 'INV/2026/0100', status: 'posted', total: 42000, amountPaid: 42000, notes: '',
  payments: [{ id: 'pay-1', amount: 42000, method: 'mpesa', date: '2026-10-05', recordedBy: 'Finance' }],
})

describe('payment reversal — invoice screen copy', () => {
  it('moves the payment to reversed payments and sets what is still paid', () => {
    const [inv] = applyReversalToInvoices([invoice()], info, { 'inv-1': 0 })
    expect(inv.amountPaid).toBe(0)
    expect(inv.payments).toEqual([])
    expect(inv.voidedPayments).toHaveLength(1)
    expect(inv.voidedPayments[0]).toMatchObject({ id: 'pay-1', amount: 42000, method: 'mpesa', reversalReason: 'Customer paid 15,000', reversedBy: 'Finance' })
    expect(inv.notes).toContain('Payment of KES 42,000 reversed by Finance: Customer paid 15,000')
  })

  it('is idempotent and leaves other invoices alone', () => {
    const other = { id: 'inv-2', amountPaid: 5, payments: [] }
    const once = applyReversalToInvoices([invoice(), other], info, { 'inv-1': 0 })
    const twice = applyReversalToInvoices(once, info, { 'inv-1': 0 })
    expect(twice[0].voidedPayments).toHaveLength(1)
    expect(twice[0].notes).toBe(once[0].notes)
    expect(twice[1]).toBe(other)
  })

  it('a stale tab cannot bring the reversed payment back', () => {
    const server = applyReversalToInvoices([invoice()], info, { 'inv-1': 0 })
    const stale = [{ ...invoice(), notes: 'edited elsewhere' }]
    const [kept] = keepReversedPaymentsOff(server, stale) as any[]
    expect(kept.payments).toEqual([])
    expect(kept.amountPaid).toBe(0)
    expect(kept.voidedPayments).toHaveLength(1)
    expect(kept.notes).toBe('edited elsewhere')
    // A new, correct payment registered after the reversal survives.
    const fresh = [{ ...server[0], amountPaid: 15000, payments: [{ id: 'pay-2', amount: 15000 }] }]
    expect((keepReversedPaymentsOff(server, fresh) as any[])[0]).toMatchObject({ amountPaid: 15000, payments: [{ id: 'pay-2' }] })
  })

  it('builds the reversal journal for the screen copy once', () => {
    const journals = [{ id: 'j1', ref: 'JRN/PAY/INV/2026/0100/pay-1', description: 'Payment', totalDebit: 42000, totalCredit: 42000, lines: [
      { account: '2211 - Petty Cash / Mobile Money', description: 'Received', debit: 42000, credit: 0 },
      { account: '1800 - Accounts Receivable', description: 'AR', debit: 0, credit: 42000 },
    ] }]
    const rev = reversalJournalForStore(journals, 'JRN/PAY/INV/2026/0100/pay-1', 'REV/JRN/PAY/INV/2026/0100/pay-1', 'wrong amount', info.reversedAt)!
    expect(rev.ref).toBe('REV/JRN/PAY/INV/2026/0100/pay-1')
    expect(rev.lines.map((l: any) => [l.account, l.debit, l.credit])).toEqual([
      ['2211 - Petty Cash / Mobile Money', 0, 42000],
      ['1800 - Accounts Receivable', 42000, 0],
    ])
    expect(reversalJournalForStore([...journals, rev], 'JRN/PAY/INV/2026/0100/pay-1', rev.ref, 'x', info.reversedAt)).toBeNull()
  })

  it('leaves credit and deposit applications to their own reversal', () => {
    expect(reversalBlockedForMethod('method:customer_credit')).toMatch(/credit note/)
    expect(reversalBlockedForMethod('idempotency:x · method:deposit_apply')).toMatch(/deposit/)
    expect(reversalBlockedForMethod('idempotency:abc')).toBeNull()
  })
})

describe('agent commission after a reversed customer payment', () => {
  const now = '2026-10-06T10:00:00.000Z'
  const row: AgentCommission = {
    id: 'sale_order:so-1', sourceKind: 'sale_order', sourceId: 'so-1', sourceRef: 'SO/0001', agentId: 'a', agentName: 'Jane',
    customerName: 'Acme', saleTotal: 42000, amount: 2000, status: 'due', earnedAt: '2026-10-05', journalRef: 'JRN/AGC/SO/0001',
    createdAt: now, updatedAt: now,
  }
  const ev = (state: EvaluatedSale['state']): EvaluatedSale => ({
    id: row.id, sourceKind: 'sale_order', sourceId: 'so-1', sourceRef: 'SO/0001', agentId: 'a', agentName: 'Jane', amount: 2000,
    customerName: 'Acme', saleTotal: 42000, state, earnedAt: state === 'earned' ? '2026-10-07' : undefined,
  })

  it('goes back to pending with the accrual reversed, and earns again under a new ref', () => {
    const back = reconcileAgentCommissions({ existing: [row], evaluated: [ev('pending')], now })
    expect(back.journals.map(j => [j.kind, j.ref])).toEqual([['reverse', 'JRN/AGC-REV/SO/0001']])
    const pending = back.journals[0].afterJournal(back.rows)
    expect(pending[0]).toMatchObject({ status: 'pending', accruals: 1, journalRef: undefined })

    const again = reconcileAgentCommissions({ existing: pending, evaluated: [ev('earned')], now })
    expect(again.journals.map(j => j.ref)).toEqual(['JRN/AGC/SO/0001/1'])
    expect(again.journals[0].afterJournal(again.rows)[0]).toMatchObject({ status: 'due', accruals: 2 })
  })

  it('a commission already paid out is flagged, not touched', () => {
    const out = reconcileAgentCommissions({ existing: [{ ...row, status: 'paid' }], evaluated: [ev('pending')], now })
    expect(out.journals).toEqual([])
    expect(out.rows[0].flag).toMatch(/payment reversed/)
  })
})
