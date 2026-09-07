import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { getToken } = vi.hoisted(() => ({
  getToken: vi.fn(),
}))

vi.mock('next-auth/jwt', () => ({
  getToken,
}))

import { LEGACY_ROUTE_REDIRECTS, middleware } from '@/middleware'

describe('legacy ERP route aliases', () => {
  beforeEach(() => {
    getToken.mockResolvedValue({ id: 'user-1' })
  })

  it.each(Object.entries(LEGACY_ROUTE_REDIRECTS))('redirects %s to %s', async (source, destination) => {
    const response = await middleware(new NextRequest(`https://erp.example.test${source}`))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(`https://erp.example.test${destination}`)
  })

  it('preserves the query string when redirecting an alias', async () => {
    const response = await middleware(
      new NextRequest('https://erp.example.test/purchase?status=draft&vendor=42'),
    )

    expect(response.headers.get('location')).toBe(
      'https://erp.example.test/purchases?status=draft&vendor=42',
    )
  })

  it('sends the retired operations URL to inventory without dropping query params', async () => {
    const response = await middleware(
      new NextRequest('https://erp.example.test/operations?tab=reports&serial=ABC'),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://erp.example.test/inventory?tab=reports&serial=ABC',
    )
  })

  it('does not bounce the canonical inventory route', async () => {
    const response = await middleware(
      new NextRequest('https://erp.example.test/inventory?tab=transfers'),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('does not redirect an already canonical route', async () => {
    const response = await middleware(
      new NextRequest('https://erp.example.test/purchases?status=draft'),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('redirects the retired HR users tab to Settings access', async () => {
    const response = await middleware(
      new NextRequest('https://erp.example.test/hr?tab=system_users'),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://erp.example.test/settings?tab=users')
  })

  it('allows Telerivet status webhooks without a session', async () => {
    getToken.mockClear()
    getToken.mockResolvedValue(null)
    const response = await middleware(
      new NextRequest('https://erp.example.test/api/webhooks/notifications/telerivet', { method: 'POST' }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(getToken).not.toHaveBeenCalled()
  })

  it.each(['/sw.js', '/deed-notifications-sw.js', '/offline.html', '/manifest.json'])('serves %s without a session', async path => {
    getToken.mockResolvedValue(null)
    const response = await middleware(new NextRequest(`https://erp.example.test${path}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})

describe('visual regression authentication bypass', () => {
  beforeEach(() => {
    getToken.mockClear()
    getToken.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('allows local visual regression pages without a session', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('VISREG_BYPASS_AUTH', 'true')

    const response = await middleware(new NextRequest('https://erp.example.test/sales'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(getToken).not.toHaveBeenCalled()
  })

  it('never bypasses page authentication in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VISREG_BYPASS_AUTH', 'true')

    const response = await middleware(new NextRequest('https://erp.example.test/sales'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
    expect(getToken).toHaveBeenCalled()
  })
})
