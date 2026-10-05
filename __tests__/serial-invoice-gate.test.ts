import { describe, it, expect } from 'vitest'
import { serialInvoiceBlock } from '@/lib/sales/serial-invoice-gate'

const laptop = ['HP EliteBook 845 G7']

describe('serial-tracked machines are invoiced only after delivery', () => {
  it('refuses a manual invoice for a laptop with no sale order', () => {
    expect(serialInvoiceBlock({ doc: {}, serialProductNames: laptop, deliveryValidated: false }))
      .toMatch(/HP EliteBook 845 G7 is serial-tracked/)
  })

  it('refuses a sale-order invoice until the delivery is validated', () => {
    expect(serialInvoiceBlock({ doc: { saleOrderId: 'so-4' }, serialProductNames: laptop, deliveryValidated: false }))
      .toMatch(/Validate the delivery/)
    expect(serialInvoiceBlock({ doc: { saleOrderId: 'so-4' }, serialProductNames: laptop, deliveryValidated: true })).toBeNull()
  })

  it('leaves services, POS, repairs, credit notes, opening balances and bills alone', () => {
    expect(serialInvoiceBlock({ doc: {}, serialProductNames: [], deliveryValidated: false })).toBeNull()
    for (const doc of [
      { isPosInvoice: true },
      { repairId: 'r-1' },
      { notes: 'Repair RPR/0042' },
      { isCreditNote: true },
      { isOpeningBalance: true },
      { internalNotes: '[opening-balance]' },
      { type: 'vendor_bill' },
      { purchaseOrderId: 'po-1' },
    ]) {
      expect(serialInvoiceBlock({ doc, serialProductNames: laptop, deliveryValidated: false })).toBeNull()
    }
  })
})
