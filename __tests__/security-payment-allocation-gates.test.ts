import { describe, it, expect, vi, beforeEach } from 'vitest'

// /api/payments allocation paths settle invoices through allocatePayment /
// recordPaymentWithAllocations. With a payer, both apply the same gates as
// POST /api/invoices/[id]/payments: posted invoices only, and over the SoD
// threshold the poster cannot also register the payment.
const m = vi.hoisted(() => ({ invoices: [] as any[], allocCreate: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => ({ loadAppState: vi.fn(async () => ({ deed_systemSettings: {} })) }))
vi.mock('@/lib/prisma', () => {
  const tx = {
    payment: {
      findUniqueOrThrow: vi.fn(async () => ({ id: 'pay-1', amount: 5_000_000, isVoided: false, allocations: [] })),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: 'pay-1', ...data })),
      update: vi.fn(),
    },
    paymentAllocation: { findMany: vi.fn(async () => []), create: (...a: unknown[]) => m.allocCreate(...a) },
    invoice: { findMany: vi.fn(async () => m.invoices), update: vi.fn(), findUnique: vi.fn() },
  }
  return { default: { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } }
})

import { allocatePayment, recordPaymentWithAllocations } from '@/lib/accounting/payment-allocations'

const inv = (o: Record<string, unknown>) => ({ id: 'inv-1', invoiceNumber: 'INV/1', totalAmount: 2_000_000, paymentBlocked: false, status: 'approved', postedById: 'poster', ...o })
const admin = { id: 'poster', role: 'admin_officer' }

beforeEach(() => { vi.clearAllMocks(); m.allocCreate.mockResolvedValue({ id: 'al-1' }) })

describe('allocation gates', () => {
  it('refuses to allocate to a draft or pending invoice', async () => {
    for (const status of ['draft', 'pending_approval', 'rejected']) {
      m.invoices = [inv({ status })]
      await expect(allocatePayment({ paymentId: 'pay-1', allocations: [{ invoiceId: 'inv-1', amount: 1000 }], payer: { id: 'other', role: 'finance_officer' } }))
        .rejects.toThrow(/Only posted invoices/)
    }
    expect(m.allocCreate).not.toHaveBeenCalled()
  })

  it('the poster of a large invoice cannot settle it themselves', async () => {
    m.invoices = [inv({})]
    await expect(allocatePayment({ paymentId: 'pay-1', allocations: [{ invoiceId: 'inv-1', amount: 1000 }], payer: admin }))
      .rejects.toThrow(/Segregation of duties/)
    await expect(recordPaymentWithAllocations({ amount: 1000, paymentMethod: 'cash', createdById: 'poster', allocations: [{ invoiceId: 'inv-1', amount: 1000 }], payer: admin }))
      .rejects.toThrow(/Segregation of duties/)
    expect(m.allocCreate).not.toHaveBeenCalled()
  })

  it('another finance user can settle the posted invoice', async () => {
    m.invoices = [inv({})]
    await allocatePayment({ paymentId: 'pay-1', allocations: [{ invoiceId: 'inv-1', amount: 1000 }], payer: { id: 'other', role: 'finance_officer' } })
    expect(m.allocCreate).toHaveBeenCalled()
  })
})
