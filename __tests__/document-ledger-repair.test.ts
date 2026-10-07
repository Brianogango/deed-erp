import { describe, expect, it } from 'vitest'
import { planExtraPaymentEntries } from '@/lib/accounting/document-ledger-repair'

const pid = '11111111-2222-3333-4444-555555555555'
const e = (id: string, ref: string, amount: number, createdAt: string, paymentId: string | null = null) => ({ id, ref, paymentId, amount, createdAt })

describe('planExtraPaymentEntries', () => {
  it('keeps the entry carrying the payment id and reverses the copies', () => {
    const plan = planExtraPaymentEntries({
      invoiceId: 'i', ref: 'INV/2026/0241',
      payments: [{ id: pid, amount: 126000 }],
      entries: [
        e('a', 'JRN/PAY/INV/2026/0241/aaaaaaaa', 126000, '2026-09-18T10:00'),
        e('b', `JRN/PAY/INV/2026/0241/${pid}`, 126000, '2026-09-18T10:01'),
        e('c', 'JRN/PAY/INV/2026/0241/bbbbbbbb', 126000, '2026-09-18T10:02'),
        e('d', 'JRN/PAY/INV/2026/0241/cccccccc', 126000, '2026-09-19T10:00'),
      ],
    })
    expect(plan?.reverse.map(r => r.ref).sort()).toEqual(['JRN/PAY/INV/2026/0241/aaaaaaaa', 'JRN/PAY/INV/2026/0241/bbbbbbbb', 'JRN/PAY/INV/2026/0241/cccccccc'])
  })

  it('keeps the oldest same-amount entry when no entry carries the payment id', () => {
    const plan = planExtraPaymentEntries({
      invoiceId: 'i', ref: 'X', payments: [{ id: pid, amount: 500 }],
      entries: [e('a', 'JRN/PAY/X/1', 500, '2026-09-01'), e('b', 'JRN/PAY/X/2', 500, '2026-09-02')],
    })
    expect(plan?.reverse).toEqual([{ ref: 'JRN/PAY/X/2', amount: 500 }])
  })

  it('never reverses past the excess (part payments)', () => {
    const plan = planExtraPaymentEntries({
      invoiceId: 'i', ref: 'INV/2026/0234',
      payments: [{ id: pid, amount: 16000 }],
      entries: [e('a', `JRN/PAY/INV/2026/0234/${pid}`, 16000, '2026-09-15'), e('b', 'JRN/PAY/INV/2026/0234/zz', 16000, '2026-09-16')],
    })
    expect(plan?.reverse).toEqual([{ ref: 'JRN/PAY/INV/2026/0234/zz', amount: 16000 }])
    expect(planExtraPaymentEntries({
      invoiceId: 'i', ref: 'Y', payments: [{ id: pid, amount: 1000 }],
      entries: [e('a', 'JRN/PAY/Y/1', 1000, '2026-09-01'), e('b', 'JRN/PAY/Y/2', 3000, '2026-09-02')],
    })).toBeNull()
  })

  it('leaves documents with no payment recorded alone', () => {
    expect(planExtraPaymentEntries({
      invoiceId: 'i', ref: 'INV/2026/0293', payments: [],
      entries: [e('a', 'JRN/PAY/INV/2026/0293/x', 14000, '2026-10-02')],
    })).toBeNull()
  })
})
