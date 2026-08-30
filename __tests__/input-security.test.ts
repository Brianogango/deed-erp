import { describe, expect, it } from 'vitest'
import {
  InputSecurityError,
  assertSafeJsonValue,
  assertSafeRequestEnvelope,
  assertSafeStoreValue,
  assertSameOriginBrowserWrite,
  readSafeJson,
} from '@/lib/input-security'

function expectSecurityError(fn: () => unknown, code: string) {
  try {
    fn()
    throw new Error('Expected input security rejection')
  } catch (error) {
    expect(error).toBeInstanceOf(InputSecurityError)
    expect((error as InputSecurityError).code).toBe(code)
  }
}

describe('central input security', () => {
  it('rejects prototype-pollution keys parsed from JSON', () => {
    const payload = JSON.parse('{"safe":1,"__proto__":{"admin":true}}')
    expectSecurityError(() => assertSafeJsonValue(payload), 'prototype_pollution_key')
  })

  it('rejects deeply nested payloads', () => {
    let payload: any = { value: true }
    for (let i = 0; i < 25; i += 1) payload = { child: payload }
    expectSecurityError(() => assertSafeJsonValue(payload), 'input_too_deep')
  })

  it('rejects unsafe control characters in strings', () => {
    expectSecurityError(() => assertSafeJsonValue({ name: 'ok\u0000bad' }), 'unsafe_control_character')
  })

  it('enforces actual body size, not only Content-Length', async () => {
    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: '1234567890' }),
    })
    await expect(readSafeJson(req, { maxBytes: 8 })).rejects.toMatchObject({
      code: 'payload_too_large',
      status: 413,
    })
  })

  it('inspects JSON even when the caller lies with text/plain', async () => {
    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"constructor":{"prototype":{"polluted":true}}}',
    })
    await expect(assertSafeRequestEnvelope(req)).rejects.toMatchObject({
      code: 'prototype_pollution_key',
    })
  })

  it('inspects double-encoded legacy store values', () => {
    const inner = '{"safe":1,"prototype":{"polluted":true}}'
    expectSecurityError(() => assertSafeStoreValue(inner), 'prototype_pollution_key')
  })

  it('blocks a cross-site browser mutation', () => {
    const req = new Request('https://erp.deed.co.ke/api/store', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: '{}',
    })
    expectSecurityError(() => assertSameOriginBrowserWrite(req), 'cross_site_write')
  })

  it('allows a same-origin browser mutation', () => {
    const req = new Request('https://erp.deed.co.ke/api/store', {
      method: 'POST',
      headers: {
        Origin: 'https://erp.deed.co.ke',
        Host: 'erp.deed.co.ke',
        'X-Forwarded-Proto': 'https',
        'Sec-Fetch-Site': 'same-origin',
      },
      body: '{}',
    })
    expect(() => assertSameOriginBrowserWrite(req)).not.toThrow()
  })
})
