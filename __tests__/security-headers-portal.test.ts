import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  partnerCorsHeaders,
  parsePartnerCorsOrigins,
} from '@/lib/partner-api'
import { isPortalPhoneVerificationRequired } from '@/lib/portal-verify'

describe('partner CORS (AGENT-SEC-003)', () => {
  const original = process.env.PARTNER_CORS_ORIGINS

  afterEach(() => {
    if (original === undefined) delete process.env.PARTNER_CORS_ORIGINS
    else process.env.PARTNER_CORS_ORIGINS = original
  })

  it('parses comma-separated origins', () => {
    expect(parsePartnerCorsOrigins('https://a.example, https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ])
  })

  it('omits Allow-Origin when the list is empty (deny by default)', () => {
    process.env.PARTNER_CORS_ORIGINS = ''
    const headers = partnerCorsHeaders(new Request('http://localhost/api/public/v1/products', {
      headers: { origin: 'https://evil.example' },
    }))
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined()
    expect(headers['Access-Control-Allow-Headers']).not.toMatch(/Authorization/i)
  })

  it('rejects unknown origins', () => {
    process.env.PARTNER_CORS_ORIGINS = 'https://partner.example'
    const headers = partnerCorsHeaders(new Request('http://localhost/api/public/v1/products', {
      headers: { origin: 'https://evil.example' },
    }))
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('echoes an allow-listed origin', () => {
    process.env.PARTNER_CORS_ORIGINS = 'https://partner.example,https://other.example'
    const headers = partnerCorsHeaders(new Request('http://localhost/api/public/v1/products', {
      headers: { origin: 'https://partner.example' },
    }))
    expect(headers['Access-Control-Allow-Origin']).toBe('https://partner.example')
  })
})

describe('portal phone verification default (AGENT-SEC-003)', () => {
  it('requires verification when the setting is missing or true', () => {
    expect(isPortalPhoneVerificationRequired(undefined)).toBe(true)
    expect(isPortalPhoneVerificationRequired({})).toBe(true)
    expect(isPortalPhoneVerificationRequired({ secPortalRequirePhoneVerification: true })).toBe(true)
  })

  it('allows opt-out only when explicitly set to false', () => {
    expect(isPortalPhoneVerificationRequired({ secPortalRequirePhoneVerification: false })).toBe(false)
  })
})

describe('next.config security headers (AGENT-SEC-003)', () => {
  it('exports the required security headers', async () => {
    // next.config.js is CommonJS; require it in the test process.
    const mod = require('../next.config.js') as { SECURITY_HEADERS?: { key: string; value: string }[] }
    const headers = mod.SECURITY_HEADERS ?? []
    const byKey = Object.fromEntries(headers.map(h => [h.key, h.value]))
    expect(byKey['Content-Security-Policy']).toContain("default-src 'self'")
    expect(byKey['Content-Security-Policy']).toContain("object-src 'none'")
    expect(byKey['Content-Security-Policy']).toContain("frame-ancestors 'none'")
    expect(byKey['Content-Security-Policy']).not.toMatch(/script-src[^;]*https:/)
    expect(byKey['Strict-Transport-Security']).toContain('max-age=31536000')
    expect(byKey['X-Frame-Options']).toBe('DENY')
    expect(byKey['X-Content-Type-Options']).toBe('nosniff')
    expect(byKey['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(byKey['Permissions-Policy']).toContain('camera=()')
    expect(byKey['Cross-Origin-Opener-Policy']).toBe('same-origin')
    expect(byKey['Cross-Origin-Resource-Policy']).toBe('same-origin')
  })

  it('does not allow wildcard remote image hostnames', async () => {
    const mod = require('../next.config.js') as { images?: { remotePatterns?: { hostname: string }[] } }
    // withBundleAnalyzer wraps the config — pull from the wrapped export when needed.
    const patterns = mod.images?.remotePatterns
      ?? (mod as any).default?.images?.remotePatterns
      ?? []
    // SECURITY_HEADERS is on module.exports; images live on the analyzer-wrapped config.
    const cfg = require('../next.config.js')
    const remote = cfg.images?.remotePatterns ?? cfg.default?.images?.remotePatterns
    // bundle-analyzer returns a function or wrapped object — read source instead if needed.
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../next.config.js', import.meta.url), 'utf8')
    expect(src).not.toMatch(/hostname:\s*'\*\*'/)
    expect(src).toContain('erp.deed.co.ke')
    expect(src).toContain('img.kilimall.com')
    void patterns
    void remote
  })
})
