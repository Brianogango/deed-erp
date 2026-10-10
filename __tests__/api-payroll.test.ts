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
    // One-off pay items and open staff loans are read when a run is created.
    payrollAdjustment: { findMany: vi.fn(), updateMany: vi.fn() },
    employeeLoan: { findMany: vi.fn() },
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
  mockPrisma.payrollAdjustment.findMany.mockResolvedValue([])
  mockPrisma.payrollAdjustment.updateMany.mockResolvedValue({ count: 0 })
  mockPrisma.employeeLoan.findMany.mockResolvedValue([])
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
  it('applies pending one-off pay items and staff loan repayments to the payslip, then marks the items applied', async () => {
    mockPrisma.payrollAdjustment.findMany.mockResolvedValue([
      { id: 'adj-bonus', employeeId: 'emp1', kind: 'earning', amount: 10000 },
      { id: 'adj-fine', employeeId: 'emp1', kind: 'deduction', amount: 500 },
      { id: 'adj-car', employeeId: 'emp1', kind: 'benefit_in_kind', amount: 20000 },
      { id: 'adj-ins', employeeId: 'emp1', kind: 'insurance_premium', amount: 10000 },
    ])
    mockPrisma.employeeLoan.findMany.mockResolvedValue([
      { id: 'loan1', employeeId: 'emp1', issueDate: new Date('2026-01-01'), monthlyDeduction: 5000, outstanding: 20000 },
    ])
    const res = await POST(postReq({
      run: { id: 'run1', ref: 'PAY/2026/07', month: '07', year: 2026, lines: [{ employeeId: 'emp1', employeeName: 'Jane', basicSalary: 100000, allowances: 0, deductions: 0, netPay: 0 }] },
      payslips: [{ id: 'ps1', ref: 'PS/2026/07/001', employeeId: 'emp1', employeeName: 'Jane', grossPay: 100000, salaryAdvanceDeductions: [] }],
    }))
    expect(res.status).toBe(200)
    const data = mockPrisma.payslip.create.mock.calls[0][0].data
    expect(data.otherAdditions).toBe(10000)
    expect(data.grossPay).toBe(110000)
    expect(data.otherDeductions).toBe(500)
    expect(data.loanDeductions).toBe(5000)
    expect(data.netPay).toBeCloseTo(data.grossPay - data.totalDeductions, 2)
    expect(mockPrisma.payrollAdjustment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['adj-bonus', 'adj-fine', 'adj-car', 'adj-ins'] } },
      data: { status: 'applied', appliedRunId: 'run1' },
    })
    const codes = mockPrisma.payrollComponentLine.create.mock.calls.map(c => c[0].data.componentCode)
    expect(codes).toEqual(expect.arrayContaining(['BENEFIT_IN_KIND', 'INSURANCE_RELIEF', 'STAFF_LOAN', 'OTHER_ADDITIONS', 'OTHER_DEDUCTIONS']))
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
