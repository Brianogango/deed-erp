import { describe, it, expect } from 'vitest'
import {
  canScheduleInvoiceDelivery,
  findInvoiceDeliveryJob,
} from '@/lib/invoice-delivery-job'
import type { DeliveryJob, Invoice } from '@/lib/store'

const baseInvoice = {
  id: 'inv-1',
  ref: 'INV-2026-0001',
  type: 'customer_invoice' as const,
  status: 'posted' as const,
}

const job = (overrides: Partial<DeliveryJob> = {}): DeliveryJob => ({
  id: 'job-1',
  ref: 'DJB/0005',
  type: 'sales_delivery',
  status: 'assigned',
  invoiceId: 'inv-1',
  invoiceRef: 'INV-2026-0001',
  customerName: 'Moses Gitonga',
  customerPhone: '+254700',
  pickupAddress: 'Deed',
  deliveryAddress: 'National Library',
  scheduledDate: '2026-08-04',
  riderFee: 400,
  deliveryFee: 500,
  billedTo: 'customer',
  notes: '',
  createdByUserId: 'u1',
  createdByName: 'Admin',
  createdAt: '2026-08-04T10:00:00.000Z',
  ...overrides,
})

describe('findInvoiceDeliveryJob', () => {
  it('finds by deliveryJobId or invoiceId and ignores cancelled/failed', () => {
    expect(findInvoiceDeliveryJob([job()], baseInvoice as Invoice)?.ref).toBe('DJB/0005')
    expect(findInvoiceDeliveryJob(
      [job({ id: 'job-linked' })],
      { ...baseInvoice, deliveryJobId: 'job-linked' } as Invoice,
    )?.id).toBe('job-linked')
    expect(findInvoiceDeliveryJob(
      [job({ status: 'cancelled' })],
      baseInvoice as Invoice,
    )).toBeUndefined()
  })
})

describe('canScheduleInvoiceDelivery', () => {
  it('allows customer invoices without an active job', () => {
    expect(canScheduleInvoiceDelivery(baseInvoice)).toBe(true)
    expect(canScheduleInvoiceDelivery({ ...baseInvoice, status: 'draft' })).toBe(true)
    expect(canScheduleInvoiceDelivery({ ...baseInvoice, type: 'vendor_bill' })).toBe(false)
    expect(canScheduleInvoiceDelivery({ ...baseInvoice, status: 'cancelled' })).toBe(false)
    expect(canScheduleInvoiceDelivery(baseInvoice, job())).toBe(false)
  })
})
