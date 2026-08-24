import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockLoadAppState, mockSaveStoreKeys } = vi.hoisted(() => ({
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
}))

import { syncBlobSpecs } from '@/lib/reconfiguration/service'

beforeEach(() => {
  vi.clearAllMocks()
  mockSaveStoreKeys.mockResolvedValue(undefined)
})

describe('syncBlobSpecs', () => {
  // Regression: completeWorkOrder's status/location update a few lines below
  // its syncBlobSpecs call falls back to matching on manufacturerSerial when
  // the blob row's id doesn't match the Prisma serial's UUID — but
  // syncBlobSpecs itself didn't, so it silently no-opped and left
  // deed_serials.specs stuck on the pre-reconfiguration value while status
  // correctly flipped back to "available". This pinned the fix.
  it('updates the blob row by id when the id matches the Prisma serialId', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_serials: [{ id: 'serial-uuid-1', serial: 'SN-LEGACY-1', specs: '16GB RAM, 512GB SSD' }],
    })
    await syncBlobSpecs('serial-uuid-1', '8GB RAM, 256GB SSD')
    expect(mockSaveStoreKeys).toHaveBeenCalledWith({
      deed_serials: JSON.stringify([{ id: 'serial-uuid-1', serial: 'SN-LEGACY-1', specs: '8GB RAM, 256GB SSD' }]),
    })
  })

  it('falls back to matching by manufacturerSerial when the blob id diverges from the Prisma serialId', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_serials: [{ id: 'blob-legacy-id', serial: 'SN-LEGACY-1', specs: '16GB RAM, 512GB SSD' }],
    })
    await syncBlobSpecs('serial-uuid-1', '8GB RAM, 256GB SSD', 'SN-LEGACY-1')
    expect(mockSaveStoreKeys).toHaveBeenCalledWith({
      deed_serials: JSON.stringify([{ id: 'blob-legacy-id', serial: 'SN-LEGACY-1', specs: '8GB RAM, 256GB SSD' }]),
    })
  })

  it('is a no-op (does not write) when manufacturerSerial is missing and the id does not match', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_serials: [{ id: 'blob-legacy-id', serial: 'SN-OTHER', specs: '16GB RAM, 512GB SSD' }],
    })
    await syncBlobSpecs('serial-uuid-1', '8GB RAM, 256GB SSD')
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('inserts a blob row when the Prisma serial is missing from deed_serials', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_serials: [{ id: 'blob-legacy-id', serial: 'SN-OTHER', specs: '16GB RAM, 512GB SSD' }],
    })
    await syncBlobSpecs('serial-uuid-1', '8GB RAM, 256GB SSD', 'SN-LEGACY-1')
    expect(mockSaveStoreKeys).toHaveBeenCalledTimes(1)
    const written = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_serials)
    expect(written).toHaveLength(2)
    expect(written[1]).toMatchObject({
      id: 'serial-uuid-1',
      serial: 'SN-LEGACY-1',
      specs: '8GB RAM, 256GB SSD',
    })
  })
})
