import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFindUnique,
  mockFindFirst,
  mockProductFindMany,
  mockGetDeviceConfiguration,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindFirst: vi.fn(),
  mockProductFindMany: vi.fn(),
  mockGetDeviceConfiguration: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    saleOrder: { findUnique: mockFindUnique },
    product: { findMany: mockProductFindMany },
    reconfigurationWorkOrder: { findFirst: mockFindFirst, update: vi.fn(), findUnique: vi.fn() },
    saleOrderItem: { update: vi.fn() },
  },
}))

vi.mock('@/lib/reconfiguration/service', () => ({
  getDeviceConfiguration: mockGetDeviceConfiguration,
  createReconfiguration: vi.fn(),
  applyTargetToWorkOrder: vi.fn(),
  getWorkOrder: vi.fn(),
}))

import { assertSaleOrderReconfigAllowsDelivery } from '@/lib/reconfiguration/sales-bridge'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assertSaleOrderReconfigAllowsDelivery', () => {
  it('allows delivery when there is no sale order id', async () => {
    await expect(assertSaleOrderReconfigAllowsDelivery(null)).resolves.toEqual({ ok: true })
  })

  it('blocks delivery when RAM/SSD lines exist but host serial is missing', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'so-1',
      items: [
        { id: 'l1', productId: 'ram-1', serialNumberId: null, description: '16GB RAM' },
      ],
    })
    mockProductFindMany.mockResolvedValue([
      { id: 'ram-1', name: '16GB DDR4 RAM Upgrade', specs: {}, trackingMethod: 'QUANTITY' },
    ])
    mockFindFirst.mockResolvedValue(null)

    const gate = await assertSaleOrderReconfigAllowsDelivery('so-1')
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.error).toMatch(/no device serial/i)
  })

  it('blocks delivery when linked RCF is still in progress', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'so-1',
      items: [
        { id: 'host', productId: 'laptop-1', serialNumberId: 'ser-1', description: 'Laptop' },
        { id: 'ram', productId: 'ram-1', serialNumberId: null, description: '16GB RAM' },
      ],
    })
    mockProductFindMany.mockResolvedValue([
      { id: 'laptop-1', name: 'ThinkPad', specs: {}, trackingMethod: 'SERIAL' },
      { id: 'ram-1', name: '16GB DDR4 RAM Upgrade', specs: {}, trackingMethod: 'QUANTITY' },
    ])
    mockGetDeviceConfiguration.mockResolvedValue({
      serialId: 'ser-1',
      current: { totalRamGb: 8, primaryStorageGb: 256, storageType: 'SSD' },
    })
    // First call = linked WO, second = open-on-serial
    mockFindFirst
      .mockResolvedValueOnce({
        id: 'wo-1',
        ref: 'RCF/2026/0001',
        status: 'in_progress',
        linkedSaleOrderId: 'so-1',
      })
      .mockResolvedValueOnce({
        id: 'wo-1',
        ref: 'RCF/2026/0001',
        status: 'in_progress',
        linkedSaleOrderId: 'so-1',
      })

    const gate = await assertSaleOrderReconfigAllowsDelivery('so-1')
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.error).toMatch(/RCF\/2026\/0001/)
  })

  it('allows delivery when linked RCF is completed', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'so-1',
      items: [
        { id: 'host', productId: 'laptop-1', serialNumberId: 'ser-1', description: 'Laptop' },
        { id: 'ram', productId: 'ram-1', serialNumberId: null, description: '16GB RAM' },
      ],
    })
    mockProductFindMany.mockResolvedValue([
      { id: 'laptop-1', name: 'ThinkPad', specs: {}, trackingMethod: 'SERIAL' },
      { id: 'ram-1', name: '16GB DDR4 RAM Upgrade', specs: {}, trackingMethod: 'QUANTITY' },
    ])
    mockGetDeviceConfiguration.mockResolvedValue({
      serialId: 'ser-1',
      // Specs may briefly lag; completed WO must still unlock delivery.
      current: { totalRamGb: 8, primaryStorageGb: 256, storageType: 'SSD' },
    })
    mockFindFirst
      .mockResolvedValueOnce({
        id: 'wo-1',
        ref: 'RCF/2026/0001',
        status: 'completed',
        linkedSaleOrderId: 'so-1',
      })
      .mockResolvedValueOnce(null)

    const gate = await assertSaleOrderReconfigAllowsDelivery('so-1')
    expect(gate).toEqual({ ok: true })
  })
})
