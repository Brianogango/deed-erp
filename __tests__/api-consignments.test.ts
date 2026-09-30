import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockPrisma, mockRequireRole, mockMirror } = vi.hoisted(() => ({
  mockPrisma: {
    consignmentDevice: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    client: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    product: { findMany: vi.fn(), findUnique: vi.fn() },
    purchaseOrder: { findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  mockRequireRole: vi.fn(),
  mockMirror: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/auth/api', () => ({
  requireRole: mockRequireRole,
  withApiErrorHandling: async (handler: () => Promise<Response>) => {
    try { return await handler() } catch (err: any) {
      return new Response(JSON.stringify({ error: err?.message }), { status: err?.status ?? 500 })
    }
  },
}))
vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: vi.fn().mockResolvedValue('PO/2026/0301') }))
vi.mock('@/lib/purchase/po-prisma-sync', () => ({ resolvePOLineProducts: async (items: unknown) => items }))
vi.mock('@/lib/purchase/po-api-shared', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/purchase/po-api-shared')>()),
  mirrorPurchaseOrder: mockMirror,
}))

import { GET, POST } from '@/app/api/inventory/consignments/route'
import { POST as ACT } from '@/app/api/inventory/consignments/[id]/route'

const VENDOR = '11111111-1111-4111-8111-111111111111'
const PRODUCT = '22222222-2222-4222-8222-222222222222'
const DEVICE = '33333333-3333-4333-8333-333333333333'
const actor = { id: '44444444-4444-4444-8444-444444444444', role: 'inventory_officer' }

const row = (over: Record<string, unknown> = {}) => ({
  id: DEVICE, vendorId: VENDOR, vendorName: 'Laptop Hub', assetId: 'LH-0091', serialNumber: '5CG7281XYZ',
  productId: null, productName: 'HP EliteBook 840 G5', conditionGrade: 'A', receivedAt: new Date('2026-09-20T00:00:00Z'),
  status: 'at_shop', purchasedAt: null, purchaseOrderId: null, purchasePrice: null, returnedAt: null, notes: null,
  ...over,
})
const req = (body: unknown) => new NextRequest('http://localhost/api/inventory/consignments', { method: 'POST', body: JSON.stringify(body) })
const ctx = { params: Promise.resolve({ id: DEVICE }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue(actor)
  mockPrisma.consignmentDevice.findMany.mockResolvedValue([])
  mockPrisma.client.findUnique.mockResolvedValue({ id: VENDOR, name: 'Laptop Hub', isVendor: false })
  mockPrisma.product.findUnique.mockResolvedValue({ id: PRODUCT, name: 'HP EliteBook 840 G5' })
  mockPrisma.consignmentDevice.create.mockImplementation(async ({ data }: any) => ({ ...row(), ...data }))
  mockPrisma.consignmentDevice.findUnique.mockResolvedValue(row())
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma))
  mockPrisma.purchaseOrder.create.mockResolvedValue({ id: 'po-1', poNumber: 'PO/2026/0301', items: [] })
  mockPrisma.consignmentDevice.update.mockImplementation(async ({ data }: any) => ({ ...row(), ...data }))
  mockMirror.mockResolvedValue({})
})

describe('booking a vendor device in', () => {
  const valid = { vendorId: VENDOR, serialNumber: '5cg7281xyz', assetId: 'LH-0091', receivedAt: '2026-09-20' }

  it('records it at the shop and marks the contact as a vendor', async () => {
    const res = await POST(req(valid))
    expect(res.status).toBe(201)
    const created = mockPrisma.consignmentDevice.create.mock.calls[0][0].data
    expect(created).toMatchObject({ vendorId: VENDOR, serialNumber: '5CG7281XYZ', status: 'at_shop', createdById: actor.id })
    expect(mockPrisma.client.update).toHaveBeenCalledWith({ where: { id: VENDOR }, data: { isVendor: true } })
  })

  it('saves what came with the machine', async () => {
    await POST(req({ ...valid, accessories: ['charger', 'Bag'] }))
    expect(mockPrisma.consignmentDevice.create.mock.calls[0][0].data.accessories).toEqual(['Charger', 'Bag'])
  })

  it('refuses a device with no serial', async () => {
    const res = await POST(req({ ...valid, serialNumber: '' }))
    expect(res.status).toBe(422)
    expect(mockPrisma.consignmentDevice.create).not.toHaveBeenCalled()
  })

  it('refuses the same machine booked in twice', async () => {
    mockPrisma.consignmentDevice.findMany.mockResolvedValue([row()])
    const res = await POST(req(valid))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('already booked in')
  })

  it('refuses a vendor that does not exist', async () => {
    mockPrisma.client.findUnique.mockResolvedValue(null)
    expect((await POST(req(valid))).status).toBe(404)
  })

  it('lets only stock and desk roles book devices in', async () => {
    mockRequireRole.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))
    expect((await POST(req(valid))).status).toBe(403)
  })
})

