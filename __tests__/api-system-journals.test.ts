import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockCheckFiscalLock, mockPersist } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCheckFiscalLock: vi.fn(),
  mockPersist: vi.fn(),
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<Response>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status })
    }
  },
  getRequiredSession: mockGetSession,
}))
vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: mockCheckFiscalLock }))
vi.mock('@/lib/accounting/journal-service', () => ({ persistStoreJournalEntry: mockPersist }))

import { POST } from '@/app/api/accounting/system-journals/route'

const asUser = (role: string, modules?: string[]) => ({
  user: { id: 'u1', name: 'Test', role, ...(modules ? { modules } : {}) },
})

const body = (over: Record<string, unknown> = {}) => ({
  kind: 'pos_session',
  id: 'blob-1',
  ref: 'JRN/POS/2026/0001',
  date: '2026-09-27',
  description: 'POS session close',
  lines: [
    { account: '2211 - Petty Cash / Mobile Money', description: 'Cash banked', debit: 5000, credit: 0 },
    { account: '5000 - Sales Revenue', description: 'POS sales', debit: 0, credit: 5000 },
  ],
  ...over,
})

const post = (payload: unknown) =>
  POST(new Request('http://localhost/api/accounting/system-journals', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  }) as any)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockGetSession.mockResolvedValue(asUser('director'))
  mockCheckFiscalLock.mockResolvedValue({ ok: true })
  mockPersist.mockResolvedValue({ id: 'je-1', ref: 'JRN/POS/2026/0001' })
})

describe('POST /api/accounting/system-journals', () => {
  it('posts the entry through the same path the mirror uses', async () => {
    const res = await post(body())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ journal: { id: 'je-1', ref: 'JRN/POS/2026/0001' } })
    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'JRN/POS/2026/0001', id: 'blob-1', date: '2026-09-27' }),
      { createdById: 'u1' },
    )
  })

  it('assigns provenance from the kind, never from the caller', async () => {
    // The kind decides the source; the payload has no say.
    await post(body())
    expect(mockPersist.mock.calls[0][0].source).toBe('pos_session')
  })

  it('rejects a payload that tries to set its own provenance', async () => {
    // The schema is strict, so an attempt to smuggle a source is refused
    // outright rather than quietly ignored.
    const res = await post({ ...body(), source: 'payroll' })
    expect(res.status).toBe(422)
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('gives each kind the source the blob builder used, so rows match what the mirror wrote', async () => {
    const expected: Record<string, string> = {
      fixed_asset: 'adjustment',
      pos_session: 'pos_session',
      rma_refund: 'refund',
      buyback_credit: 'manual',
      sale_order_credit_note: 'manual',
      invoice_adjustment: 'invoice',
    }
    for (const [kind, source] of Object.entries(expected)) {
      mockPersist.mockClear()
      await post(body({ kind }))
      expect(mockPersist.mock.calls[0][0].source, kind).toBe(source)
    }
  })

  it('refuses a kind that is not in the closed set', async () => {
    const res = await post(body({ kind: 'payroll_run' }))
    expect(res.status).toBe(422)
    expect(mockPersist).not.toHaveBeenCalled()
  })
})

describe('POST /api/accounting/system-journals — who may post what', () => {
  it('lets a sales rep on the POS module close a session', async () => {
    mockGetSession.mockResolvedValue(asUser('sales_rep', ['pos']))
    expect((await post(body({ kind: 'pos_session' }))).status).toBe(201)
  })

  it('does not let that same sales rep capitalise a fixed asset', async () => {
    // Authorisation follows the blob key that owns the record, so posting the
    // journal needs the same rights as performing the action.
    mockGetSession.mockResolvedValue(asUser('sales_rep', ['pos']))
    const res = await post(body({ kind: 'fixed_asset', ref: 'JRN/AST-CAP/AST-001' }))
    expect(res.status).toBe(403)
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('lets an admin officer with the property module capitalise a fixed asset', async () => {
    mockGetSession.mockResolvedValue(asUser('admin_officer', ['property']))
    expect((await post(body({ kind: 'fixed_asset', ref: 'JRN/AST-CAP/AST-001' }))).status).toBe(201)
  })

  it('refuses the right role without the module', async () => {
    mockGetSession.mockResolvedValue(asUser('admin_officer', ['sales']))
    expect((await post(body({ kind: 'fixed_asset', ref: 'JRN/AST-CAP/AST-001' }))).status).toBe(403)
  })

  it('lets a director post any kind', async () => {
    mockGetSession.mockResolvedValue(asUser('director'))
    expect((await post(body({ kind: 'fixed_asset', ref: 'JRN/AST-CAP/AST-001' }))).status).toBe(201)
  })
})

describe('POST /api/accounting/system-journals — guards', () => {
  it('respects a closed fiscal period', async () => {
    mockCheckFiscalLock.mockResolvedValue({ ok: false, error: 'September is closed', status: 423 })
    const res = await post(body())
    expect(res.status).toBe(423)
    expect(await res.json()).toEqual({ error: 'September is closed' })
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('rejects a malformed date before touching the ledger', async () => {
    const res = await post(body({ date: 'last Tuesday' }))
    expect(res.status).toBe(422)
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('accepts a full timestamp and posts it as a day', async () => {
    await post(body({ date: '2026-09-27T14:03:00.000Z' }))
    expect(mockPersist.mock.calls[0][0].date).toBe('2026-09-27')
  })

  it('refuses a one-sided entry', async () => {
    const res = await post(body({ lines: [{ account: '2211 - Petty Cash', debit: 5000, credit: 0 }] }))
    expect(res.status).toBe(422)
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('passes a posting refusal back with its own status rather than a bare 500', async () => {
    // Unknown account, unbalanced lines and a closed period all arrive this way.
    const err = Object.assign(new Error('Unknown account 9999.'), { status: 409 })
    mockPersist.mockRejectedValue(err)
    const res = await post(body())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Unknown account 9999.')
  })

  it('reports an unexpected failure as a 500', async () => {
    mockPersist.mockRejectedValue(new Error('connection lost'))
    expect((await post(body())).status).toBe(500)
  })
})
