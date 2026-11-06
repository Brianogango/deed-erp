/**
 * The rider marks "the customer paid me my delivery fee": the trip records it
 * and the invoice is settled automatically (Dr rider fee / Cr receivable).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ state: {} as Record<string, any>, payments: [] as any[], invoice: null as any }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => {
  const read = async (keys: string[]) => Object.fromEntries(keys.map(k => [k, h.state[k] ? JSON.parse(JSON.stringify(h.state[k])) : undefined]))
  return {
    loadAppState: read,
    loadAppStateForWrite: read,
    saveStoreKeys: async (e: Record<string, string>) => { for (const [k, v] of Object.entries(e)) h.state[k] = JSON.parse(v) },
    withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
    notifyStoreKeysChanged: async () => {},
  }
})
vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: async () => ({ ok: true }) }))
vi.mock('@/lib/notifications/service', () => ({ publishNotificationEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/prisma', () => ({
  default: {
    invoice: {
      findUnique: vi.fn(async () => h.invoice && { ...h.invoice }),
      update: vi.fn(async ({ data }: any) => { Object.assign(h.invoice, data); return h.invoice }),
    },
    accountCode: { findMany: vi.fn(async () => [{ code: '6519' }]) },
  },
}))
vi.mock('@/lib/accounting/payment-allocations', () => ({
  recordPaymentWithAllocations: vi.fn(async (opts: any) => {
    const dup = h.payments.find(p => p.idempotencyKey === opts.idempotencyKey)
    if (dup) return { payment: dup, allocations: [], idempotent: true }
    const journal = opts.journal('pay-1')
    h.payments.push({ ...opts, journal })
    h.invoice.amountPaid = Number(h.invoice.amountPaid) + opts.amount
    return { payment: { id: 'pay-1' }, allocations: [], idempotent: false }
  }),
}))

import { applyCustomerPaidRider, paidToRiderPaymentId } from '@/lib/delivery/rider-direct-pay.server'

beforeEach(() => {
  h.payments = []
  h.invoice = { id: 'inv-1', invoiceNumber: 'INV/0007', status: 'approved', totalAmount: 5300, amountPaid: 5000, paymentBlocked: false, createdById: 'u-1', clientId: 'c-1', currencyCode: 'KES', exchangeRateToBase: 1 }
  h.state = {
    deed_deliveryJobs: [{ id: 'j1', ref: 'DLV/0001', status: 'in_transit', riderId: 'r1', riderName: 'Otieno', riderFee: 250, deliveryFee: 300, invoiceId: 'inv-1' }],
    deed_riderWeeklyPays: [],
    deed_invoices: [{ id: 'inv-1', ref: 'INV/0007', type: 'customer_invoice', status: 'posted', total: 5300, amountPaid: 5000 }],
  }
})

describe('rider marks the delivery fee paid to them', () => {
  it('records it, settles the invoice, and nets the pay', async () => {
    const out = await applyCustomerPaidRider('j1', { amount: 300, method: 'mpesa', reference: 'QX1' }, { by: 'Otieno', maxSettle: 300, capToCharge: true }) as any
    expect(out.ok).toBe(true)
    expect(out.settle).toMatchObject({ settled: 300, invoiceRef: 'INV/0007' })
    expect(h.payments).toHaveLength(1)
    expect(h.payments[0]).toMatchObject({ amount: 300, paymentMethod: 'paid_to_rider', idempotencyKey: paidToRiderPaymentId('j1') })
    expect(h.payments[0].journal.lines.map((l: any) => [l.accountLabel, l.debit, l.credit])).toEqual([
      ['6519 - Courier and Delivery', 300, 0],
      [expect.stringMatching(/^1800/), 0, 300],
    ])
    const job = h.state.deed_deliveryJobs[0]
    expect(job.customerPaidRider).toMatchObject({ amount: 300, method: 'mpesa', by: 'Otieno', invoiceRef: 'INV/0007', settled: 300 })
    expect(h.state.deed_invoices[0].amountPaid).toBe(5300)
  })

  it('a second tap changes nothing', async () => {
    await applyCustomerPaidRider('j1', { amount: 300, method: 'cash' }, { by: 'Otieno', maxSettle: 300, capToCharge: true })
    const again = await applyCustomerPaidRider('j1', { amount: 300, method: 'cash' }, { by: 'Otieno', maxSettle: 300, capToCharge: true })
    expect(again).toMatchObject({ ok: false })
    expect(h.payments).toHaveLength(1)
  })

  it('refuses more than the delivery charge from the rider link', async () => {
    expect(await applyCustomerPaidRider('j1', { amount: 1000, method: 'cash' }, { by: 'Otieno', maxSettle: 1000, capToCharge: true })).toMatchObject({ ok: false })
    expect(h.payments).toHaveLength(0)
  })

  it('an unposted invoice: pay is still netted, the invoice waits for the office', async () => {
    h.invoice.status = 'draft'
    h.state.deed_invoices[0].status = 'draft'
    const out = await applyCustomerPaidRider('j1', { amount: 300, method: 'cash' }, { by: 'Otieno', maxSettle: 300, capToCharge: true }) as any
    expect(out.ok).toBe(true)
    expect(out.settle.settled).toBe(0)
    expect(h.state.deed_deliveryJobs[0].customerPaidRider).toMatchObject({ amount: 300, pending: 'INV/0007 is not posted yet' })
    expect(h.payments).toHaveLength(0)
  })

  it('refuses a trip already in a pay run', async () => {
    h.state.deed_riderWeeklyPays = [{ ref: 'RP/1', jobIds: ['j1'] }]
    expect(await applyCustomerPaidRider('j1', { amount: 300, method: 'cash' }, { by: 'Otieno', maxSettle: 300 })).toMatchObject({ ok: false, status: 409 })
  })
})
