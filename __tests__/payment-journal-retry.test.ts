import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ attempts: 0, journalCalls: 0, committed: [] as string[] }))

vi.mock('@/lib/accounting/journal-service', () => ({
  createJournalEntryInTx: vi.fn(async () => {
    h.journalCalls++
    if (h.journalCalls === 1) throw Object.assign(new Error('Transaction failed due to a write conflict or a deadlock. Please retry your transaction'), { code: 'P2034' })
    return { id: 'journal-1' }
  }),
}))
vi.mock('@/lib/prisma', () => {
  const tx = {
    payment: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: 'pay-1', ...data })),
      update: vi.fn(async ({ data }: any) => { if (data.postingStatus) h.committed.push(data.postingStatus); return {} }),
    },
    paymentAllocation: { create: vi.fn(async ({ data }: any) => ({ id: 'a1', ...data })), findMany: vi.fn(async () => []) },
    invoice: { findMany: vi.fn(async () => [{ id: 'inv-1', totalAmount: 1000, status: 'approved', paymentBlocked: false }]), update: vi.fn(async () => ({})) },
  }
  return {
    default: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
        h.attempts++
        h.committed = []
        return fn(tx)
      }),
    },
  }
})

import { recordPaymentWithAllocations } from '@/lib/accounting/payment-allocations'

describe('payment journal posting under a write conflict', () => {
  it('retries the whole payment instead of saving it without its ledger entry', async () => {
    const out = await recordPaymentWithAllocations({
      amount: 500, paymentMethod: 'mpesa', createdById: 'u1', invoiceId: 'inv-1',
      allocations: [{ invoiceId: 'inv-1', amount: 500 }],
      journal: id => ({ ref: `JRN/PAY/INV/1/${id}`, journalCode: 'CSH', date: new Date(), description: 'x', lines: [] as any[] }),
    })
    expect(h.attempts).toBe(2)
    expect(h.committed).toEqual(['posted'])
    expect(out.payment.id).toBe('pay-1')
  })
})
