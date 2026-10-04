import { describe, expect, it } from 'vitest'
import { customerDevices, customerWaiting } from '@/lib/customer-360'

const repairs = [
  { id: 'r1', ref: 'REP/1', customerId: 'c1', status: 'awaiting_approval', productName: 'HP 840', serialNumber: 'SN-R1', quote: { total: 6500 } },
  { id: 'r2', ref: 'REP/2', customerId: 'c1', status: 'ready', productName: 'Dell 5400', serialNumber: 'SN-R2' },
  { id: 'r3', ref: 'REP/3', customerId: 'c2', status: 'ready', productName: 'Other', serialNumber: 'SN-X' },
]
const saleOrders = [
  { id: 'so1', ref: 'SO/1', customerId: 'c1', status: 'sale', total: 45000 },
  { id: 'so2', ref: 'SO/2', customerId: 'c1', status: 'quotation', total: 12000 },
]
const serials = [
  { id: 's1', serial: 'SN-BOUGHT', productName: 'ThinkPad T480s', status: 'sold', saleOrderId: 'so1', soldDate: '2026-09-01T10:00:00Z' },
  { id: 's2', serial: 'SN-STOCK', productName: 'HP', status: 'available', location: 'warehouse' },
]
const invoices = [
  { id: 'i1', ref: 'INV/1', partnerId: 'c1', type: 'customer_invoice', status: 'posted', total: 45000, amountPaid: 20000, dueDate: '2026-09-30' },
  { id: 'i2', ref: 'INV/2', partnerId: 'c1', type: 'customer_invoice', status: 'posted', total: 1000, amountPaid: 1000 },
]

describe('a customer at a glance', () => {
  it('lists what they bought and what they brought in for repair', () => {
    const devices = customerDevices({ contactId: 'c1', saleOrders, serials, repairs })
    expect(devices.map(d => d.serial)).toEqual(['SN-BOUGHT', 'SN-R1', 'SN-R2'])
    expect(devices[0]).toMatchObject({ how: 'Bought 2026-09-01', href: '/sales?id=so1' })
  })

  it('lists what is waiting on them: a quote, a collection, a quotation and a balance', () => {
    const waiting = customerWaiting({
      contactId: 'c1', repairs, saleOrders, invoices,
      invoiceHref: id => `/finance?invoice=${id}`,
      residual: i => Number(i.total) - Number(i.amountPaid),
    })
    expect(waiting.map(w => w.label)).toEqual([
      'Approve the quote for REP/1', 'Collect Dell 5400', 'Decide on quotation SO/2', 'Pay INV/1',
    ])
    expect(waiting[3]).toMatchObject({ detail: 'KES 25,000 due by 2026-09-30', tone: 'money' })
  })
})
