import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: {} }))
vi.mock('@/lib/notifications/service', () => ({ publishNotificationEvent: vi.fn() }))
vi.mock('@/lib/accounting/integrity-suite', () => ({ runIntegritySuite: vi.fn() }))

import { unappliedVendorCredit } from '@/lib/notifications/operational-scanner'

describe('supplier credit still owed to Deed', () => {
  it('is the whole credit when nothing was applied (VCN/0089)', () => {
    expect(unappliedVendorCredit('vendor_bill', -4000, 0, 'VCN/0089')).toBe(4000)
  })

  it('is what is left after part was applied to a bill', () => {
    expect(unappliedVendorCredit('vendor_bill', -4000, -2500, 'VCN/0090')).toBe(1500)
  })

  it('is nothing once fully applied', () => {
    expect(unappliedVendorCredit('vendor_bill', -4000, -4000, 'VCN/0091')).toBe(0)
  })

  it('recognises a credit note by its number whatever its document type', () => {
    expect(unappliedVendorCredit('customer_invoice', -1000, 0, 'VCN/0092')).toBe(1000)
  })

  it('ignores ordinary bills and customer credit notes', () => {
    expect(unappliedVendorCredit('vendor_bill', 5000, 0, 'BILL/0001')).toBe(0)
    expect(unappliedVendorCredit('customer_invoice', -1000, 0, 'CN/0001')).toBe(0)
  })
})
