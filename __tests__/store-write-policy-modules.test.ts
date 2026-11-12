/**
 * A write rule naming a module that does not exist refuses everyone but the
 * Director, silently: the Company Property register named 'property' (the
 * module is company_property), and an Admin Officer's whole register never
 * reached the server.
 */
import { describe, expect, it } from 'vitest'
import { STORE_WRITE_POLICIES, canWriteStoreKey } from '@/lib/auth/store-write-policy'
import { MODULE_IDS, ROLE_DEFAULT_MODULES } from '@/lib/auth/types'

describe('store write rules', () => {
  it('only name modules that exist', () => {
    const bad = Object.entries(STORE_WRITE_POLICIES).flatMap(([key, rule]) =>
      (rule.modules ?? []).filter(m => !(MODULE_IDS as readonly string[]).includes(m)).map(m => `${key}: ${m}`))
    expect(bad).toEqual([])
  })

  it('an Admin Officer can save the Company Property register and company settings', () => {
    const admin = { role: 'admin_officer', modules: ROLE_DEFAULT_MODULES.admin_officer }
    expect(canWriteStoreKey(admin, 'deed_companyAssets')).toBe(true)
    expect(canWriteStoreKey(admin, 'deed_companySettings')).toBe(true)
    expect(canWriteStoreKey(admin, 'deed_systemSettings')).toBe(false)
    expect(canWriteStoreKey({ role: 'sales_rep', modules: ROLE_DEFAULT_MODULES.sales_rep }, 'deed_companyAssets')).toBe(false)
  })
})
