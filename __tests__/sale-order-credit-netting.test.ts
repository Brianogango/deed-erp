import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockClientFindUnique, mockInvoiceFindMany, mockLoadAppState } = vi.hoisted(() => ({
  mockClientFindUnique: vi.fn(),
  mockInvoiceFindMany: vi.fn(),
  mockLoadAppState: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    client: { findUnique: mockClientFindUnique },
    invoice: { findMany: mockInvoiceFindMany },
  },
}))
vi.mock('@/lib/server-store', () => ({ loadAppState: mockLoadAppState }))

import { assertSaleOrderCreditOnConfirm } from '@/lib/sale-order-credit.server'

const CLIENT_ID = 'client-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockClientFindUnique.mockResolvedValue({ creditLimit: 10000, name: 'Acme' })
  mockInvoiceFindMany.mockResolvedValue([])
  mockLoadAppState.mockResolvedValue({})
})

describe('assertSaleOrderCreditOnConfirm — customer credit netting', () => {
  it('blocks confirm when outstanding + new order exceeds the limit and no credit is available', async () => {
    mockInvoiceFindMany.mockResolvedValue([{ totalAmount: 9000, amountPaid: 0, dueDate: null, status: 'approved' }])
    const res = await assertSaleOrderCreditOnConfirm({ clientId: CLIENT_ID, orderTotal: 5000, role: 'sales_rep' })
    expect(res.ok).toBe(false)
  })

  it('nets available customer store credit against outstanding before comparing to the limit', async () => {
    mockInvoiceFindMany.mockResolvedValue([{ totalAmount: 9000, amountPaid: 0, dueDate: null, status: 'approved' }])
    mockLoadAppState.mockResolvedValue({
      deed_customerCredits: [{ customerId: CLIENT_ID, status: 'available', balance: 5000 }],
    })
    // outstanding 9000 - credit 5000 = 4000; + order 5000 = 9000, within the 10000 limit.
    const res = await assertSaleOrderCreditOnConfirm({ clientId: CLIENT_ID, orderTotal: 5000, role: 'sales_rep' })
    expect(res.ok).toBe(true)
  })

  it('ignores credit notes belonging to a different customer', async () => {
    mockInvoiceFindMany.mockResolvedValue([{ totalAmount: 9000, amountPaid: 0, dueDate: null, status: 'approved' }])
    mockLoadAppState.mockResolvedValue({
      deed_customerCredits: [{ customerId: 'someone-else', status: 'available', balance: 5000 }],
    })
    const res = await assertSaleOrderCreditOnConfirm({ clientId: CLIENT_ID, orderTotal: 5000, role: 'sales_rep' })
    expect(res.ok).toBe(false)
  })

  it('ignores fully-used credit notes', async () => {
    mockInvoiceFindMany.mockResolvedValue([{ totalAmount: 9000, amountPaid: 0, dueDate: null, status: 'approved' }])
    mockLoadAppState.mockResolvedValue({
      deed_customerCredits: [{ customerId: CLIENT_ID, status: 'used', balance: 5000 }],
    })
    const res = await assertSaleOrderCreditOnConfirm({ clientId: CLIENT_ID, orderTotal: 5000, role: 'sales_rep' })
    expect(res.ok).toBe(false)
  })

  it('director/finance can still override regardless of credit', async () => {
    mockInvoiceFindMany.mockResolvedValue([{ totalAmount: 90000, amountPaid: 0, dueDate: null, status: 'approved' }])
    const res = await assertSaleOrderCreditOnConfirm({ clientId: CLIENT_ID, orderTotal: 5000, role: 'director' })
    expect(res.ok).toBe(true)
  })

  it('lets a quotation be created when the customer only has overdue invoices', async () => {
    mockInvoiceFindMany.mockResolvedValue([{ totalAmount: 9000, amountPaid: 0, dueDate: '2020-01-01', status: 'approved' }])
    const res = await assertSaleOrderCreditOnConfirm({
      clientId: CLIENT_ID,
      orderTotal: 1000,
      role: 'sales_rep',
      document: 'quote',
    })
    expect(res.ok).toBe(true)
  })

  it('blocks sale-order confirm and invoice create when invoices are overdue', async () => {
    mockInvoiceFindMany.mockResolvedValue([{ totalAmount: 9000, amountPaid: 0, dueDate: '2020-01-01', status: 'approved' }])
    const confirm = await assertSaleOrderCreditOnConfirm({ clientId: CLIENT_ID, orderTotal: 1000, role: 'sales_rep' })
    const invoice = await assertSaleOrderCreditOnConfirm({
      clientId: CLIENT_ID,
      orderTotal: 1000,
      role: 'sales_rep',
      document: 'invoice',
    })
    expect(confirm.ok).toBe(false)
    expect(invoice.ok).toBe(false)
    if (!confirm.ok) expect(confirm.error).toMatch(/overdue/i)
    if (!invoice.ok) expect(invoice.error).toMatch(/overdue/i)
  })
})
