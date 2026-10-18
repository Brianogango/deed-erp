import { describe, expect, it } from 'vitest'
import { PASSWORD_RULES, passwordPolicyError } from '@/lib/auth/password-policy'

describe('password rules shown to people', () => {
  it('say exactly what the server enforces', () => {
    const samples = ['short1!A', 'alllowercase123!', 'ALLUPPERCASE123!', 'NoNumbersHere!!', 'NoSymbols12345A', 'Good-Pass-2026!x']
    for (const sample of samples) {
      const allMet = PASSWORD_RULES.every(rule => rule.test(sample))
      expect(allMet).toBe(passwordPolicyError(sample) === null)
    }
  })
  it('lists length first', () => {
    expect(PASSWORD_RULES[0].label).toBe('At least 12 characters')
  })
})
