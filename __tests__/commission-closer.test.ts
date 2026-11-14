import { describe, expect, it } from 'vitest'
import { isCommissionCloserRole, isPosInvoiceWrite, isRepairLinkedSaleOrder, salesCommissionAppliesToInvoice } from '@/lib/sales/commission-closer'


describe('commission closer eligibility', () => {
  it('treats sales, director, admin, and kilimall as closers — not finance or workshop', () => {
    expect(isCommissionCloserRole('sales_rep')).toBe(true)
    expect(isCommissionCloserRole('director')).toBe(true)
    expect(isCommissionCloserRole('admin_officer')).toBe(true)
    expect(isCommissionCloserRole('kilimall_officer')).toBe(true)
    expect(isCommissionCloserRole('finance_officer')).toBe(false)
    expect(isCommissionCloserRole('technician')).toBe(false)
  })

  
  
  
  it('only treats an explicit POS invoice flag as a till write', () => {
    expect(isPosInvoiceWrite({ isPosInvoice: true })).toBe(true)
    expect(isPosInvoiceWrite({ notes: 'POS POS/0017' })).toBe(false)
    expect(isPosInvoiceWrite({})).toBe(false)
  })

  it('never applies sales commission to repair invoices', () => {
    expect(salesCommissionAppliesToInvoice({ repairId: 'rep-1' })).toBe(false)
    expect(salesCommissionAppliesToInvoice({ repairId: null })).toBe(true)
    expect(salesCommissionAppliesToInvoice({})).toBe(true)
  })

  it('treats a repair-order SO as workshop billing, not a sales closer document', () => {
    expect(isRepairLinkedSaleOrder({ notes: 'Repair order REP/2026/001' })).toBe(true)
    expect(isRepairLinkedSaleOrder({ notes: 'Repair quote — REP/0289 — HP SPECTRE X360 14' })).toBe(true)
    expect(isRepairLinkedSaleOrder({ notes: 'Created from REP/0289' })).toBe(true)
    expect(isRepairLinkedSaleOrder({ notes: 'Urgent laptop' }, [{ repairId: 'rep-1' }])).toBe(true)
    expect(isRepairLinkedSaleOrder({ notes: 'Walk-in quote' }, [{ repairId: null }])).toBe(false)
  })

  })
