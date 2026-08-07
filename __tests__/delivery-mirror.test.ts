import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockLoadAppState = vi.fn()
const mockSaveStoreKeys = vi.fn()
const mockClientFindUnique = vi.fn()
const mockUserFindFirst = vi.fn()
const mockProductFindMany = vi.fn()
const mockDnUpsert = vi.fn()
const mockDnItemDeleteMany = vi.fn()
const mockDnItemCreateMany = vi.fn()
const mockTransaction = vi.fn()

vi.mock('@/lib/server-store', () => ({
  loadAppState: (...args: unknown[]) => mockLoadAppState(...args),
  saveStoreKeys: (...args: unknown[]) => mockSaveStoreKeys(...args),
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    client: { findUnique: (...args: unknown[]) => mockClientFindUnique(...args) },
    user: { findFirst: (...args: unknown[]) => mockUserFindFirst(...args) },
    product: { findMany: (...args: unknown[]) => mockProductFindMany(...args) },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn),
  },
}))

import { mirrorDeliveryToPrisma } from '@/lib/delivery-mirror'

const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PRODUCT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SERIAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const baseDelivery = {
  id: 'delivery-1',
  ref: 'DN/2026/0010',
  saleOrderId: SO_ID,
  customerId: CLIENT_ID,
  status: 'done',
  preparedByUserId: USER_ID,
  lines: [{ productId: PRODUCT_ID, productName: 'Laptop', qty: 2, qtyDone: 2, serialIds: [SERIAL_ID] }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadAppState.mockResolvedValue({})
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockClientFindUnique.mockResolvedValue({ id: CLIENT_ID })
  mockUserFindFirst.mockResolvedValue({ id: USER_ID })
  mockProductFindMany.mockResolvedValue([{ id: PRODUCT_ID }])
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      deliveryNote: { upsert: mockDnUpsert },
      deliveryNoteItem: { deleteMany: mockDnItemDeleteMany, createMany: mockDnItemCreateMany },
    }),
  )
  mockDnUpsert.mockResolvedValue({})
  mockDnItemDeleteMany.mockResolvedValue({})
  mockDnItemCreateMany.mockResolvedValue({})
})

describe('mirrorDeliveryToPrisma', () => {
  it('upserts a DeliveryNote by blobId and replaces its items', async () => {
    const result = await mirrorDeliveryToPrisma(baseDelivery)
    expect(result.mirrored).toBe(true)
    expect(mockDnUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { blobId: 'delivery-1' },
      create: expect.objectContaining({
        blobId: 'delivery-1',
        dnNumber: 'DN/2026/0010',
        saleOrderId: SO_ID,
        clientId: CLIENT_ID,
        status: 'done',
        createdById: USER_ID,
      }),
    }))
    expect(mockDnItemDeleteMany).toHaveBeenCalled()
    expect(mockDnItemCreateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ productId: PRODUCT_ID, qty: 2, qtyDone: 2, serialNumberId: SERIAL_ID })],
    }))
  })

  it('skips (does not write) when the client is not yet mirrored into Prisma', async () => {
    mockClientFindUnique.mockResolvedValue(null)
    const result = await mirrorDeliveryToPrisma(baseDelivery)
    expect(result.mirrored).toBe(false)
    expect(result.reason).toBe('client not in Prisma')
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('falls back to any director/admin user when preparedByUserId is absent', async () => {
    const { preparedByUserId, ...withoutPreparer } = baseDelivery
    await mirrorDeliveryToPrisma(withoutPreparer)
    expect(mockUserFindFirst).toHaveBeenCalled()
    expect(mockDnUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ createdById: USER_ID }),
    }))
  })

  it('skips when no valid creator can be resolved at all', async () => {
    const { preparedByUserId, ...withoutPreparer } = baseDelivery
    mockUserFindFirst.mockResolvedValue(null)
    const result = await mirrorDeliveryToPrisma(withoutPreparer)
    expect(result.mirrored).toBe(false)
    expect(result.reason).toBe('no resolvable createdById')
  })

  it('is idempotent — skips a second mirror of the same unchanged delivery', async () => {
    const state: Record<string, unknown> = {}
    mockSaveStoreKeys.mockImplementation(async (entries: Record<string, string>) => {
      Object.assign(state, entries)
    })
    mockLoadAppState.mockImplementation(async () => {
      const raw = state.delivery_note_mirror_hashes_v1
      return raw ? { delivery_note_mirror_hashes_v1: JSON.parse(raw as string) } : {}
    })

    const first = await mirrorDeliveryToPrisma(baseDelivery)
    expect(first.mirrored).toBe(true)
    mockDnUpsert.mockClear()

    const second = await mirrorDeliveryToPrisma(baseDelivery)
    expect(second.mirrored).toBe(false)
    expect(second.reason).toBe('unchanged')
    expect(mockDnUpsert).not.toHaveBeenCalled()
  })

  it('filters out lines whose product is not mirrored into Prisma', async () => {
    mockProductFindMany.mockResolvedValue([])
    await mirrorDeliveryToPrisma(baseDelivery)
    expect(mockDnItemCreateMany).not.toHaveBeenCalled()
  })

  it('never throws — returns a soft failure when the transaction errors', async () => {
    mockTransaction.mockRejectedValue(new Error('db down'))
    const result = await mirrorDeliveryToPrisma(baseDelivery)
    expect(result.mirrored).toBe(false)
    expect(result.reason).toBe('error')
  })
})
