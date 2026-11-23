import { describe, it, expect } from 'vitest'
import { openPasskeyChallenge, passkeyDeviceName, passkeyOrigins, passkeyRpId, sealPasskeyChallenge } from '@/lib/auth/passkey-core'

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null })

describe('which site a passkey belongs to', () => {
  it('uses the site the person is on, without the port', () => {
    expect(passkeyRpId(headers({ host: 'erp.deed.co.ke' }), {})).toBe('erp.deed.co.ke')
    expect(passkeyRpId(headers({ host: 'localhost:3100' }), {})).toBe('localhost')
    expect(passkeyRpId(headers({ 'x-forwarded-host': 'erp.deed.co.ke', host: '127.0.0.1:3000' }), {})).toBe('erp.deed.co.ke')
  })
  it('a configured domain wins', () => {
    expect(passkeyRpId(headers({ host: '127.0.0.1:3000' }), { WEBAUTHN_RP_ID: 'erp.deed.co.ke' })).toBe('erp.deed.co.ke')
  })
  it('accepts the page origin behind the proxy and the configured app URL', () => {
    const origins = passkeyOrigins(headers({ host: 'erp.deed.co.ke', 'x-forwarded-proto': 'https' }), { NEXT_PUBLIC_APP_URL: 'https://erp.deed.co.ke/' })
    expect(origins).toEqual(['https://erp.deed.co.ke'])
    expect(passkeyOrigins(headers({ host: 'localhost:3100' }), {})).toEqual(['http://localhost:3100'])
  })
})

describe('the signed challenge', () => {
  const secret = 'test-secret'
  it('opens what it sealed, for the same purpose', () => {
    const sealed = sealPasskeyChallenge({ c: 'abc', m: 'register', u: 'u1' }, secret, 1000)
    expect(openPasskeyChallenge(sealed, secret, 2000)).toMatchObject({ c: 'abc', m: 'register', u: 'u1' })
  })
  it('refuses a tampered, expired or wrongly signed one', () => {
    const sealed = sealPasskeyChallenge({ c: 'abc', m: 'login' }, secret, 1000)
    const [body, mac] = sealed.split('.')
    const forged = Buffer.from(JSON.stringify({ c: 'abc', m: 'register', u: 'attacker', exp: 9e12 })).toString('base64url')
    expect(openPasskeyChallenge(`${forged}.${mac}`, secret, 2000)).toBeNull()
    expect(openPasskeyChallenge(sealed, secret, 1000 + 6 * 60 * 1000)).toBeNull()
    expect(openPasskeyChallenge(sealed, 'other-secret', 2000)).toBeNull()
    expect(openPasskeyChallenge(`${body}`, secret, 2000)).toBeNull()
    expect(openPasskeyChallenge(undefined, secret, 2000)).toBeNull()
  })
})

describe('device names', () => {
  it('names the phone or computer', () => {
    expect(passkeyDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone')
    expect(passkeyDeviceName('Mozilla/5.0 (Linux; Android 14; SM-A546E) Mobile Safari')).toBe('Android phone')
    expect(passkeyDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('Mac')
    expect(passkeyDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows PC')
    expect(passkeyDeviceName('')).toBe('This device')
  })
})
