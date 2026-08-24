import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindWo = vi.fn()
const mockUpdateSnapshot = vi.fn()
const mockFindSoItems = vi.fn()
const mockUpdateSoItem = vi.fn()
const mockFindInvoiceItems = vi.fn()
const mockUpdateInvoiceItem = vi.fn()
const mockFindDnItems = vi.fn()
const mockUpdateDnItem = vi.fn()
const mockUpdateWo = vi.fn()
const mockLoadAppState = vi.fn()
const mockSaveStoreKeys = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    reconfigurationWorkOrder: {
      findUnique: (...args: unknown[]) => mockFindWo(...args),
      update: (...args: unknown[]) => mockUpdateWo(...args),
    },
    deviceConfigurationSnapshot: {
      update: (...args: unknown[]) => mockUpdateSnapshot(...args),
    },
    saleOrderItem: {
      findMany: (...args: unknown[]) => mockFindSoItems(...args),
      update: (...args: unknown[]) => mockUpdateSoItem(...args),
    },
    invoiceItem: {
      findMany: (...args: unknown[]) => mockFindInvoiceItems(...args),
      update: (...args: unknown[]) => mockUpdateInvoiceItem(...args),
    },
    deliveryNoteItem: {
      findMany: (...args: unknown[]) => mockFindDnItems(...args),
      update: (...args: unknown[]) => mockUpdateDnItem(...args),
    },
  },
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: (...args: unknown[]) => mockLoadAppState(...args),
  saveStoreKeys: (...args: unknown[]) => mockSaveStoreKeys(...args),
}))

vi.mock('@/lib/reconfiguration/service', () => ({
  applyTargetToWorkOrder: vi.fn(),
  createReconfiguration: vi.fn(),
  getDeviceConfiguration: vi.fn(),
  getWorkOrder: vi.fn(),
}))

import { refreshSaleOrderHostLineAfterReconfig } from '@/lib/reconfiguration/sales-bridge'

const SERIAL_ID = '9bdd98fa-40d7-4cb9-ba10-7dae3b134f49'
const PRODUCT_ID = '047f833f-bd0e-45b3-9f57-ad5b376bef05'
const SO_ID = '08712a32-f352-4885-9343-ea8ffa6f0b25'
const CATALOG = 'HP EliteBook 830 G7 - 10th Gen Intel Core i5, 16GB RAM, 256GB SSD'
const LIVE = 'HP EliteBook 830 G7 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD'

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateSnapshot.mockResolvedValue({})
  mockUpdateSoItem.mockResolvedValue({})
  mockUpdateInvoiceItem.mockResolvedValue({})
  mockUpdateDnItem.mockResolvedValue({})
  mockUpdateWo.mockResolvedValue({})
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockFindDnItems.mockResolvedValue([])
  mockLoadAppState.mockResolvedValue({
    deed_serials: [],
    deed_saleOrders: [
      {
        id: SO_ID,
        ref: 'SO/2026/0083',
        lines: [{ id: 'so-line', productId: PRODUCT_ID, productName: CATALOG, description: CATALOG, serialIds: [SERIAL_ID] }],
      },
    ],
    deed_invoices: [
      {
        id: 'inv-1',
        ref: 'INV/2026/0140',
        saleOrderId: SO_ID,
        lines: [{ id: 'inv-line', productId: PRODUCT_ID, description: `${CATALOG} ×1` }],
      },
    ],
    deed_deliveries: [
      {
        ref: 'DN/2026/0086',
        lines: [{ productName: CATALOG, serialIds: [SERIAL_ID] }],
      },
    ],
  })
})

describe('refreshSaleOrderHostLineAfterReconfig', () => {
  it('rewrites SO, invoice and delivery lines by serial even when the work order is not linked', async () => {
    mockFindWo.mockResolvedValue({
      id: 'wo-2',
      serialId: SERIAL_ID,
      productId: PRODUCT_ID,
      manufacturerSerial: '5CG11243NT',
      linkedSaleOrderId: null,
      linkedInvoiceId: null,
      product: { id: PRODUCT_ID, name: CATALOG },
      serial: { id: SERIAL_ID, serialNumber: '5CG11243NT', productId: PRODUCT_ID },
      proposedSnapshot: {
        id: 'snap-after',
        displayName: `${CATALOG} - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD`,
        processor: 'Intel Core i5',
        processorGeneration: '10th Gen',
        totalRamGb: 8,
        primaryStorageGb: 256,
        storageType: 'SSD',
        ramComposition: [],
      },
    })
    mockFindSoItems.mockResolvedValue([
      { id: 'so-line', saleOrderId: SO_ID, description: CATALOG },
    ])
    mockFindInvoiceItems.mockResolvedValue([
      { id: 'inv-line', description: `${CATALOG} ×1`, serialNumberId: null },
    ])
    mockFindDnItems.mockResolvedValue([
      { id: 'dn-line', serialNumberId: null },
    ])

    const result = await refreshSaleOrderHostLineAfterReconfig('wo-2')
    expect(result?.description).toBe(LIVE)
    expect(mockUpdateSoItem).toHaveBeenCalledWith({
      where: { id: 'so-line' },
      data: { description: LIVE },
    })
    expect(mockUpdateInvoiceItem).toHaveBeenCalledWith({
      where: { id: 'inv-line' },
      data: { description: `${LIVE} ×1`, serialNumberId: SERIAL_ID },
    })
    expect(mockUpdateWo).toHaveBeenCalledWith({
      where: { id: 'wo-2' },
      data: { linkedSaleOrderId: SO_ID },
    })

    const saved = mockSaveStoreKeys.mock.calls[0][0]
    const invoices = JSON.parse(saved.deed_invoices)
    expect(invoices[0].lines[0].description).toBe(`${LIVE} ×1`)
    const sos = JSON.parse(saved.deed_saleOrders)
    expect(sos[0].lines[0].productName).toBe(LIVE)
    const dns = JSON.parse(saved.deed_deliveries)
    expect(dns[0].lines[0].productName).toBe(LIVE)
  })
})
