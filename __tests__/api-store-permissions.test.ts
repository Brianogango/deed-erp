import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockGetSession, mockLoadAppState, mockSaveStoreKeys, mockGetAppStateVersion } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockGetAppStateVersion: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({
  getServerSession: mockGetSession,
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
  getAppStateVersion: mockGetAppStateVersion,
}))

// lib/auth/authorization is intentionally NOT mocked — these tests exercise the
// real hasPermission/SENSITIVE_STORE_KEY_PERMISSIONS logic.

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { POST as STORE_POST, GET as STORE_GET } from '@/app/api/store/route'
import { PUT as STORE_KEY_PUT, GET as STORE_KEY_GET } from '@/app/api/store/[key]/route'
import { NextRequest as NR } from 'next/server'

// ── Shared fixtures ───────────────────────────────────────────────────────────
const salesSession = { user: { id: 'u1', name: 'Sales Rep', username: 'sales', role: 'sales_rep' } }
const directorSession = { user: { id: 'u2', name: 'Director', username: 'director', role: 'director' } }
const financeSession = { user: { id: 'u3', name: 'Finance Officer', username: 'finance', role: 'finance_officer' } }
const technicianSession = { user: { id: 'u4', name: 'Technician', username: 'tech', role: 'technician' } }
const technicalLeadSession = { user: { id: 'u5', name: 'Technical Lead', username: 'lead', role: 'technical_lead' } }

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/store', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function putReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/store/deed_journalEntries', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadAppState.mockResolvedValue({})
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockGetAppStateVersion.mockResolvedValue('2026-07-10T00:00:00.000Z:3')
})

