import { describe, it, expect } from 'vitest'
import {
  buildSerialDeviceLabelView,
  buildSerialDeviceQrUrl,
} from '@/lib/inventory/serial-device-label-data'

describe('buildSerialDeviceLabelView', () => {
  it('uses current config RAM/storage (not product-master defaults)', () => {
    const a = buildSerialDeviceLabelView({
      serialId: 'id-a',
      serial: 'SNA',
      productName: 'Dell Latitude 5420',
      productCategory: 'Laptops',
      productType: 'refurbished',
      warrantyMonths: 12,
      receivedDate: '2026-05-09T00:00:00.000Z',
      locationLabel: 'Warehouse',
      status: 'available',
      specsText: '8GB RAM, 256GB SSD',
      currentConfig: {
        totalRamGb: 8,
        primaryStorageGb: 256,
        storageType: 'SSD',
        processor: 'Intel Core i5',
        processorGeneration: '11th Gen',
        displayName: 'Dell Latitude 5420 - 11th Gen Intel Core i5, 8GB RAM, 256GB SSD',
      },
      qrUrl: '/inventory/serial/id-a',
    })
    expect(a.ram).toBe('8GB')
    expect(a.storage).toBe('256GB SSD')
    expect(a.condition).toBe('REFURBISHED')
    expect(a.statusBadge).toBe('IN STOCK')

    const b = buildSerialDeviceLabelView({
      serialId: 'id-b',
      serial: 'SNB',
      productName: 'Dell Latitude 5420',
      productCategory: 'Laptops',
      productType: 'refurbished',
      currentConfig: {
        totalRamGb: 16,
        primaryStorageGb: 512,
        storageType: 'NVMe SSD',
        processor: 'Intel Core i5',
        processorGeneration: '11th Gen',
        displayName: 'Dell Latitude 5420 - 16GB RAM, 512GB SSD',
      },
      qrUrl: '/inventory/serial/id-b',
    })
    expect(b.ram).toBe('16GB')
    expect(b.storage).toBe('512GB NVMe')
  })

  it('falls back to free-text specs when structured config missing', () => {
    const view = buildSerialDeviceLabelView({
      serialId: 'id-1',
      serial: 'SN123456789',
      productName: 'Dell Latitude 5420',
      productCategory: 'Laptops',
      productType: 'new',
      specsText: 'Intel Core i5 11th Gen, 16GB RAM, 512GB NVMe SSD',
      qrUrl: '/inventory/serial/id-1',
    })
    expect(view.cpu).toContain('I5')
    expect(view.ram).toBe('16GB')
    expect(view.storage).toBe('512GB NVMe')
    expect(view.condition).toBe('NEW')
    expect(view.barcodeValue).toBe('SN123456789')
  })

  it('formats warranty and date in', () => {
    const view = buildSerialDeviceLabelView({
      serialId: 'x',
      serial: 'SN1',
      productName: 'ThinkPad',
      warrantyMonths: 12,
      receivedDate: '2026-05-09',
      qrUrl: '/inventory/serial/x',
    })
    expect(view.warranty).toBe('12 MONTHS')
    expect(view.dateIn).toMatch(/09/)
    expect(view.dateIn).toMatch(/2026/)
  })
})

describe('buildSerialDeviceQrUrl', () => {
  it('builds absolute inventory serial path', () => {
    expect(buildSerialDeviceQrUrl({ origin: 'https://erp.deed.co.ke', serialId: 'abc-1' }))
      .toBe('https://erp.deed.co.ke/inventory/serial/abc-1')
  })
})
