import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Partner API scope boundary (test environment for the partner integration) ─
// The partner API key is only ever read by one route
// (app/api/public/v1/products) via authenticatePartnerRequest(). Every other
// /api/* route is gated by middleware.ts, which requires a valid NextAuth
// session cookie and never inspects X-API-Key / Authorization: Bearer
// deed_pk_... Proves that a partner presenting only their API key (no ERP
// session) is rejected before reaching any internal route — invoices,
// customers, payroll, users, cost prices, settings, etc.

const { getToken, evaluateSessionAccess } = vi.hoisted(() => ({
  getToken: vi.fn(),
  evaluateSessionAccess: vi.fn(),
}))

vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/auth/session-validity', () => ({ evaluateSessionAccess }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 100, resetAt: Date.now() + 60_000 }),
}))

import { middleware } from '@/middleware'

const PARTNER_KEY = 'deed_pk_test-partner-key-0123456789ab'

// A representative sample spanning every sensitive category: financial,
// customer/CRM, HR/payroll, user & settings admin, and the *internal*
// products endpoint (which carries cost price — unlike the public one).
const PROTECTED_ROUTES = [
  '/api/invoices',
  '/api/payments',
  '/api/purchase-orders',
  '/api/accounting',
  '/api/contacts',
  '/api/leads',
  '/api/opportunities',
  '/api/sale-orders',
  '/api/employees',
  '/api/payroll',
  '/api/salary-advances',
  '/api/users',
  '/api/settings',
  '/api/admin',
  '/api/partner-keys',
  '/api/products', // internal catalog — exposes costPrice, unlike /api/public/v1/products
  '/api/serials',
  '/api/stock-moves',
  '/api/inventory',
  '/api/store',
]

function partnerOnlyRequest(path: string, keyHeader: 'authorization' | 'x-api-key' = 'x-api-key') {
  const headers: Record<string, string> = keyHeader === 'authorization'
    ? { authorization: `Bearer ${PARTNER_KEY}` }
    : { 'x-api-key': PARTNER_KEY }
  return new NextRequest(`https://erp.example.test${path}`, { headers })
}

describe('partner API key cannot reach internal routes (scope boundary)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXTAUTH_SECRET = 'test-secret-at-least-32-chars-long!!'
    // A partner key is not a NextAuth session token — getToken correctly
    // returns null for a request that only carries X-API-Key/Bearer.
    getToken.mockResolvedValue(null)
    evaluateSessionAccess.mockResolvedValue({ allowed: true, status: null, roleChanged: false, effectiveRole: null })
  })

  it.each(PROTECTED_ROUTES)('rejects a partner key on %s (X-API-Key)', async (path) => {
    const res = await middleware(partnerOnlyRequest(path, 'x-api-key'))
    expect(res.status).toBe(401)
  })

  it.each(PROTECTED_ROUTES)('rejects a partner key on %s (Authorization: Bearer)', async (path) => {
    const res = await middleware(partnerOnlyRequest(path, 'authorization'))
    expect(res.status).toBe(401)
  })

  it('lets the public catalog route through middleware without a session', async () => {
    const res = await middleware(partnerOnlyRequest('/api/public/v1/products', 'x-api-key'))
    // Middleware defers auth to the route itself for /api/public/*; it must
    // not redirect/401 here purely for lacking a session cookie.
    expect(res.status).not.toBe(401)
    expect(getToken).not.toHaveBeenCalled()
  })

  it('lets the public guide route through middleware without a session', async () => {
    const res = await middleware(partnerOnlyRequest('/api/public/v1/guide', 'x-api-key'))
    expect(res.status).not.toBe(401)
  })

  it('never calls evaluateSessionAccess for a partner-key-only request (no session to evaluate)', async () => {
    await middleware(partnerOnlyRequest('/api/invoices', 'x-api-key'))
    expect(evaluateSessionAccess).not.toHaveBeenCalled()
  })
})
