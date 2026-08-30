import { describe, expect, it } from 'vitest'

import { generateTemporaryPassword, isStrongBootstrapPassword } from '@/lib/auth/temporary-credentials'

describe('temporary credential security', () => {
  it('uses strong mixed-class passwords', () => {
    for (let i = 0; i < 20; i += 1) {
      const value = generateTemporaryPassword()
      expect(value.length).toBeGreaterThanOrEqual(16)
      expect(value).toMatch(/[A-Z]/)
      expect(value).toMatch(/[a-z]/)
      expect(value).toMatch(/\d/)
      expect(value).toMatch(/[^A-Za-z0-9]/)
    }
  })

  it('requires a strong bootstrap password', () => {
    expect(isStrongBootstrapPassword('short')).toBe(false)
    expect(isStrongBootstrapPassword('onlylowercasepassword')).toBe(false)
    expect(isStrongBootstrapPassword('Strong-Bootstrap-Password-2026!')).toBe(true)
  })
})
