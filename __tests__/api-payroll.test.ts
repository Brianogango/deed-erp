import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRequireRole, mockPrisma } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockPrisma: {
    payrollRun: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    payslip: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    // createRunFromClient upserts the statutory rule version, then writes the
    // run + payslips + component lines inside prisma.$transaction.
    statutoryRuleVersion: { upsert: vi.fn().mockResolvedValue({ id: 'rule-1' }) },
    payrollComponentLine: { create: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn((fn: any) => fn(mockPrisma)),
  },
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try { return await handler() } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status, headers: { 'Content-Type': 'application/json' } })
    }
  },
  requireRole: mockRequireRole,
}))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { GET, POST } from '@/app/api/payroll/route'

const directorUser = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Director', role: 'director' }
const postReq = (body: unknown) => new Request('http://localhost/api/payroll', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
function err403() { return Object.assign(new Error('Forbidden'), { status: 403 }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue(directorUser)
  mockPrisma.payrollRun.findMany.mockResolvedValue([])
  mockPrisma.payslip.findMany.mockResolvedValue([])
  mockPrisma.payrollRun.findUnique.mockResolvedValue(null)
  mockPrisma.payrollRun.create.mockResolvedValue({ id: 'run1', runReference: 'PAY/2026/07', totalNet: 0, periodMonth: '07', periodYear: 2026 })
  mockPrisma.payslip.create.mockResolvedValue({})
})

describe('GET /api/payroll', () => {
  it('returns runs+payslips for an allowed role', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('runs')
    expect(body).toHaveProperty('payslips')
  })
  it('403 for a technician', async () => {
    mockRequireRole.mockRejectedValue(err403())
    const res = await GET()
    expect(res.status).toBe(403)
  })
})

describe('POST /api/payroll', () => {
  it('creates a Prisma payroll run (idempotent by reference)', async () => {
    const res = await POST(postReq({ run: { id: 'run1', ref: 'PAY/2026/07', month: '07', year: 2026, totalGross: 100, totalDeductions: 20, totalNet: 80 }, payslips: [] }))
    expect(res.status).toBe(200)
    expect(mockPrisma.payrollRun.create).toHaveBeenCalled()
  })
  it('does not duplicate a run that already exists', async () => {
    mockPrisma.payrollRun.findUnique.mockResolvedValue({ id: 'run1', runReference: 'PAY/2026/07' })
    const res = await POST(postReq({ run: { id: 'run1', ref: 'PAY/2026/07', month: '07', year: 2026 } }))
    expect(res.status).toBe(200)
    expect(mockPrisma.payrollRun.create).not.toHaveBeenCalled()
  })
  it('403 for a technician', async () => {
    mockRequireRole.mockRejectedValue(err403())
    const res = await POST(postReq({ run: { id: 'x' } }))
    expect(res.status).toBe(403)
  })
})
