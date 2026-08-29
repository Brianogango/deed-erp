import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockLookupRepair, mockLoadAppState, mockCheckRateLimit } = vi.hoisted(() => ({
  mockLookupRepair: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 10, resetAt: Date.now() + 60_000 }),
}))

vi.mock('@/lib/portal-repair-server', () => ({ lookupRepair: mockLookupRepair }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  loadAppStateForWrite: mockLoadAppState,
  saveStoreKeys: vi.fn().mockResolvedValue(undefined),
  withAppStateKeyLock: (_key: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }))
vi.mock('@/lib/prisma', () => ({ default: { client: { findFirst: vi.fn(), create: vi.fn() }, user: { findFirst: vi.fn() }, saleOrder: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() }, invoice: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() } } }))
vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: vi.fn() }))
vi.mock('@/lib/portal-repairs', () => ({ approvalDecisions: new Map() }))

import { POST } from '@/app/api/portal/repair/[ref]/approve/route'

const repair = {
  ref: 'REP/2026/0001',
  status: 'awaiting_approval',
  customerPhone: '0712345678',
  customerName: 'Ada',
  productName: 'Phone',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue({ success: true, remaining: 10, resetAt: Date.now() + 60_000 })
  mockLookupRepair.mockResolvedValue(repair)
  mockLoadAppState.mockResolvedValue({
    // Setting omitted → verification required by default
    deed_systemSettings: {},
    deed_repairs_v2: [{
      ...repair,
      quote: {
        lines: [{ id: 'l1', description: 'Screen', qty: 1, unitPrice: 1000, subtotal: 1000, type: 'part' }],
        subtotal: 1000,
        tax: 0,
        total: 1000,
      },
    }],
    deed_invoices: [],
  })
})

describe('POST /api/portal/repair/:ref/approve phone verification', () => {
  it('returns 403 by default when verifyPhone is missing', async () => {
    const req = new NextRequest('http://localhost/api/portal/repair/REP%2F2026%2F0001/approve', {
      method: 'POST',
      body: JSON.stringify({ approved: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params: { ref: 'REP/2026/0001' } })
    expect(res.status).toBe(403)
  })

  it('returns 403 when verifyPhone does not match', async () => {
    const req = new NextRequest('http://localhost/api/portal/repair/REP%2F2026%2F0001/approve', {
      method: 'POST',
      body: JSON.stringify({ approved: true, verifyPhone: '0799999999' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params: { ref: 'REP/2026/0001' } })
    expect(res.status).toBe(403)
  })

  it('allows opt-out when settings explicitly disable verification', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_systemSettings: { secPortalRequirePhoneVerification: false },
      deed_repairs_v2: [{
        ...repair,
        quote: {
          lines: [{ id: 'l1', description: 'Screen', qty: 1, unitPrice: 1000, subtotal: 1000, type: 'part' }],
          subtotal: 1000,
          tax: 0,
          total: 1000,
        },
      }],
      deed_invoices: [],
    })
    // After verification is skipped, the handler continues into approval logic —
    // we only assert it did not 403 on phone check (may still succeed or hit later paths).
    const req = new NextRequest('http://localhost/api/portal/repair/REP%2F2026%2F0001/approve', {
      method: 'POST',
      body: JSON.stringify({ approved: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params: { ref: 'REP/2026/0001' } })
    expect(res.status).not.toBe(403)
  })
})
