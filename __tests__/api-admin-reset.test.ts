import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockListCerts,
  mockClearTables,
  mockSql,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockListCerts: vi.fn(),
  mockClearTables: vi.fn(),
  mockSql: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetSession }))
vi.mock('@/lib/blob-cutover.server', () => ({ listCutoverCertificates: mockListCerts }))
vi.mock('@/lib/blob-cutover', () => ({ uncertifiedProtectedKeys: () => [] }))
vi.mock('@/lib/auth/db', () => ({ sql: mockSql }))
vi.mock('@/lib/prisma', () => ({
  default: {
    paymentAllocation: { deleteMany: vi.fn() },
    payment: { deleteMany: vi.fn() },
    invoiceItem: { deleteMany: vi.fn() },
    invoice: { deleteMany: vi.fn() },
    saleOrderItem: { deleteMany: vi.fn() },
    saleOrder: { deleteMany: vi.fn() },
    purchaseOrderItem: { deleteMany: vi.fn() },
    purchaseOrder: { deleteMany: vi.fn() },
    repairPart: { deleteMany: vi.fn() },
    repairStage: { deleteMany: vi.fn() },
    repairDiagnostic: { deleteMany: vi.fn() },
    repairClientCommunication: { deleteMany: vi.fn() },
    repair: { deleteMany: vi.fn() },
    serialNumber: { deleteMany: vi.fn() },
    kilimallOrderItem: { deleteMany: vi.fn() },
    kilimallOrder: { deleteMany: vi.fn() },
    employee: { deleteMany: vi.fn() },
    client: { deleteMany: vi.fn() },
    productImage: { deleteMany: vi.fn() },
    product: { deleteMany: vi.fn() },
    companySetting: { deleteMany: vi.fn() },
  },
}))

import { POST, clearStructuredErpTables } from '@/app/api/admin/reset/route'
import prisma from '@/lib/prisma'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({
    user: { id: 'd1', username: 'dir', role: 'director' },
  })
  mockListCerts.mockResolvedValue([])
  mockSql.mockResolvedValue(undefined)
})

describe('admin reset table clearing (ARCH-001)', () => {
  it('deletes from Prisma-mapped table names (not legacy aliases)', async () => {
    const cleared = await clearStructuredErpTables()
    expect(cleared).toContain('invoice_items')
    expect(cleared).toContain('sale_order_items')
    expect(cleared).toContain('purchase_order_items')
    expect(cleared).toContain('repairs')
    expect(cleared).toContain('serial_numbers')
    expect(cleared).toContain('clients')
    expect(cleared).not.toContain('invoice_lines')
    expect(cleared).not.toContain('sale_order_lines')
    expect(cleared).not.toContain('repair_orders')
    expect(cleared).not.toContain('contacts')
    expect(prisma.invoiceItem.deleteMany).toHaveBeenCalled()
    expect(prisma.saleOrderItem.deleteMany).toHaveBeenCalled()
    expect(prisma.repair.deleteMany).toHaveBeenCalled()
    expect(prisma.serialNumber.deleteMany).toHaveBeenCalled()
    expect(prisma.client.deleteMany).toHaveBeenCalled()
  })

  it('requires director confirmation before wiping', async () => {
    const res = await POST(new Request('http://localhost/api/admin/reset', {
      method: 'POST',
      body: JSON.stringify({ confirmation: 'wrong' }),
      headers: { 'Content-Type': 'application/json' },
    }) as any)
    expect(res.status).toBe(400)
  })

  it('clears app_state and structured tables on confirmed reset', async () => {
    const res = await POST(new Request('http://localhost/api/admin/reset', {
      method: 'POST',
      body: JSON.stringify({ confirmation: 'RESET DEED ERP PRODUCTION DATA' }),
      headers: { 'Content-Type': 'application/json' },
    }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.clearedTables).toContain('invoice_items')
    expect(mockSql).toHaveBeenCalled()
  })
})
