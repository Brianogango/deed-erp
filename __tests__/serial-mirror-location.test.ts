import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    product: { findMany: vi.fn() },
    serialNumber: { findMany: vi.fn(), update: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/auth/db', () => ({ sql: vi.fn() }))

import { mirrorKnownDomain } from '@/lib/blob-transfer'

const P = '11111111-2222-4333-8444-555555555555'
const S = '0b1c6f8e-1d2a-4c3b-9e8f-112233445566'
const copyRow = { id: S, serial: 'SN1', productId: P, productName: 'Laptop', status: 'available', location: 'warehouse', cost: 30000, receivedDate: '2026-10-01' }
const tableRow = { id: S, serialNumber: 'SN1', productId: P, inventoryBarcode: null, status: 'in_stock', location: 'warehouse', notes: null, removedAt: null, screenExtras: { receivedDate: '2026-10-01', cost: 30000, id: S, status: 'available', productName: 'Laptop' } }

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.product.findMany.mockResolvedValue([{ id: P }])
})

describe('serial copy → serial_numbers', () => {
  it('skips a serial whose row already matches (key order aside)', async () => {
    mockPrisma.serialNumber.findMany.mockResolvedValue([tableRow])
    await mirrorKnownDomain('deed_serials', JSON.stringify([copyRow]), null)
    expect(mockPrisma.serialNumber.update).not.toHaveBeenCalled()
    expect(mockPrisma.serialNumber.create).not.toHaveBeenCalled()
  })

  it('writes the new location and keeps the screen details', async () => {
    mockPrisma.serialNumber.findMany.mockResolvedValue([tableRow])
    await mirrorKnownDomain('deed_serials', JSON.stringify([{ ...copyRow, location: 'shop' }]), null)
    expect(mockPrisma.serialNumber.update).toHaveBeenCalledWith({
      where: { id: S },
      data: expect.objectContaining({ location: 'shop', status: 'in_stock', screenExtras: { id: S, productName: 'Laptop', status: 'available', cost: 30000, receivedDate: '2026-10-01' } }),
    })
  })

  it('adds a serial the table does not have', async () => {
    mockPrisma.serialNumber.findMany.mockResolvedValue([])
    await mirrorKnownDomain('deed_serials', JSON.stringify([copyRow]), null)
    expect(mockPrisma.serialNumber.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: S, serialNumber: 'SN1', location: 'warehouse' }) })
  })

  it('marks a serial gone from the list as removed, unless the list looks partial', async () => {
    const other = { ...tableRow, id: 'b', serialNumber: 'SN2' }
    mockPrisma.serialNumber.findMany.mockResolvedValue([tableRow, other])
    await mirrorKnownDomain('deed_serials', JSON.stringify([copyRow]), null)
    expect(mockPrisma.serialNumber.updateMany).not.toHaveBeenCalled() // 1 of 2 listed: partial

    const many = Array.from({ length: 10 }, (_, i) => ({ ...tableRow, id: `id${i}`, serialNumber: `S${i}` }))
    mockPrisma.serialNumber.findMany.mockResolvedValue(many)
    const listed = many.slice(0, 9).map(r => ({ ...copyRow, id: r.id, serial: r.serialNumber }))
    await mirrorKnownDomain('deed_serials', JSON.stringify(listed), null)
    expect(mockPrisma.serialNumber.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['id9'] } }, data: { removedAt: expect.any(Date) } })
  })
})
