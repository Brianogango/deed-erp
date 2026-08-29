/**
 * DIA write tools: create_quotation and create_invoice create real documents
 * from natural language, with live catalog prices and the caller's identity.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma, mockGetNextDocNumber } = vi.hoisted(() => ({
  mockPrisma: {
    client: { findFirst: vi.fn() },
    product: { findFirst: vi.fn() },
    saleOrder: { create: vi.fn() },
    invoice: { create: vi.fn() },
  },
  mockGetNextDocNumber: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: mockGetNextDocNumber }))

import { createQuotationTool } from '@/lib/jarvis/tools/create-quotation'
import { createInvoiceTool } from '@/lib/jarvis/tools/create-invoice'

const ctx = { user: { id: 'u-1', name: 'Brian', username: 'brian', role: 'director' as any }, conversationId: null, ipAddress: null } as any

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.client.findFirst.mockResolvedValue({ id: 'c-1', name: 'Acme Ltd', companyName: 'Acme Ltd' })
  mockPrisma.product.findFirst.mockImplementation(({ where }: any) => {
    const q = String(where?.OR?.[0]?.name?.contains ?? '')
    if (/laptop/i.test(q)) return Promise.resolve({ id: 'p-1', name: 'HP ProBook 450', sellingPrice: 85000 })
    if (/mouse/i.test(q)) return Promise.resolve({ id: 'p-2', name: 'Logitech Mouse', sellingPrice: 1500 })
    return Promise.resolve(null)
  })
  mockGetNextDocNumber.mockImplementation((kind: string) => Promise.resolve(kind === 'quotation' ? 'QUO/2026/0042' : 'INV/2026/0042'))
  mockPrisma.saleOrder.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'so-1', orderNumber: data.orderNumber, items: [] }))
  mockPrisma.invoice.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'inv-1', invoiceNumber: data.invoiceNumber, items: [] }))
})

describe('create_quotation', () => {
  it('creates a real quotation with catalog prices as the caller', async () => {
    const result = await createQuotationTool.run(ctx, {
      customerQuery: 'Acme',
      lines: [{ productQuery: 'laptop', qty: 2 }, { productQuery: 'mouse', qty: 1 }],
    }) as any
    expect(result.ok).toBe(true)
    expect(result.ref).toBe('QUO/2026/0042')
    expect(result.total).toBe(171500)
    const createData = mockPrisma.saleOrder.create.mock.calls[0][0].data
    expect(createData.status).toBe('quotation')
    expect(createData.createdById).toBe('u-1')
    expect(createData.items.create).toHaveLength(2)
  })

  it('refuses when the customer does not exist', async () => {
    mockPrisma.client.findFirst.mockResolvedValue(null)
    const result = await createQuotationTool.run(ctx, { customerQuery: 'Nobody', lines: [{ productQuery: 'laptop', qty: 1 }] }) as any
    expect(result.ok).toBe(false)
    expect(mockPrisma.saleOrder.create).not.toHaveBeenCalled()
  })

  it('refuses when no products match', async () => {
    const result = await createQuotationTool.run(ctx, { customerQuery: 'Acme', lines: [{ productQuery: 'nonexistent', qty: 1 }] }) as any
    expect(result.ok).toBe(false)
    expect(mockPrisma.saleOrder.create).not.toHaveBeenCalled()
  })
})

describe('create_invoice', () => {
  it('creates a DRAFT invoice with catalog prices for finance review', async () => {
    const result = await createInvoiceTool.run(ctx, {
      customerQuery: 'Acme',
      lines: [{ productQuery: 'laptop', qty: 1 }],
    }) as any
    expect(result.ok).toBe(true)
    expect(result.ref).toBe('INV/2026/0042')
    const createData = mockPrisma.invoice.create.mock.calls[0][0].data
    expect(createData.status).toBe('draft')
    expect(createData.documentType).toBe('customer_invoice')
    expect(createData.createdById).toBe('u-1')
  })

  it('refuses when the customer does not exist', async () => {
    mockPrisma.client.findFirst.mockResolvedValue(null)
    const result = await createInvoiceTool.run(ctx, { customerQuery: 'Nobody', lines: [{ productQuery: 'laptop', qty: 1 }] }) as any
    expect(result.ok).toBe(false)
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled()
  })
})
