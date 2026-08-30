import { describe, expect, it } from 'vitest'

// next.config.js is CommonJS by design.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require('../next.config.js')

const headers = new Map<string, string>(
  (config.SECURITY_HEADERS || []).map((entry: { key: string; value: string }) => [entry.key, entry.value]),
)

describe('browser security headers', () => {
  it('enforces HSTS', () => {
    expect(headers.get('Strict-Transport-Security')).toContain('max-age=31536000')
  })

  it('enforces a CSP with the critical containment directives', () => {
    const csp = headers.get('Content-Security-Policy') || ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain('upgrade-insecure-requests')
  })

  it('blocks framing and MIME sniffing', () => {
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})