describe('buying a consigned device', () => {
  const purchase = { action: 'purchase', productId: PRODUCT, price: 42000, date: '2026-09-29' }

  it('raises a draft purchase order to the vendor and marks the device purchased', async () => {
    const res = await ACT(req(purchase), ctx)
    expect(res.status).toBe(200)
    const po = mockPrisma.purchaseOrder.create.mock.calls[0][0].data
    // Draft: the device becomes stock only when the order is received on a GRN.
    expect(po).toMatchObject({ clientId: VENDOR, status: 'draft', totalAmount: 42000 })
    expect(po.notes).toContain('5CG7281XYZ')
    expect(po.notes).toContain('no accessories')
    expect(po.items.create).toHaveLength(1)
    const update = mockPrisma.consignmentDevice.update.mock.calls[0][0].data
    expect(update).toMatchObject({ status: 'purchased', purchasePrice: 42000, purchaseOrderId: 'po-1' })
    expect((await res.json()).purchaseOrder.ref).toBe('PO/2026/0301')
  })

  it('needs a catalogue product to put on the order', async () => {
    const res = await ACT(req({ ...purchase, productId: '' }), ctx)
    expect(res.status).toBe(422)
    expect(mockPrisma.purchaseOrder.create).not.toHaveBeenCalled()
  })

  it('needs the agreed price', async () => {
    expect((await ACT(req({ ...purchase, price: 0 }), ctx)).status).toBe(422)
  })

  it('will not buy a device the vendor has already collected', async () => {
    mockPrisma.consignmentDevice.findUnique.mockResolvedValue(row({ status: 'returned', returnedAt: new Date('2026-09-25') }))
    expect((await ACT(req(purchase), ctx)).status).toBe(422)
    expect(mockPrisma.purchaseOrder.create).not.toHaveBeenCalled()
  })
})

describe('the vendor collecting a device', () => {
  it('checks it out with the date', async () => {
    const res = await ACT(req({ action: 'return', date: '2026-09-29', notes: 'Collected by Ann' }), ctx)
    expect(res.status).toBe(200)
    expect(mockPrisma.consignmentDevice.update.mock.calls[0][0].data).toMatchObject({ status: 'returned' })
  })

  it('records a charger that did not go back with the device', async () => {
    mockPrisma.consignmentDevice.findUnique.mockResolvedValue(row({ accessories: ['Charger', 'Bag'] }))
    await ACT(req({ action: 'return', date: '2026-09-29', accessoriesReturned: ['Bag'] }), ctx)
    expect(mockPrisma.consignmentDevice.update.mock.calls[0][0].data.notes).toContain('Not returned with the device: Charger')
  })

  it('refuses to hand back a device Deed has bought', async () => {
    mockPrisma.consignmentDevice.findUnique.mockResolvedValue(row({ status: 'purchased' }))
    const res = await ACT(req({ action: 'return', date: '2026-09-29' }), ctx)
    expect(res.status).toBe(422)
  })
})

describe('reading the register', () => {
  it('returns devices with their purchase order number, vendors first', async () => {
    mockPrisma.consignmentDevice.findMany.mockResolvedValue([row({ status: 'purchased', purchaseOrderId: 'po-1' })])
    mockPrisma.client.findMany.mockResolvedValue([
      { id: 'c1', name: 'Acme Customer', isVendor: false },
      { id: VENDOR, name: 'Laptop Hub', isVendor: true },
    ])
    mockPrisma.product.findMany.mockResolvedValue([])
    mockPrisma.purchaseOrder.findMany.mockResolvedValue([{ id: 'po-1', poNumber: 'PO/2026/0301' }])
    const body = await (await GET()).json()
    expect(body.devices[0]).toMatchObject({ receivedAt: '2026-09-20', purchaseOrderRef: 'PO/2026/0301' })
    expect(body.vendors[0].id).toBe(VENDOR)
  })
})
