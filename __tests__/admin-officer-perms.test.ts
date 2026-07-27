import { describe, expect, it } from 'vitest'
import {
  canPostOrPayCustomerInvoice,
  canPayOwnPostedInvoice,
  canManageBankRecon,
  canCancelOrResetInvoice,
  canReimburseExpense,
  mergeAppendOnlyJournals,
  paymentJournalRef,
  DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES,
} from '@/lib/finance-controls'
import { canCreateCustomerInvoiceFromSO, canManageFullFinance, canManageMoney } from '@/lib/auth/access'
import { canValidatePurchaseReceipt } from '@/lib/inventory/permissions'
import { APPROVAL_RULES } from '@/lib/sales-approvals'

describe('hybrid finance seals', () => {
  it('allows admin officer customer post/pay under threshold', () => {
    expect(canPostOrPayCustomerInvoice({
      role: 'admin_officer',
      invoiceType: 'customer_invoice',
      invoiceTotal: 50_000,
      limitKes: 100_000,
    }).ok).toBe(true)
  })

  it('blocks admin officer above customer invoice threshold', () => {
    const result = canPostOrPayCustomerInvoice({
      role: 'admin_officer',
      invoiceType: 'customer_invoice',
      invoiceTotal: 150_000,
      limitKes: 100_000,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/up to KES/)
  })

  it('blocks admin officer from vendor bill post/pay', () => {
    expect(canPostOrPayCustomerInvoice({
      role: 'admin_officer',
      invoiceType: 'vendor_bill',
      invoiceTotal: 1_000,
    }).ok).toBe(false)
  })

  it('keeps bank recon / cancel / expense reimbursement Finance+Director', () => {
    expect(canManageBankRecon('admin_officer')).toBe(false)
    expect(canManageBankRecon('finance_officer')).toBe(true)
    expect(canCancelOrResetInvoice('admin_officer')).toBe(false)
    expect(canReimburseExpense('admin_officer')).toBe(false)
    expect(canManageFullFinance('admin_officer')).toBe(false)
    expect(canManageMoney('admin_officer')).toBe(true)
  })

  it('enforces SoD above threshold for non-director', () => {
    const blocked = canPayOwnPostedInvoice({
      role: 'finance_officer',
      actorUserId: 'u1',
      postedByUserId: 'u1',
      invoiceTotal: DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES + 1,
    })
    expect(blocked.ok).toBe(false)
    expect(canPayOwnPostedInvoice({
      role: 'director',
      actorUserId: 'u1',
      postedByUserId: 'u1',
      invoiceTotal: 999_999,
    }).ok).toBe(true)
  })

  it('keeps payment journal refs deterministic', () => {
    expect(paymentJournalRef('INV/1', 'pay-1')).toBe('JRN/PAY/INV/1/pay-1')
  })

  it('merges journals append-only', () => {
    const existing = [{ ref: 'JRN/A', lines: [1] }]
    const ok = mergeAppendOnlyJournals(existing, [{ ref: 'JRN/A', lines: [1] }, { ref: 'JRN/B', lines: [2] }])
    expect(ok.ok).toBe(true)
    const edited = mergeAppendOnlyJournals(existing, [{ ref: 'JRN/A', lines: [9] }])
    expect(edited.ok).toBe(false)
    const deleted = mergeAppendOnlyJournals(existing, [])
    expect(deleted.ok).toBe(false)
  })
})

describe('sales approval + GRN permissions', () => {
  it('includes finance on deep discounts', () => {
    expect(APPROVAL_RULES.discount({ discountPercent: 55 })).toEqual(['director', 'finance_officer'])
  })

  it('allows sales roles to create SO invoices drafts and keeps GRN tight', () => {
    expect(canCreateCustomerInvoiceFromSO('admin_officer')).toBe(true)
    expect(canValidatePurchaseReceipt('technical_lead')).toBe(false)
    expect(canValidatePurchaseReceipt('admin_officer')).toBe(true)
  })
})
