import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRequireRole, mockCheckFiscalLock, mockCreateJournal } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockCheckFiscalLock: vi.fn(),
  mockCreateJournal: vi.fn(),
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status })
    }
  },
  requireRole: mockRequireRole,
}))

vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: mockCheckFiscalLock }))
vi.mock('@/lib/accounting/journal-service', () => ({
  createJournalEntry: mockCreateJournal,
}))
vi.mock('@/lib/prisma', () => ({
  default: { journalEntry: { findMany: vi.fn() } },
}))

import { POST } from '@/app/api/accounting/journals/route'

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue({ id: 'u1', role: 'finance_officer' })
  mockCheckFiscalLock.mockResolvedValue({ ok: true })
  mockCreateJournal.mockResolvedValue({ id: 'j1', ref: 'JRN-1' })
})

describe('POST /api/accounting/journals fiscal lock', () => {
  it('returns 409 for a backdated journal entry', async () => {
    mockCheckFiscalLock.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Fiscal period locked through 2026-03-31 — backdated documents are not allowed',
    })
    const res = await POST(new NextRequest('http://localhost/api/accounting/journals', {
      method: 'POST',
      body: JSON.stringify({
        ref: 'JRN-1',
        description: 'Test',
        date: '2026-01-01',
        lines: [
          { account: '1000 - Cash', debit: 100, credit: 0 },
          { account: '4000 - Sales', debit: 0, credit: 100 },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(res.status).toBe(409)
    expect(mockCreateJournal).not.toHaveBeenCalled()
  })

  it('creates the journal when the date is open', async () => {
    const res = await POST(new NextRequest('http://localhost/api/accounting/journals', {
      method: 'POST',
      body: JSON.stringify({
        ref: 'JRN-1',
        description: 'Test',
        date: '2026-05-01',
        lines: [
          { account: '1000 - Cash', debit: 100, credit: 0 },
          { account: '4000 - Sales', debit: 0, credit: 100 },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(res.status).toBe(201)
    expect(mockCreateJournal).toHaveBeenCalled()
  })
})
