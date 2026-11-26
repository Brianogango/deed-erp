import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/expenses/actions { action: 'cancel' } — an approved duplicate
// claim is cancelled and its approval journal reversed; nothing else posts.
const store = { expenses: [] as any[], saved: null as any[] | null }
const journals = new Set<string>()
const reversePosting = vi.fn(async (_ref: string, _user?: string) => ({ ref: 'REV' }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/api', () => ({
  getRequiredSession: vi.fn(async () => ({ user: { id: 'f1', name: 'Faith', role: 'finance_officer' } })),
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try { return await handler() } catch (err: any) {
      return new Response(JSON.stringify({ error: err?.message }), { status: typeof err?.status === 'number' ? err.status : 500 })
    }
  },
}))
vi.mock('@/lib/auth/can', () => ({ userCan: () => true }))
vi.mock('@/lib/finance-controls', () => ({ canReviewExpense: () => true, canReimburseExpense: () => true }))
vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: async () => ({ ok: true }) }))
vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: async () => 'X' }))
vi.mock('@/lib/server-store', () => ({
  loadAppStateForWrite: async () => ({ deed_expenses: store.expenses }),
  saveStoreKeys: async (e: Record<string, string>) => { store.saved = JSON.parse(e.deed_expenses) },
  withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/prisma', () => ({
  default: {
    journalEntry: { findUnique: async ({ where }: any) => (journals.has(where.ref) ? { id: 'j1' } : null), findFirst: async () => null },
    approvalRule: { findUnique: async () => null },
  },
}))
vi.mock('@/lib/accounting/posting-service', () => ({
  commitPosting: vi.fn(), postExpenseApproval: vi.fn(), postExpenseCompanyPayment: vi.fn(), postExpenseReimbursement: vi.fn(),
  reversePosting: (ref: string, user?: string) => reversePosting(ref, user),
}))

const { POST } = await import('@/app/api/expenses/actions/route')
const call = (body: unknown) => POST(new Request('http://x/api/expenses/actions', { method: 'POST', body: JSON.stringify(body) }))
const claim = (over: any = {}) => ({ id: 'c1', ref: 'EXP/0042', status: 'approved', amount: 5000, category: 'transport', description: 'Fuel',
  expenseDate: '2026-11-20', paymentMethod: 'reimbursement', submittedByUserId: 'u1', submittedByName: 'Jane', ...over })

beforeEach(() => { store.expenses = [claim()]; store.saved = null; journals.clear(); reversePosting.mockClear() })

describe('cancel action', () => {
  it('reverses the approval journal and saves the claim as cancelled', async () => {
    journals.add('JRN/EXP/EXP/0042')
    const res = await call({ action: 'cancel', id: 'c1', reason: 'Duplicate — funds already given' })
    expect(res.status).toBe(200)
    expect(reversePosting).toHaveBeenCalledWith('JRN/EXP/EXP/0042', 'f1')
    expect(store.saved![0]).toMatchObject({ status: 'cancelled', cancelReason: 'Duplicate — funds already given' })
  })

  it('cancels an approved claim that has no approval journal without reversing anything', async () => {
    const res = await call({ action: 'cancel', id: 'c1', reason: 'Duplicate' })
    expect(res.status).toBe(200)
    expect(reversePosting).not.toHaveBeenCalled()
  })

  it('refuses a paid claim and changes nothing', async () => {
    store.expenses = [claim({ status: 'paid' })]
    const res = await call({ action: 'cancel', id: 'c1', reason: 'Duplicate' })
    expect(res.status).toBe(422)
    expect(reversePosting).not.toHaveBeenCalled()
    expect(store.saved).toBeNull()
  })

  it('deletes a cancelled claim by hiding it', async () => {
    store.expenses = [claim({ status: 'cancelled' })]
    const res = await call({ action: 'delete', id: 'c1' })
    expect(res.status).toBe(200)
    expect(store.saved![0].deletedAt).toBeTruthy()
  })
})
