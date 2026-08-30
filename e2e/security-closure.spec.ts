import { test, expect } from '@playwright/test'
import { loginViaApi } from './helpers'

test.describe('security closure — anonymous and browser boundary', () => {
  test('security headers are present', async ({ request }) => {
    const res = await request.get('/login')
    expect(res.status()).toBe(200)
    expect(res.headers()['x-frame-options']).toBe('DENY')
    expect(res.headers()['x-content-type-options']).toBe('nosniff')
    expect(res.headers()['content-security-policy']).toContain("default-src 'self'")
    expect(res.headers()['content-security-policy']).toContain("object-src 'none'")
  })

  test('anonymous API access fails closed', async ({ request }) => {
    const res = await request.get('/api/store')
    expect(res.status()).toBe(401)
  })

  test('malformed bearer credential cannot produce a server error', async ({ request }) => {
    const res = await request.get('/api/store', {
      headers: { Authorization: 'Bearer %E0%A4%A' },
    })
    expect(res.status()).toBe(401)
  })

  test('bootstrap cannot be invoked without its secret', async ({ request }) => {
    const res = await request.post('/api/setup-admin', { data: {} })
    expect([401, 503]).toContain(res.status())
  })

  test('MFA verify is useless without a signed password challenge', async ({ request }) => {
    const res = await request.post('/api/auth/mfa/verify', { data: { code: '123456' } })
    expect(res.status()).toBe(401)
  })
})

test.describe('security closure — authenticated authorization boundary', () => {
  test('cross-origin authenticated store mutation is rejected', async ({ browser }) => {
    const context = await loginViaApi(browser)
    const res = await context.request.post('/api/store', {
      headers: {
        Origin: 'https://attacker.invalid',
        'Sec-Fetch-Site': 'cross-site',
      },
      data: { deed_profileImages: '{}' },
    })
    expect(res.status()).toBe(403)
    await context.close()
  })

  test('unknown app-state namespace is rejected even for director', async ({ browser }) => {
    const context = await loginViaApi(browser)
    const res = await context.request.post('/api/store', {
      data: { deed_attackerControlled: { injected: true } },
    })
    expect([400, 403]).toContain(res.status())
    await context.close()
  })

  test('single-key store path denies unregistered namespace', async ({ browser }) => {
    const context = await loginViaApi(browser)
    const res = await context.request.put('/api/store/deed_attackerControlled', {
      data: { value: '{}' },
    })
    expect([400, 403]).toContain(res.status())
    await context.close()
  })

  test('oversized/deep hostile JSON is rejected before business logic', async ({ browser }) => {
    const context = await loginViaApi(browser)
    let nested: any = 'x'
    for (let i = 0; i < 60; i++) nested = { next: nested }
    const res = await context.request.post('/api/store', {
      data: { deed_profileImages: nested },
    })
    expect([400, 413, 422]).toContain(res.status())
    await context.close()
  })
})
