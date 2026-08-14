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
  it('allows admin officer to post or pay customer invoices of any amount', () => {
    expect(canPostOrPayCustomerInvoice({
      role: 'admin_officer',
      invoiceType: 'customer_invoice',
      invoiceTotal: 500_000,
      action: 'post',
    }).ok).toBe(true)
    expect(canPostOrPayCustomerInvoice({
      role: 'admin_officer',
      invoiceType: 'customer_invoice',
      invoiceTotal: DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES + 1,
      action: 'pay',
    }).ok).toBe(true)
  })

  it('allows admin officer to post vendor bills', () => {
    expect(canPostOrPayCustomerInvoice({
      role: 'admin_officer',
      invoiceType: 'vendor_bill',
      invoiceTotal: 1_000,
      action: 'post',
    }).ok).toBe(true)
  })

  it('blocks admin officer from paying vendor bills', () => {
    const result = canPostOrPayCustomerInvoice({
      role: 'admin_officer',
      invoiceType: 'vendor_bill',
      invoiceTotal: 1_000,
      action: 'pay',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/pay vendor bills/)
  })

  it('lets admin officer cancel or reset invoices but not bank recon or expense reimbursement', () => {
    expect(canCancelOrResetInvoice('admin_officer')).toBe(true)
    expect(canManageBankRecon('admin_officer')).toBe(false)
    expect(canManageBankRecon('finance_officer')).toBe(true)
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
    // Editing an existing posted ref is still rejected (immutability).
    const edited = mergeAppendOnlyJournals(existing, [{ ref: 'JRN/A', lines: [9] }])
    expect(edited.ok).toBe(false)
  })

  it('preserves server refs a stale/partial client omits (does not treat as deletion)', () => {
    const existing = [{ ref: 'JRN/A', lines: [1] }]
    // A client whose ledger is missing JRN/A is not deleting it — the ref is
    // preserved instead of rejecting the sync (which used to strand POS sales).
    const partial = mergeAppendOnlyJournals(existing, [])
    expect(partial.ok).toBe(true)
    if (partial.ok) expect(partial.merged).toEqual(existing)

    // New refs from a partial client merge in alongside the preserved server ref.
    const added = mergeAppendOnlyJournals(existing, [{ ref: 'JRN/C', lines: [3] }])
    expect(added.ok).toBe(true)
    if (added.ok) {
      const refs = (added.merged as Array<{ ref: string }>).map(r => r.ref).sort()
      expect(refs).toEqual(['JRN/A', 'JRN/C'])
    }
  })
})

describe('sales approval + GRN permissions', () => {
  it('lets director OR finance approve special pricing (single level)', () => {
    expect(APPROVAL_RULES.discount({ discountPercent: 55 })).toEqual(['director', 'finance_officer'])
    expect(APPROVAL_RULES.special_pricing({})).toEqual(['director', 'finance_officer'])
    expect(APPROVAL_RULES.backorder({ backorderQty: 12 })).toEqual([])
    expect(APPROVAL_RULES.purchase_high_value({ proposedValue: 80_000, threshold: 50_000 })).toEqual([])
  })

  it('allows sales roles to create SO invoices drafts and keeps GRN tight', () => {
    expect(canCreateCustomerInvoiceFromSO('admin_officer')).toBe(true)
    expect(canValidatePurchaseReceipt('technical_lead')).toBe(false)
    expect(canValidatePurchaseReceipt('admin_officer')).toBe(true)
  })
})
