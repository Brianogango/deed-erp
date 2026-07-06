import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockGetSession, mockLoadAppState, mockSaveStoreKeys } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({
  getServerSession: mockGetSession,
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
}))

// lib/auth/authorization is intentionally NOT mocked — these tests exercise the
// real hasPermission/SENSITIVE_STORE_KEY_PERMISSIONS logic.

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { POST as STORE_POST } from '@/app/api/store/route'
import { PUT as STORE_KEY_PUT } from '@/app/api/store/[key]/route'

// ── Shared fixtures ───────────────────────────────────────────────────────────
const salesSession = { user: { id: 'u1', name: 'Sales Rep', username: 'sales', role: 'sales_rep' } }
const directorSession = { user: { id: 'u2', name: 'Director', username: 'director', role: 'director' } }
const financeSession = { user: { id: 'u3', name: 'Finance Officer', username: 'finance', role: 'finance_officer' } }

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
})

describe('POST /api/store — sensitive key gating', () => {
  it('rejects a sales_rep writing a financial key (deed_journalEntries)', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    const res = await STORE_POST(postReq({ deed_journalEntries: '[]' }))
    expect(res.status).toBe(403)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
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

  it('rejects the whole request if any one of several keys is restricted', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    const res = await STORE_POST(postReq({ deed_quotes: '[]', deed_journalEntries: '[]' }))
    expect(res.status).toBe(403)
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
})
