import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it.each(['/sw.js', '/offline.html', '/manifest.json'])('serves %s without a session', async path => {
    getToken.mockResolvedValue(null)
    const response = await middleware(new NextRequest(`https://erp.example.test${path}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})

describe('internal notification routes', () => {
  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = 'internal-test-secret'
    getToken.mockResolvedValue(null)
  })

  it.each(['/api/notifications/send', '/api/admin/email-health'])(
    'allows %s through with the valid internal secret',
    async path => {
      const response = await middleware(new NextRequest(`https://erp.example.test${path}`, {
        headers: { 'x-internal-secret': 'internal-test-secret' },
      }))
      expect(response.status).toBe(200)
      expect(response.headers.get('x-middleware-next')).toBe('1')
    },
  )

  it('rejects notification calls with an invalid internal secret and no session', async () => {
    const response = await middleware(new NextRequest('https://erp.example.test/api/notifications/send', {
      headers: { 'x-internal-secret': 'wrong' },
    }))
    expect(response.status).toBe(401)
  })
})
