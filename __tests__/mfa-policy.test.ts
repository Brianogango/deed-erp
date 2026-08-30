import { afterEach, describe, expect, it } from 'vitest'
import {
  isPrivilegedMfaRole,
  isPrivilegedMfaEnforced,
  requiresPrivilegedMfa,
} from '@/lib/auth/mfa-policy'

const original = process.env.MFA_ENFORCE_PRIVILEGED

afterEach(() => {
  if (original === undefined) delete process.env.MFA_ENFORCE_PRIVILEGED
  else process.env.MFA_ENFORCE_PRIVILEGED = original
})

describe('privileged MFA policy', () => {
  it('covers director, admin officer, and finance officer only', () => {
    expect(isPrivilegedMfaRole('director')).toBe(true)
    expect(isPrivilegedMfaRole('admin_officer')).toBe(true)
    expect(isPrivilegedMfaRole('finance_officer')).toBe(true)
    expect(isPrivilegedMfaRole('inventory_officer')).toBe(false)
    expect(isPrivilegedMfaRole('sales_rep')).toBe(false)
    expect(isPrivilegedMfaRole('technician')).toBe(false)
  })

  it('does not silently enforce before the rollout flag is enabled', () => {
    delete process.env.MFA_ENFORCE_PRIVILEGED
    expect(isPrivilegedMfaEnforced()).toBe(false)
    expect(requiresPrivilegedMfa('director')).toBe(false)
  })

  it('requires MFA for privileged roles when production enforcement is enabled', () => {
    process.env.MFA_ENFORCE_PRIVILEGED = 'true'
    expect(isPrivilegedMfaEnforced()).toBe(true)
    expect(requiresPrivilegedMfa('director')).toBe(true)
    expect(requiresPrivilegedMfa('admin_officer')).toBe(true)
    expect(requiresPrivilegedMfa('finance_officer')).toBe(true)
    expect(requiresPrivilegedMfa('technical_lead')).toBe(false)
  })
})
