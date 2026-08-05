import { describe, it, expect } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  passwordMatchesHistory,
  MIN_PASSWORD_LENGTH,
} from '@/lib/auth/password'
import { normalizeUpdateUserInput } from '@/lib/auth/validation'
import { userUpdateSchema, validate } from '@/lib/validation'

describe('password policy (AGENT-SEC-001)', () => {
  it('exports a minimum length of 8', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8)
  })

  it('rejects 6-character passwords in normalizeUpdateUserInput', () => {
    expect(() => normalizeUpdateUserInput({ password: 'short1' })).toThrow(/at least 8/)
  })

  it('rejects 6-character passwords in userUpdateSchema', async () => {
    await expect(validate(userUpdateSchema, { password: 'short1' })).rejects.toThrow(/at least 8/)
  })

  it('accepts 8-character passwords in userUpdateSchema', async () => {
    await expect(validate(userUpdateSchema, { password: 'longpass1' })).resolves.toEqual({
      password: 'longpass1',
    })
  })

  it('verifies bcrypt hashes without needing a rehash', async () => {
    const hash = await hashPassword('CorrectHorse1!')
    const result = await verifyPassword('CorrectHorse1!', hash)
    expect(result).toEqual({ verified: true, needsRehash: false })
  })

  it('verifies legacy SHA-256 and sets needsRehash', async () => {
    const encoder = new TextEncoder()
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode('LegacyPass1'))
    const sha = Array.from(new Uint8Array(digest))
      .map(v => v.toString(16).padStart(2, '0'))
      .join('')

    const result = await verifyPassword('LegacyPass1', sha)
    expect(result).toEqual({ verified: true, needsRehash: true })

    const wrong = await verifyPassword('wrong-password', sha)
    expect(wrong).toEqual({ verified: false, needsRehash: false })
  })

  it('detects password reuse against current hash and history', async () => {
    const current = await hashPassword('CurrentPass1!')
    const older = await hashPassword('OlderPass12!')
    expect(await passwordMatchesHistory('CurrentPass1!', current, [older])).toBe(true)
    expect(await passwordMatchesHistory('OlderPass12!', current, [older])).toBe(true)
    expect(await passwordMatchesHistory('BrandNew99!', current, [older])).toBe(false)
  })
})
