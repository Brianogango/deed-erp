import { describe, expect, it } from 'vitest'
import { canCreateCustomerInvoiceFromSO, canManageMoney } from '@/lib/auth/access'
import { canValidatePurchaseReceipt } from '@/lib/inventory/permissions'

describe('customer invoice and payment permissions', () => {
  it('allows director, finance, and admin officer to draft-invoice from SO', () => {
    expect(canCreateCustomerInvoiceFromSO('director')).toBe(true)
    expect(canCreateCustomerInvoiceFromSO('finance_officer')).toBe(true)
    expect(canCreateCustomerInvoiceFromSO('admin_officer')).toBe(true)
  })

  it('allows director, finance, and admin officer to post invoice / take payment', () => {
    expect(canManageMoney('director')).toBe(true)
    expect(canManageMoney('finance_officer')).toBe(true)
    expect(canManageMoney('admin_officer')).toBe(true)
  })

  it('blocks operational roles from invoicing and payments', () => {
    expect(canCreateCustomerInvoiceFromSO('inventory_officer')).toBe(false)
    expect(canCreateCustomerInvoiceFromSO('technical_lead')).toBe(false)
    expect(canCreateCustomerInvoiceFromSO('sales_rep')).toBe(false)
    expect(canManageMoney('inventory_officer')).toBe(false)
    expect(canManageMoney('technical_lead')).toBe(false)
    expect(canManageMoney('sales_rep')).toBe(false)
  })

  it('keeps GRN validation without technical_lead', () => {
    expect(canValidatePurchaseReceipt('admin_officer')).toBe(true)
    expect(canValidatePurchaseReceipt('technical_lead')).toBe(false)
  })
})