describe('POST /api/store — sensitive key gating', () => {
  it('rejects a sales_rep writing a financial key (deed_journalEntries)', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    const res = await STORE_POST(postReq({ deed_journalEntries: '[]' }))
    expect(res.status).toBe(403)
    // The denied key itself is never persisted (only the audit-trail entry recording the denial is).
    expect(mockSaveStoreKeys).not.toHaveBeenCalledWith(expect.objectContaining({ deed_journalEntries: expect.anything() }))
  })

  it('allows a director writing a financial key', async () => {
    mockGetSession.mockResolvedValue(directorSession)
    const res = await STORE_POST(postReq({ deed_journalEntries: '[]' }))
    expect(res.status).toBe(200)
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })

  it('allows a finance_officer writing a financial key', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    const res = await STORE_POST(postReq({ deed_accounts: '[]' }))
    expect(res.status).toBe(200)
  })

  it('rejects a sales_rep writing the approval trail (deed_approvalRequests)', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    const res = await STORE_POST(postReq({ deed_approvalRequests: '[]' }))
    expect(res.status).toBe(403)
  })

  it('rejects a non-director writing the audit log (deed_auditLogs)', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    const res = await STORE_POST(postReq({ deed_auditLogs: '[]' }))
    expect(res.status).toBe(403)
  })

  it('does not regress unrestricted keys — any authenticated role can still write deed_quotes', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    const res = await STORE_POST(postReq({ deed_quotes: '[]' }))
    expect(res.status).toBe(200)
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await STORE_POST(postReq({ deed_quotes: '[]' }))
    expect(res.status).toBe(401)
  })

  it('saves permitted keys and drops restricted ones from a mixed batch', async () => {
    // A blanket 403 on mixed batches caused real data loss: the client flushes
    // every dirty key together, so e.g. a technician's repair diagnosis was
    // thrown away because the same batch carried the director-only audit log.
    mockGetSession.mockResolvedValue(salesSession)
    const res = await STORE_POST(postReq({ deed_quotes: '[]', deed_journalEntries: '[]' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deniedKeys).toEqual(['deed_journalEntries'])
    expect(mockSaveStoreKeys).toHaveBeenCalledWith({ deed_quotes: '[]' })
  })

  it('still 403s when every key in the batch is restricted', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    const res = await STORE_POST(postReq({ deed_journalEntries: '[]', deed_payrollRuns: '[]' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.deniedKeys).toEqual(['deed_journalEntries', 'deed_payrollRuns'])
    expect(mockSaveStoreKeys).not.toHaveBeenCalledWith(expect.objectContaining({ deed_journalEntries: '[]' }))
  })

  // ── Finance ledger keys (regression for the store-sync bypass) ──────────────
  const financeKeys = ['deed_invoices', 'deed_payments', 'deed_posOrders', 'deed_refundPayments']
  for (const key of financeKeys) {
    it(`rejects a technician overwriting ${key}`, async () => {
      mockGetSession.mockResolvedValue(technicianSession)
      const res = await STORE_POST(postReq({ [key]: JSON.stringify([{ id: 'x', total: 999999 }]) }))
      expect(res.status).toBe(403)
      expect(mockSaveStoreKeys).not.toHaveBeenCalledWith(expect.objectContaining({ [key]: expect.anything() }))
    })
    it(`allows a finance_officer writing ${key}`, async () => {
      mockGetSession.mockResolvedValue(financeSession)
      const res = await STORE_POST(postReq({ [key]: '[]' }))
      expect(res.status).toBe(200)
    })
    it(`allows a sales_rep writing ${key} (POS/sales flow)`, async () => {
      mockGetSession.mockResolvedValue(salesSession)
      const res = await STORE_POST(postReq({ [key]: '[]' }))
      expect(res.status).toBe(200)
    })
  }

  // Repair billing: the repair-quote lifecycle (quote → client approval →
  // linked invoice) is owned by technical leads, so deed_invoices is writable
  // by them — while POS orders / payments / refunds stay locked.
  it('allows a technical_lead writing deed_invoices (repair billing)', async () => {
    mockGetSession.mockResolvedValue(technicalLeadSession)
    const res = await STORE_POST(postReq({ deed_invoices: '[]' }))
    expect(res.status).toBe(200)
    expect(mockSaveStoreKeys).toHaveBeenCalledWith({ deed_invoices: '[]' })
  })

  it('still rejects a technical_lead writing deed_posOrders and deed_payments', async () => {
    mockGetSession.mockResolvedValue(technicalLeadSession)
    const res = await STORE_POST(postReq({ deed_posOrders: '[]', deed_payments: '[]' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.deniedKeys).toEqual(['deed_posOrders', 'deed_payments'])
  })

  it('rejects a sales_rep writing payroll (deed_payrollRuns)', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    const res = await STORE_POST(postReq({ deed_payrollRuns: '[]' }))
    expect(res.status).toBe(403)
  })

  it('rejects a technician writing deposits (deed_deposits)', async () => {
    mockGetSession.mockResolvedValue(technicianSession)
    const res = await STORE_POST(postReq({ deed_deposits: '[]' }))
    expect(res.status).toBe(403)
  })

  it('silently drops the server-managed audit timeline on POST (never client-writable)', async () => {
    mockGetSession.mockResolvedValue(directorSession)
    const res = await STORE_POST(postReq({ deed_audit_timeline_v1: JSON.stringify([{ tampered: true }]) }))
    // No other valid key supplied → 400, and the timeline is never persisted from the client.
    expect(res.status).toBe(400)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })
})

describe('PUT /api/store/[key] — sensitive key gating', () => {
  it('rejects a sales_rep writing deed_journalEntries directly by key', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    const res = await STORE_KEY_PUT(putReq({ value: '[]' }), { params: { key: 'deed_journalEntries' } })
    expect(res.status).toBe(403)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('allows a director writing deed_journalEntries directly by key', async () => {
    mockGetSession.mockResolvedValue(directorSession)
    const res = await STORE_KEY_PUT(putReq({ value: '[]' }), { params: { key: 'deed_journalEntries' } })
    expect(res.status).toBe(200)
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await STORE_KEY_PUT(putReq({ value: '[]' }), { params: { key: 'deed_journalEntries' } })
    expect(res.status).toBe(401)
  })

  it('rejects a technician overwriting deed_invoices by key', async () => {
    mockGetSession.mockResolvedValue(technicianSession)
    const res = await STORE_KEY_PUT(putReq({ value: '[]' }), { params: { key: 'deed_invoices' } })
    expect(res.status).toBe(403)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('blocks even a director from writing the server-managed audit timeline by key', async () => {
    mockGetSession.mockResolvedValue(directorSession)
    const res = await STORE_KEY_PUT(putReq({ value: '[]' }), { params: { key: 'deed_audit_timeline_v1' } })
    expect(res.status).toBe(403)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('rejects a technician writing leave requests via wholesale sync', async () => {
    mockGetSession.mockResolvedValue(technicianSession)
    const res = await STORE_POST(postReq({ deed_leaveRequests: '[]' }))
    expect(res.status).toBe(403)
    expect(mockSaveStoreKeys).not.toHaveBeenCalledWith(expect.objectContaining({ deed_leaveRequests: expect.anything() }))
  })
})

describe('GET /api/store — sensitive key READ gating', () => {
  function getReq(keys: string): NR {
    return new NR(`http://localhost/api/store?keys=${keys}`, { method: 'GET' })
  }

  it('strips payroll/payslip/leave keys for a technician', async () => {
    mockGetSession.mockResolvedValue(technicianSession)
    mockLoadAppState.mockResolvedValue({
      deed_payslips: [{ id: 'p1', netPay: 99999 }],
      deed_payrollRuns: [{ id: 'r1' }],
      deed_leaveRequests: [{ id: 'l1' }],
      deed_quotes: [{ id: 'q1' }],
    })
    const res = await STORE_GET(getReq('deed_payslips,deed_payrollRuns,deed_leaveRequests,deed_quotes'))
    const body = await res.json()
    expect(body.deed_payslips).toBeUndefined()
    expect(body.deed_payrollRuns).toBeUndefined()
    expect(body.deed_leaveRequests).toBeUndefined()
    // Non-sensitive collaborative data is still returned.
    expect(body.deed_quotes).toBeDefined()
  })

  it('returns payroll/payslip keys for a finance officer', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    mockLoadAppState.mockResolvedValue({ deed_payslips: [{ id: 'p1' }], deed_payrollRuns: [{ id: 'r1' }] })
    const res = await STORE_GET(getReq('deed_payslips,deed_payrollRuns'))
    const body = await res.json()
    expect(body.deed_payslips).toBeDefined()
    expect(body.deed_payrollRuns).toBeDefined()
  })

  it('403s a technician reading deed_payslips by key', async () => {
    mockGetSession.mockResolvedValue(technicianSession)
    mockLoadAppState.mockResolvedValue({ deed_payslips: [{ id: 'p1' }] })
    const res = await STORE_KEY_GET(
      new NR('http://localhost/api/store/deed_payslips', { method: 'GET' }),
      { params: { key: 'deed_payslips' } },
    )
    expect(res.status).toBe(403)
  })
})

describe('GET /api/store — financial ledger CONTENT filtering', () => {
  function getReq(keys: string): NR {
    return new NR(`http://localhost/api/store?keys=${keys}`, { method: 'GET' })
  }

  const invoices = [
    { id: 'i1', type: 'customer_invoice', total: 1000, repairId: 'r1' },
    { id: 'i2', type: 'customer_invoice', total: 2000 },
    { id: 'i3', type: 'vendor_bill', total: 3000 },
  ]
  const expenses = [
    { id: 'e1', submittedByUserId: 'u4', amount: 50 },
    { id: 'e2', submittedByUserId: 'other', amount: 75 },
  ]

  it('serves the full invoice ledger to a finance officer', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    mockLoadAppState.mockResolvedValue({ deed_invoices: invoices })
    const body = await (await STORE_GET(getReq('deed_invoices'))).json()
    expect(body.deed_invoices).toHaveLength(3)
  })

  it('serves a technician only repair-linked invoices', async () => {
    mockGetSession.mockResolvedValue(technicianSession)
    mockLoadAppState.mockResolvedValue({ deed_invoices: invoices })
    const body = await (await STORE_GET(getReq('deed_invoices'))).json()
    expect(body.deed_invoices.map((i: any) => i.id)).toEqual(['i1'])
  })

  it('serves a technical lead only repair-linked invoices', async () => {
    mockGetSession.mockResolvedValue(technicalLeadSession)
    mockLoadAppState.mockResolvedValue({ deed_invoices: invoices })
    const body = await (await STORE_GET(getReq('deed_invoices'))).json()
    expect(body.deed_invoices.map((i: any) => i.id)).toEqual(['i1'])
  })

  it('serves a sales rep customer invoices but never vendor bills', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    mockLoadAppState.mockResolvedValue({ deed_invoices: invoices })
    const body = await (await STORE_GET(getReq('deed_invoices'))).json()
    expect(body.deed_invoices.map((i: any) => i.id)).toEqual(['i1', 'i2'])
  })

  it('serves a technician only their own expense claims', async () => {
    mockGetSession.mockResolvedValue(technicianSession) // user id u4
    mockLoadAppState.mockResolvedValue({ deed_expenses: expenses })
    const body = await (await STORE_GET(getReq('deed_expenses'))).json()
    expect(body.deed_expenses.map((e: any) => e.id)).toEqual(['e1'])
  })

  it('serves a finance officer every expense claim', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    mockLoadAppState.mockResolvedValue({ deed_expenses: expenses })
    const body = await (await STORE_GET(getReq('deed_expenses'))).json()
    expect(body.deed_expenses).toHaveLength(2)
  })

  it('filters deed_invoices on the by-key GET route too', async () => {
    mockGetSession.mockResolvedValue(technicianSession)
    mockLoadAppState.mockResolvedValue({ deed_invoices: invoices })
    const res = await STORE_KEY_GET(
      new NR('http://localhost/api/store/deed_invoices', { method: 'GET' }),
      { params: { key: 'deed_invoices' } },
    )
    const body = await res.json()
    expect(body.value.map((i: any) => i.id)).toEqual(['i1'])
  })
})

describe('GET /api/store — ETag conditional fetch', () => {
  function getReq(keys: string, etag?: string): NR {
    return new NR(`http://localhost/api/store?keys=${keys}`, {
      method: 'GET',
      headers: etag ? { 'If-None-Match': etag } : undefined,
    })
  }

  it('returns an ETag and answers a matching If-None-Match with 304 (no body, no data load)', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    mockLoadAppState.mockResolvedValue({ deed_quotes: [{ id: 'q1' }] })
    const first = await STORE_GET(getReq('deed_quotes'))
    const etag = first.headers.get('etag')
    expect(first.status).toBe(200)
    expect(etag).toBeTruthy()

    mockLoadAppState.mockClear()
    const second = await STORE_GET(getReq('deed_quotes', etag!))
    expect(second.status).toBe(304)
    expect(mockLoadAppState).not.toHaveBeenCalled()
  })

  it('returns fresh data (200) when the data version changed', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    mockLoadAppState.mockResolvedValue({ deed_quotes: [{ id: 'q1' }] })
    const first = await STORE_GET(getReq('deed_quotes'))
    const etag = first.headers.get('etag')

    mockGetAppStateVersion.mockResolvedValue('2026-07-10T09:00:00.000Z:3')
    const second = await STORE_GET(getReq('deed_quotes', etag!))
    expect(second.status).toBe(200)
  })

  it('never gives one user a 304 for another user\'s ETag (role-filtered payloads differ)', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    mockLoadAppState.mockResolvedValue({ deed_invoices: [] })
    const financeRes = await STORE_GET(getReq('deed_invoices'))
    const financeEtag = financeRes.headers.get('etag')

    mockGetSession.mockResolvedValue(technicianSession)
    const techRes = await STORE_GET(getReq('deed_invoices', financeEtag!))
    expect(techRes.status).toBe(200)
    expect(techRes.headers.get('etag')).not.toBe(financeEtag)
  })
})

