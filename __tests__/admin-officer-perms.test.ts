import { describe, expect, it } from 'vitest'
import { canCreateCustomerInvoiceFromSO, canManageMoney } from '@/lib/auth/access'

describe('customer invoice from SO permissions', () => {
  it('allows director, finance, and admin officer to draft-invoice from SO', () => {
    expect(canCreateCustomerInvoiceFromSO('director')).toBe(true)
    expect(canCreateCustomerInvoiceFromSO('finance_officer')).toBe(true)
    expect(canCreateCustomerInvoiceFromSO('admin_officer')).toBe(true)
  })

  it('blocks operational roles from drafting invoices from SO', () => {
    expect(canCreateCustomerInvoiceFromSO('inventory_officer')).toBe(false)
    expect(canCreateCustomerInvoiceFromSO('technical_lead')).toBe(false)
    expect(canCreateCustomerInvoiceFromSO('sales_rep')).toBe(false)
    expect(canCreateCustomerInvoiceFromSO('technician')).toBe(false)
  })

  it('keeps post/pay Finance-only (admin officer excluded)', () => {
    expect(canManageMoney('director')).toBe(true)
    expect(canManageMoney('finance_officer')).toBe(true)
    expect(canManageMoney('admin_officer')).toBe(false)
  })
})
