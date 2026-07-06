import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockRequireRole, mockLoadAppState, mockSaveStoreKeys } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      const msg = status < 500 ? (err?.message ?? 'Bad request') : 'Internal server error'
      return new Response(JSON.stringify({ error: msg }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  },
  requireRole: mockRequireRole,
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { GET, POST } from '@/app/api/payroll/route'

const directorUser = { id: 'u1', name: 'Director', username: 'director', role: 'director' }

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/payroll', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function err403() { return Object.assign(new Error('Forbidden — insufficient role'), { status: 403 }) }
function err401() { return Object.assign(new Error('Unauthorized'), { status: 401 }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue(directorUser)
  mockLoadAppState.mockResolvedValue({ deed_payrollRuns: [], deed_payslips: [] })
})

describe('GET /api/payroll', () => {
  it('returns 200 for an allowed role', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('returns 403 for a technician (not in PAYROLL_ROLES)', async () => {
    mockRequireRole.mockRejectedValue(err403())
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    mockRequireRole.mockRejectedValue(err401())
    const res = await GET()
    expect(res.status).toBe(401)
  })
})

describe('POST /api/payroll', () => {
  it('writes payroll data for an allowed role', async () => {
    const res = await POST(postReq({ run: { id: 'run1' } }))
    expect(res.status).toBe(200)
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })

  it('returns 403 for a technician', async () => {
    mockRequireRole.mockRejectedValue(err403())
    const res = await POST(postReq({ run: { id: 'run1' } }))
    expect(res.status).toBe(403)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })
})