describe('POST /api/store — partial-view writes merge instead of replace', () => {
  const serverInvoices = [
    { id: 'i1', type: 'customer_invoice', total: 1000, repairId: 'r1' },
    { id: 'i2', type: 'customer_invoice', total: 2000 },
    { id: 'i3', type: 'vendor_bill', total: 3000 },
  ]

  it('a technical lead syncing their repair-only slice does not delete other invoices', async () => {
    mockGetSession.mockResolvedValue(technicalLeadSession)
    mockLoadAppState.mockResolvedValue({ deed_invoices: serverInvoices })
    // Lead's client only ever held [i1]; they updated it and added a new repair invoice.
    const clientSlice = [
      { id: 'i1', type: 'customer_invoice', total: 1500, repairId: 'r1' },
      { id: 'i4', type: 'customer_invoice', total: 400, repairId: 'r2' },
    ]
    const res = await STORE_POST(postReq({ deed_invoices: JSON.stringify(clientSlice) }))
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls.find(c => c[0].deed_invoices)![0].deed_invoices)
    const byId = Object.fromEntries(saved.map((i: any) => [i.id, i]))
    expect(saved).toHaveLength(4)          // i2 and i3 preserved
    expect(byId.i1.total).toBe(1500)       // update applied
    expect(byId.i4).toBeDefined()          // new repair invoice added
    expect(byId.i2.total).toBe(2000)
    expect(byId.i3.total).toBe(3000)
  })

  it('an employee syncing their own expense claims does not delete other employees\' claims', async () => {
    mockGetSession.mockResolvedValue(technicianSession)
    mockLoadAppState.mockResolvedValue({ deed_expenses: [
      { id: 'e1', submittedByUserId: 'u4', amount: 50 },
      { id: 'e2', submittedByUserId: 'other', amount: 75 },
    ] })
    const res = await STORE_POST(postReq({ deed_expenses: JSON.stringify([
      { id: 'e1', submittedByUserId: 'u4', amount: 50 },
      { id: 'e3', submittedByUserId: 'u4', amount: 120 },
    ]) }))
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls.find(c => c[0].deed_expenses)![0].deed_expenses)
    expect(saved.map((e: any) => e.id).sort()).toEqual(['e1', 'e2', 'e3'])
  })

  it('a finance officer still replaces the ledger wholesale (full-access write)', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    mockLoadAppState.mockResolvedValue({ deed_invoices: serverInvoices })
    const res = await STORE_POST(postReq({ deed_invoices: JSON.stringify([serverInvoices[0]]) }))
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls.find(c => c[0].deed_invoices)![0].deed_invoices)
    expect(saved).toHaveLength(1)
  })
})
