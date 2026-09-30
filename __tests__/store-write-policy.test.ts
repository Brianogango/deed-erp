import { describe, expect, it } from 'vitest'
import { ALL_CLIENT_APP_STATE_KEYS } from '@/lib/app-state-hydration'
import { canWriteStoreKey, STORE_WRITE_POLICIES } from '@/lib/auth/store-write-policy'

const user = (role: string, modules: string[] = []) => ({ role, modules })

describe('legacy store write policy', () => {
  it('denies unknown namespaces by default', () => {
    expect(canWriteStoreKey(user('director', ['settings']), 'deed_attackerControlled')).toBe(false)
  })

  it('requires an explicit ACL for every client-writable app-state key', () => {
    const missing = ALL_CLIENT_APP_STATE_KEYS.filter(key => !STORE_WRITE_POLICIES[key])
    expect(missing, `Missing store write policies: ${missing.join(', ')}`).toEqual([])
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

  it('lets an inventory officer with the Outsource module record a job and its vendor', () => {
    // REGRESSION 25-Sep-2026: David (inventory_officer) outsourced machines
    // four times; every save was DENIED and the jobs never reached the server.
    const officer = { role: 'inventory_officer', modules: ['inventory', 'outsource'] }
    expect(canWriteStoreKey(officer, 'deed_outsourceJobs')).toBe(true)
    expect(canWriteStoreKey(officer, 'deed_outsourceVendors')).toBe(true)
  })

  it('still keeps vendor payments with Finance', () => {
    const officer = { role: 'inventory_officer', modules: ['inventory', 'outsource'] }
    expect(canWriteStoreKey(officer, 'deed_outsourcePayments')).toBe(false)
  })

  it('does not open outsource jobs to an inventory officer without the module', () => {
    expect(canWriteStoreKey({ role: 'inventory_officer', modules: ['inventory'] }, 'deed_outsourceJobs')).toBe(false)
  })

  it('lets a sales rep set the payment details printed on their documents', () => {
    // 28-Sep-2026: a sales rep's payment-details save was refused.
    expect(canWriteStoreKey({ role: 'sales_rep', modules: ['sales'] }, 'deed_documentPaymentDetails')).toBe(true)
    expect(canWriteStoreKey({ role: 'technician', modules: ['sales'] }, 'deed_documentPaymentDetails')).toBe(false)
  })

  it('lets whoever outsources a repair save the repair it holds', () => {
    // The repair is held "in repair" while at the vendor and moved to QC when
    // it returns; an inventory officer sending it out must be able to save that.
    expect(canWriteStoreKey({ role: 'inventory_officer', modules: ['outsource'] }, 'deed_repairs_v2')).toBe(true)
    expect(canWriteStoreKey({ role: 'admin_officer', modules: ['outsource'] }, 'deed_repairs_v2')).toBe(true)
    expect(canWriteStoreKey({ role: 'sales_rep', modules: ['outsource'] }, 'deed_repairs_v2')).toBe(false)
  })
})

describe('trade-ins raised from the repair screen', () => {
  it('saves for a technical lead, who may create them there', () => {
    const lead = { role: 'technical_lead', modules: ['repair'] }
    expect(canWriteStoreKey(lead as any, 'deed_buyBacks')).toBe(true)
    expect(canWriteStoreKey(lead as any, 'deed_serials')).toBe(true)
  })

  it('saves for an admin officer with repair access but not After Sales or Inventory', () => {
    const admin = { role: 'admin_officer', modules: ['repair'] }
    expect(canWriteStoreKey(admin as any, 'deed_buyBacks')).toBe(true)
    expect(canWriteStoreKey(admin as any, 'deed_serials')).toBe(true)
  })

  it('saves for an inventory officer booking a trade-in in', () => {
    const inv = { role: 'inventory_officer', modules: ['inventory'] }
    expect(canWriteStoreKey(inv as any, 'deed_buyBacks')).toBe(true)
    expect(canWriteStoreKey({ role: 'inventory', modules: ['inventory'] } as any, 'deed_buyBacks')).toBe(true)
  })

  it('still refuses technicians', () => {
    const tech = { role: 'technician', modules: ['repair'] }
    expect(canWriteStoreKey(tech as any, 'deed_buyBacks')).toBe(false)
    expect(canWriteStoreKey(tech as any, 'deed_serials')).toBe(false)
  })
})
