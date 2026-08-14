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
const salesSession = { user: { id: 'u1', name: 'Sales Rep', username: 'sales', role: 'sales_rep', modules: ['sales', 'contacts'] } }
const directorSession = { user: { id: 'u2', name: 'Director', username: 'director', role: 'director', modules: ['dashboard', 'sales', 'repair', 'contacts', 'inventory', 'accounting', 'hr'] } }
const financeSession = { user: { id: 'u3', name: 'Finance Officer', username: 'finance', role: 'finance_officer', modules: ['accounting', 'sales', 'contacts', 'inventory'] } }
const technicianSession = { user: { id: 'u4', name: 'Technician', username: 'tech', role: 'technician', modules: ['repair'] } }
const technicalLeadSession = { user: { id: 'u5', name: 'Technical Lead', username: 'lead', role: 'technical_lead', modules: ['repair', 'inventory'] } }

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

  it('allows a sales_rep writing approval requests (requestSalesApproval)', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    const res = await STORE_POST(postReq({ deed_approvalRequests: '[]' }))
    expect(res.status).toBe(200)
  })

  it('ignores client writes to deed_auditLogs (server-authored only, P0-SEC-002)', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    const financeRes = await STORE_POST(postReq({ deed_auditLogs: '[]' }))
    // Immutable keys are dropped; with nothing left to save the route returns 400
    // (no keys) or 200 with savedKeys:0 depending on batch shape — never persist client content.
    expect([200, 400]).toContain(financeRes.status)
    expect(mockSaveStoreKeys).not.toHaveBeenCalledWith(
      expect.objectContaining({ deed_auditLogs: expect.anything() }),
    )

    mockGetSession.mockResolvedValue(technicianSession)
    const techRes = await STORE_POST(postReq({ deed_auditLogs: '[]' }))
    // Technicians previously 403'd via permission; now the key is also immutable.
    expect([200, 400, 403]).toContain(techRes.status)
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

  it('preserves co-bundled POS orders when the journal ledger is a stale partial', async () => {
    // Regression: a POS sale flushes deed_posOrders + deed_invoices +
    // deed_journalEntries together. When the client's local journal ledger is
    // merely behind the server (missing refs another user just posted), the
    // append-only guard must NOT 409 the whole batch — that stranded every POS
    // sale of the day. The omitted server ref is preserved and the co-bundled
    // POS order / invoice still persist.
    mockGetSession.mockResolvedValue(financeSession)
    mockLoadAppState.mockResolvedValue({ deed_journalEntries: [{ ref: 'JRN/A', lines: [1] }] })
    const res = await STORE_POST(postReq({
      deed_posOrders: '[{"id":"pos1","total":5000}]',
      deed_journalEntries: '[{"ref":"JRN/B","lines":[2]}]',
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deniedKeys ?? []).not.toContain('deed_journalEntries')

    // appendStoreAudit also calls saveStoreKeys, so pick the entries write.
    const saved = mockSaveStoreKeys.mock.calls
      .map(c => c[0] as Record<string, string>)
      .find(a => a && 'deed_posOrders' in a) as Record<string, string>
    // Co-bundled POS order survives instead of being lost to a journal conflict.
    expect(saved.deed_posOrders).toBe('[{"id":"pos1","total":5000}]')
    // The server ref the client omitted is preserved, alongside the new one.
    const journalRefs = (JSON.parse(saved.deed_journalEntries) as Array<{ ref: string }>)
      .map(j => j.ref).sort()
    expect(journalRefs).toEqual(['JRN/A', 'JRN/B'])
  })

  it('drops only the journal key when a client tampers with a posted ref', async () => {
    // A genuine immutability violation (editing an existing posted ref) still
    // drops deed_journalEntries, but no longer nukes the rest of the batch.
    mockGetSession.mockResolvedValue(financeSession)
    mockLoadAppState.mockResolvedValue({ deed_journalEntries: [{ ref: 'JRN/A', lines: [1] }] })
    const res = await STORE_POST(postReq({
      deed_posOrders: '[{"id":"pos2","total":7000}]',
      deed_journalEntries: '[{"ref":"JRN/A","lines":[999]}]',
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deniedKeys).toContain('deed_journalEntries')
    const saved = mockSaveStoreKeys.mock.calls
      .map(c => c[0] as Record<string, string>)
      .find(a => a && 'deed_posOrders' in a) as Record<string, string>
    expect(saved.deed_posOrders).toBe('[{"id":"pos2","total":7000}]')
    expect(saved).not.toHaveProperty('deed_journalEntries')
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
  }

  it('allows sales_rep POS/refund writes but not wholesale deed_payments', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    expect((await STORE_POST(postReq({ deed_posOrders: '[]' }))).status).toBe(200)
    expect((await STORE_POST(postReq({ deed_refundPayments: '[]' }))).status).toBe(200)
    expect((await STORE_POST(postReq({ deed_invoices: '[]' }))).status).toBe(200)
    expect((await STORE_POST(postReq({ deed_payments: '[]' }))).status).toBe(403)
  })

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

describe('GET /api/store — collaborative high-risk content filtering', () => {
  function getReq(keys: string): NR {
    return new NR(`http://localhost/api/store?keys=${keys}`, { method: 'GET' })
  }

  it('serves a sales rep only their own sale orders', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    mockLoadAppState.mockResolvedValue({
      deed_saleOrders: [
        { id: 'mine', createdByUserId: 'u1' },
        { id: 'other', createdByUserId: 'u9' },
      ],
    })
    const body = await (await STORE_GET(getReq('deed_saleOrders'))).json()
    expect(body.deed_saleOrders.map((order: any) => order.id)).toEqual(['mine'])
  })

  it('serves a technician only assigned repairs', async () => {
    mockGetSession.mockResolvedValue(technicianSession)
    mockLoadAppState.mockResolvedValue({
      deed_repairs_v2: [
        { id: 'mine', assignedTechnicianId: 'u4' },
        { id: 'other', assignedTechnicianId: 'u9' },
        { id: 'unassigned' },
      ],
    })
    const body = await (await STORE_GET(getReq('deed_repairs_v2'))).json()
    expect(body.deed_repairs_v2.map((repair: any) => repair.id)).toEqual(['mine'])
  })

  it('strips sale orders when the user lacks the sales module', async () => {
    mockGetSession.mockResolvedValue({ user: { ...salesSession.user, modules: ['contacts'] } })
    mockLoadAppState.mockResolvedValue({
      deed_saleOrders: [{ id: 'mine', createdByUserId: 'u1' }],
      deed_contacts: [{ id: 'c1' }],
    })
    const body = await (await STORE_GET(getReq('deed_saleOrders,deed_contacts'))).json()
    expect(body.deed_saleOrders).toBeUndefined()
    expect(body.deed_contacts).toEqual([{ id: 'c1' }])
  })

  it('403s a by-key contacts read without a legitimate module grant', async () => {
    mockGetSession.mockResolvedValue({ user: { ...technicianSession.user, modules: ['dashboard'] } })
    const response = await STORE_KEY_GET(
      new NR('http://localhost/api/store/deed_contacts', { method: 'GET' }),
      { params: { key: 'deed_contacts' } },
    )
    expect(response.status).toBe(403)
    expect(mockLoadAppState).not.toHaveBeenCalled()
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

  it('rejects a tampered total/date on a posted invoice via wholesale sync (FIN-001)', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    const posted = [{
      id: 'i1', ref: 'INV/2026/0044', type: 'customer_invoice', status: 'posted',
      partnerId: 'c1', partnerName: 'Kevin Mbugua', date: '2026-08-01', dueDate: '2026-08-31',
      lines: [{ id: 'l1', description: 'HP ZBook', qty: 1, unitPrice: 51000, taxRate: 0, subtotal: 51000 }],
      subtotal: 51000, taxTotal: 0, total: 51700, amountPaid: 0,
    }]
    mockLoadAppState.mockResolvedValue({ deed_invoices: posted })
    const tampered = [{ ...posted[0], total: 100, subtotal: 100, date: '2020-01-01' }]
    const res = await STORE_POST(postReq({ deed_invoices: JSON.stringify(tampered) }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rejectedPostedInvoiceEdits).toHaveLength(1)
    expect(body.rejectedPostedInvoiceEdits[0].ref).toBe('INV/2026/0044')
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls.find(c => c[0].deed_invoices)![0].deed_invoices)
    expect(saved[0].total).toBe(51700)
    expect(saved[0].date).toBe('2026-08-01')
    // A second, separate saveStoreKeys call records the rejection in the audit timeline.
    expect(mockSaveStoreKeys).toHaveBeenCalledWith(
      expect.objectContaining({ deed_audit_timeline_v1: expect.stringContaining('rejectedPostedInvoiceEdits') }),
    )
  })

  it('still allows amountPaid to be recorded on a posted invoice (payment registration)', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    const posted = [{
      id: 'i1', ref: 'INV/2026/0044', type: 'customer_invoice', status: 'posted',
      partnerId: 'c1', partnerName: 'Kevin Mbugua', date: '2026-08-01', dueDate: '2026-08-31',
      lines: [{ id: 'l1', description: 'HP ZBook', qty: 1, unitPrice: 51700, taxRate: 0, subtotal: 51700 }],
      subtotal: 51700, taxTotal: 0, total: 51700, amountPaid: 0,
    }]
    mockLoadAppState.mockResolvedValue({ deed_invoices: posted })
    const paid = [{ ...posted[0], amountPaid: 51700 }]
    const res = await STORE_POST(postReq({ deed_invoices: JSON.stringify(paid) }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rejectedPostedInvoiceEdits).toEqual([])
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls.find(c => c[0].deed_invoices)![0].deed_invoices)
    expect(saved[0].amountPaid).toBe(51700)
  })

  it('allows posting a credit-note-style cancellation of a posted invoice', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    const posted = [{
      id: 'i1', ref: 'INV/2026/0044', type: 'customer_invoice', status: 'posted',
      partnerId: 'c1', partnerName: 'Kevin Mbugua', date: '2026-08-01', dueDate: '2026-08-31',
      lines: [{ id: 'l1', description: 'HP ZBook', qty: 1, unitPrice: 51700, taxRate: 0, subtotal: 51700 }],
      subtotal: 51700, taxTotal: 0, total: 51700, amountPaid: 0,
    }]
    mockLoadAppState.mockResolvedValue({ deed_invoices: posted })
    const cancelled = [{ ...posted[0], status: 'cancelled' }]
    const res = await STORE_POST(postReq({ deed_invoices: JSON.stringify(cancelled) }))
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls.find(c => c[0].deed_invoices)![0].deed_invoices)
    expect(saved[0].status).toBe('cancelled')
    expect((await res.json()).rejectedPostedInvoiceEdits).toEqual([])
  })

  it('rejects a tampered posted invoice via PUT /api/store/[key] too (no weaker single-key path)', async () => {
    mockGetSession.mockResolvedValue(directorSession)
    const posted = [{
      id: 'i1', ref: 'INV/2026/0044', type: 'customer_invoice', status: 'posted',
      partnerId: 'c1', partnerName: 'Kevin Mbugua', date: '2026-08-01', dueDate: '2026-08-31',
      lines: [{ id: 'l1', description: 'HP ZBook', qty: 1, unitPrice: 51700, taxRate: 0, subtotal: 51700 }],
      subtotal: 51700, taxTotal: 0, total: 51700, amountPaid: 0,
    }]
    mockLoadAppState.mockResolvedValue({ deed_invoices: posted })
    const tampered = [{ ...posted[0], total: 1 }]
    const res = await STORE_KEY_PUT(
      new NR('http://localhost/api/store/deed_invoices', {
        method: 'PUT', body: JSON.stringify({ value: tampered }), headers: { 'Content-Type': 'application/json' },
      }),
      { params: { key: 'deed_invoices' } },
    )
    expect(res.status).toBe(200)
    const savedCall = mockSaveStoreKeys.mock.calls.find(c => c[0].deed_invoices)
    const saved = JSON.parse(savedCall![0].deed_invoices)
    expect(saved[0].total).toBe(51700)
  })

  it('refuses to overwrite non-empty invoice lines with an empty shell', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    const withLines = [{
      id: 'i1',
      type: 'customer_invoice',
      total: 11600,
      subtotal: 10000,
      taxTotal: 1600,
      lines: [{ id: 'l1', description: 'ThinkPad', qty: 1, unitPrice: 10000, taxRate: 16, subtotal: 10000 }],
    }]
    mockLoadAppState.mockResolvedValue({ deed_invoices: withLines })
    const emptyShell = [{
      id: 'i1',
      type: 'customer_invoice',
      total: 11600,
      subtotal: 11600,
      taxTotal: 0,
      lines: [],
    }]
    const res = await STORE_POST(postReq({ deed_invoices: JSON.stringify(emptyShell) }))
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls.find(c => c[0].deed_invoices)![0].deed_invoices)
    expect(saved[0].lines).toHaveLength(1)
    expect(saved[0].lines[0].description).toBe('ThinkPad')
    expect(saved[0].subtotal).toBe(10000)
  })
})
