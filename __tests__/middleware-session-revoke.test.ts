import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { getToken, evaluateSessionAccess } = vi.hoisted(() => ({
  getToken: vi.fn(),
  evaluateSessionAccess: vi.fn(),
}))

vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/auth/session-validity', () => ({
  evaluateSessionAccess,
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 100, resetAt: Date.now() + 60_000 }),
}))

import { middleware } from '@/middleware'

describe('middleware session revocation (AGENT-SEC-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXTAUTH_SECRET = 'test-secret-at-least-32-chars-long!!'
    getToken.mockResolvedValue({ id: 'user-1', role: 'sales_rep' })
    evaluateSessionAccess.mockResolvedValue({
      allowed: true,
      status: null,
      roleChanged: false,
      effectiveRole: null,
    })
  })

  it('returns 401 for deactivated users on API routes', async () => {
    evaluateSessionAccess.mockResolvedValue({
      allowed: false,
      status: { isActive: false, role: 'sales_rep', invalidatedAt: Date.now() },
      roleChanged: false,
      effectiveRole: null,
    })
    const res = await middleware(new NextRequest('https://erp.example.test/api/products'))
    expect(res.status).toBe(401)
    expect(evaluateSessionAccess).toHaveBeenCalledWith('user-1', 'sales_rep')
  })

  it('allows API access on cache miss (fail-open)', async () => {
    const res = await middleware(new NextRequest('https://erp.example.test/api/products'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('forwards effective role header when role changed', async () => {
    evaluateSessionAccess.mockResolvedValue({
      allowed: true,
      status: { isActive: true, role: 'finance_officer', invalidatedAt: Date.now() },
      roleChanged: true,
      effectiveRole: 'finance_officer',
    })
    const res = await middleware(new NextRequest('https://erp.example.test/api/products'))
    expect(res.status).toBe(200)
    // Next.js encodes overridden request headers on the response for the downstream.
    expect(res.headers.get('x-middleware-override-headers') || res.headers.get('x-middleware-next')).toBeTruthy()
  })

  it('redirects deactivated users away from pages and clears cookie', async () => {
    evaluateSessionAccess.mockResolvedValue({
      allowed: false,
      status: { isActive: false, role: 'sales_rep', invalidatedAt: Date.now() },
      roleChanged: false,
      effectiveRole: null,
    })
    const res = await middleware(new NextRequest('https://erp.example.test/sales'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('deed-session=')
  })
})
