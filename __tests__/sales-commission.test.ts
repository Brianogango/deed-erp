import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    salesCommission: {
      createMany: vi.fn(),
    },
    invoice: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    saleOrder: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { postSalesCommissionForInvoice } from '@/lib/accounting/sales-commission'

const INVOICE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const SALE_ORDER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const SALESPERSON_USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const EMPLOYEE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const PRODUCT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

const REPAIR_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

const baseInvoice = {
  id: INVOICE_ID,
  saleOrderId: SALE_ORDER_ID,
  repairId: null,
  items: [{ productId: PRODUCT_ID, lineSubtotal: 10000 }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.invoice.findUnique.mockResolvedValue(baseInvoice)
  mockPrisma.saleOrder.findUnique.mockResolvedValue({ salespersonId: SALESPERSON_USER_ID })
  mockPrisma.user.findUnique.mockResolvedValue({ employeeId: EMPLOYEE_ID })
  mockPrisma.product.findMany.mockResolvedValue([
    { id: PRODUCT_ID, commissionRatePercent: 5, category: null },
  ])
})

describe('postSalesCommissionForInvoice', () => {
  it('is a no-op when the atomic claim loses the race (already computed/computing)', async () => {
    mockPrisma.invoice.updateMany.mockResolvedValue({ count: 0 })
    await postSalesCommissionForInvoice(INVOICE_ID)
    expect(mockPrisma.invoice.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.salesCommission.createMany).not.toHaveBeenCalled()
  })

  it('claims via an atomic updateMany scoped to this invoice with no prior claim', async () => {
    await postSalesCommissionForInvoice(INVOICE_ID)
    expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: INVOICE_ID, commissionComputedAt: null },
      data: { commissionComputedAt: expect.any(Date) },
    })
  })

  it('releases the claim and rethrows when a later step throws, so a retry can succeed', async () => {
    mockPrisma.invoice.findUnique.mockRejectedValue(new Error('transient db error'))
    await expect(postSalesCommissionForInvoice(INVOICE_ID)).rejects.toThrow('transient db error')
    expect(mockPrisma.invoice.updateMany).toHaveBeenLastCalledWith({
      where: { id: INVOICE_ID },
      data: { commissionComputedAt: null },
    })
  })

  it('does nothing for an invoice with no linked sale order', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ ...baseInvoice, saleOrderId: null })
    await postSalesCommissionForInvoice(INVOICE_ID)
    expect(mockPrisma.saleOrder.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.salesCommission.createMany).not.toHaveBeenCalled()
  })

  it('does nothing for a repair invoice even when a sale order closer is present', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ ...baseInvoice, repairId: REPAIR_ID })
    await postSalesCommissionForInvoice(INVOICE_ID, { salespersonUserId: SALESPERSON_USER_ID })
    expect(mockPrisma.saleOrder.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.salesCommission.createMany).not.toHaveBeenCalled()
  })

  it('posts POS commission from salespersonUserId when there is no sale order', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ ...baseInvoice, saleOrderId: null })
    await postSalesCommissionForInvoice(INVOICE_ID, { salespersonUserId: SALESPERSON_USER_ID })
    expect(mockPrisma.saleOrder.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.salesCommission.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        employeeId: EMPLOYEE_ID,
        invoiceId: INVOICE_ID,
        saleAmount: 10000,
        commissionRate: 5,
        commissionAmount: 500,
      })],
    })
  })

  it('prefers the sale-order closer over a POS override', async () => {
    await postSalesCommissionForInvoice(INVOICE_ID, { salespersonUserId: 'ignored-user' })
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: SALESPERSON_USER_ID },
      select: { employeeId: true },
    })
  })

  it('does nothing when the sale order has no salesperson', async () => {
    mockPrisma.saleOrder.findUnique.mockResolvedValue({ salespersonId: null })
    await postSalesCommissionForInvoice(INVOICE_ID)
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.salesCommission.createMany).not.toHaveBeenCalled()
  })

  it('does nothing when the salesperson has no linked Employee record', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ employeeId: null })
    await postSalesCommissionForInvoice(INVOICE_ID)
    expect(mockPrisma.product.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.salesCommission.createMany).not.toHaveBeenCalled()
  })

  it('uses the product-level rate when set', async () => {
    await postSalesCommissionForInvoice(INVOICE_ID)
    expect(mockPrisma.salesCommission.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        employeeId: EMPLOYEE_ID,
        invoiceId: INVOICE_ID,
        saleAmount: 10000,
        commissionRate: 5,
        commissionAmount: 500,
        isPaid: false,
      })],
    })
  })

  it('falls back to the category rate when the product has none', async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      { id: PRODUCT_ID, commissionRatePercent: null, category: { commissionRatePercent: 3 } },
    ])
    await postSalesCommissionForInvoice(INVOICE_ID)
    expect(mockPrisma.salesCommission.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ commissionRate: 3, commissionAmount: 300 })],
    })
  })

  it('creates nothing when neither the product nor its category has a rate', async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      { id: PRODUCT_ID, commissionRatePercent: null, category: null },
    ])
    await postSalesCommissionForInvoice(INVOICE_ID)
    expect(mockPrisma.salesCommission.createMany).not.toHaveBeenCalled()
  })

  it('skips line items with no productId', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      ...baseInvoice,
      items: [{ productId: null, lineSubtotal: 5000 }],
    })
    await postSalesCommissionForInvoice(INVOICE_ID)
    expect(mockPrisma.product.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.salesCommission.createMany).not.toHaveBeenCalled()
  })
})
