import { describe, expect, it } from 'vitest'
import { canReadInvoiceRow, invoiceReadWhere } from '@/lib/accounting/invoice-read-scope'
import { filterStoreValueForRole } from '@/lib/auth/authorization'

const customerInvoice = { documentType: 'customer_invoice', invoiceNumber: 'INV/2026/0100', purchaseOrderId: null, repairId: null }
const repairInvoice = { ...customerInvoice, invoiceNumber: 'INV/2026/0101', repairId: 'r-1' }
const vendorBill = { documentType: 'vendor_bill', invoiceNumber: 'BILL/2026/0010', purchaseOrderId: null, repairId: null }
const draftBill = { documentType: 'customer_invoice', invoiceNumber: 'DRAFT/BILL/AB12', purchaseOrderId: null, repairId: null }
const rows = { customerInvoice, repairInvoice, vendorBill, draftBill }

const roles = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'kilimall_officer', 'sales_rep', 'technical_lead', 'technician'] as const

describe('invoice routes read what the store sync would send', () => {
  it.each(roles)('%s: same rows as the store filter', role => {
    for (const [name, row] of Object.entries(rows)) {
      const screen = { type: name === 'vendorBill' || name === 'draftBill' ? 'vendor_bill' : 'customer_invoice', repairId: row.repairId }
      const viaStore = (filterStoreValueForRole({ role } as never, 'deed_invoices', [screen]) as unknown[]).length > 0
      expect(canReadInvoiceRow({ role }, row), `${role} / ${name}`).toBe(viaStore)
    }
  })

  it('gives back office everything, sales only customer invoices, stock only bills', () => {
    expect(canReadInvoiceRow({ role: 'finance_officer' }, vendorBill)).toBe(true)
    expect(canReadInvoiceRow({ role: 'sales_rep' }, vendorBill)).toBe(false)
    expect(canReadInvoiceRow({ role: 'sales_rep' }, customerInvoice)).toBe(true)
    expect(canReadInvoiceRow({ role: 'inventory_officer' }, customerInvoice)).toBe(false)
    expect(canReadInvoiceRow({ role: 'inventory_officer' }, draftBill)).toBe(true)
    expect(canReadInvoiceRow({ role: 'technician' }, customerInvoice)).toBe(false)
    expect(canReadInvoiceRow({ role: 'technician' }, repairInvoice)).toBe(true)
  })

  it('treats an unknown role as having no access', () => {
    expect(canReadInvoiceRow({ role: 'nobody' }, customerInvoice)).toBe(false)
    expect(invoiceReadWhere({ role: 'nobody' })).toEqual({ id: { in: [] } })
  })

  it('builds a where that matches the role', () => {
    expect(invoiceReadWhere({ role: 'director' })).toEqual({})
    expect(invoiceReadWhere({ role: 'technician' })).toEqual({ repairId: { not: null } })
    expect(invoiceReadWhere({ role: 'sales_rep' })).toHaveProperty('NOT')
    expect(invoiceReadWhere({ role: 'inventory_officer' })).toHaveProperty('OR')
  })

  it('lets a custom role that posts or collects money read the whole ledger', () => {
    expect(canReadInvoiceRow({ role: 'sales_rep', permissions: ['recordPayment'] }, vendorBill)).toBe(true)
    expect(invoiceReadWhere({ role: 'sales_rep', permissions: ['recordPayment'] })).toEqual({})
  })
})
