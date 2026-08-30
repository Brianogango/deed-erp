import { describe, expect, it } from 'vitest'
import { canWriteStoreKey, STORE_WRITE_POLICIES } from '@/lib/auth/store-write-policy'

const user = (role: string, modules: string[] = []) => ({ role, modules })

describe('legacy store write policy', () => {
  it('denies unknown namespaces by default', () => {
    expect(canWriteStoreKey(user('director', ['settings']), 'deed_attackerControlled')).toBe(false)
  })

  it('has an explicit policy for every intended high-risk ledger', () => {
    for (const key of [
      'deed_invoices',
      'deed_payments',
      'deed_journalEntries',
      'deed_bankAccounts',
      'deed_payrollRuns',
      'deed_purchaseOrders',
      'deed_repairs_v2',
      'deed_products',
      'deed_contacts',
    ]) {
      expect(STORE_WRITE_POLICIES[key], key).toBeTruthy()
    }
  })

  it('prevents technicians from writing finance ledgers', () => {
    expect(canWriteStoreKey(user('technician', ['repair']), 'deed_bankAccounts')).toBe(false)
    expect(canWriteStoreKey(user('technician', ['repair']), 'deed_journalEntries')).toBe(false)
    expect(canWriteStoreKey(user('technician', ['repair']), 'deed_payrollRuns')).toBe(false)
  })

  it('allows a technician to update the collaborative repair ledger only with repair module', () => {
    expect(canWriteStoreKey(user('technician', ['repair']), 'deed_repairs_v2')).toBe(true)
    expect(canWriteStoreKey(user('technician', []), 'deed_repairs_v2')).toBe(false)
  })

  it('prevents sales from writing inventory master data', () => {
    expect(canWriteStoreKey(user('sales_rep', ['sales']), 'deed_products')).toBe(false)
    expect(canWriteStoreKey(user('sales_rep', ['sales']), 'deed_serials')).toBe(false)
  })

  it('allows sales order writes only to users with the sales module', () => {
    expect(canWriteStoreKey(user('sales_rep', ['sales']), 'deed_saleOrders')).toBe(true)
    expect(canWriteStoreKey(user('sales_rep', ['crm']), 'deed_saleOrders')).toBe(false)
  })

  it('allows directors through explicit policies without requiring every module grant', () => {
    expect(canWriteStoreKey(user('director', []), 'deed_systemSettings')).toBe(true)
    expect(canWriteStoreKey(user('director', []), 'deed_bankRecons')).toBe(true)
  })
})
