import { describe, expect, it, vi } from 'vitest'

// The mirror imports prisma at module scope; stub the I/O edges so the pure
// mapping function can be exercised without a database.
vi.mock('@/lib/prisma', () => ({ default: {} }))
vi.mock('@/lib/server-store', () => ({ loadAppState: vi.fn(), saveStoreKeys: vi.fn() }))
vi.mock('@/lib/legacy-compat', () => ({ resolveClientId: vi.fn() }))

import { mapRepair } from '@/lib/repair-mirror'

const blob = {
  ref: 'REP/2026/0190',
  productName: 'Lenovo ThinkPad X1 Carbon',
  deviceType: 'Laptop',
  deviceBrand: 'Lenovo',
  deviceModel: 'ThinkPad X1 Carbon',
  deviceColor: 'Silver',
  issueDescription: 'Will not power on',
}

describe('mapRepair device columns', () => {
  it('takes each device column from its own field', () => {
    const mapped = mapRepair(blob)
    expect(mapped.deviceType).toBe('Laptop')
    expect(mapped.deviceBrand).toBe('Lenovo')
    expect(mapped.deviceModel).toBe('ThinkPad X1 Carbon')
  })

  it('never writes the device colour into deviceModel', () => {
    // This is what put "Silver requires technician assignment" into the staff
    // notification text and broke model search.
    expect(mapRepair(blob).deviceModel).not.toBe('Silver')
    expect(mapRepair({ ...blob, deviceModel: undefined }).deviceModel).toBeNull()
  })

  it('falls back to productName for deviceType on rows booked before the split', () => {
    const legacy = { ...blob, deviceType: undefined, deviceBrand: undefined, deviceModel: undefined }
    expect(mapRepair(legacy).deviceType).toBe('Lenovo ThinkPad X1 Carbon')
    expect(mapRepair(legacy).deviceBrand).toBeNull()
  })

  it('keeps every column inside its schema bound', () => {
    const long = 'x'.repeat(400)
    const mapped = mapRepair({ ...blob, deviceType: long, deviceBrand: long, deviceModel: long })
    expect(mapped.deviceType.length).toBeLessThanOrEqual(80)
    expect(mapped.deviceBrand!.length).toBeLessThanOrEqual(80)
    expect(mapped.deviceModel!.length).toBeLessThanOrEqual(100)
  })
})
