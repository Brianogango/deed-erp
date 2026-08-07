import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockLoadAppState = vi.fn()
const mockSaveStoreKeys = vi.fn()
const mockClientFindUnique = vi.fn()
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
    product: { findMany: (...args: unknown[]) => mockProductFindMany(...args) },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn),
  },
}))

import { mirrorDeliveryToPrisma } from '@/lib/delivery-mirror'

const DELIVERY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PRODUCT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const SERIAL_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

const baseDelivery = {
  id: DELIVERY_ID,
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
  it('upserts a DeliveryNote by blobId, using the blob id as the Prisma row id, and replaces its items', async () => {
    const result = await mirrorDeliveryToPrisma(baseDelivery)
    expect(result.mirrored).toBe(true)
    expect(mockDnUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { blobId: DELIVERY_ID },
      create: expect.objectContaining({
        id: DELIVERY_ID,
        blobId: DELIVERY_ID,
        dnNumber: 'DN/2026/0010',
        saleOrderId: SO_ID,
        clientId: CLIENT_ID,
        status: 'done',
        createdById: USER_ID,
        preparedById: USER_ID,
      }),
    }))
    expect(mockDnItemDeleteMany).toHaveBeenCalledWith({ where: { dnId: DELIVERY_ID } })
    expect(mockDnItemCreateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        dnId: DELIVERY_ID,
        productId: PRODUCT_ID,
        productName: 'Laptop',
        qty: 2,
        qtyDone: 2,
        serialIds: [SERIAL_ID],
        serialNumberId: SERIAL_ID,
        lineOrder: 0,
      })],
    }))
  })

  it('skips (does not write) when the client is not yet mirrored into Prisma', async () => {
    mockClientFindUnique.mockResolvedValue(null)
    const result = await mirrorDeliveryToPrisma(baseDelivery)
    expect(result.mirrored).toBe(false)
    expect(result.reason).toBe('client not in Prisma')
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  // Regression: the blob never reliably tracked who created a delivery.
  // A prior (uncommitted) backfill already on production left createdById
  // null rather than guessing a fallback user when prepared-by was absent —
  // this mirror matches that convention instead of inventing one.
  it('writes a null createdById/preparedById when preparedByUserId is absent, rather than guessing', async () => {
    const { preparedByUserId, ...withoutPreparer } = baseDelivery
    const result = await mirrorDeliveryToPrisma(withoutPreparer)
    expect(result.mirrored).toBe(true)
    expect(mockDnUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ createdById: null, preparedById: null }),
    }))
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

  it('writes a null productId (not a guess) for a line whose product is not mirrored into Prisma', async () => {
    mockProductFindMany.mockResolvedValue([])
    await mirrorDeliveryToPrisma(baseDelivery)
    expect(mockDnItemCreateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ productId: null })],
    }))
  })

  it('never throws — returns a soft failure when the transaction errors', async () => {
    mockTransaction.mockRejectedValue(new Error('db down'))
    const result = await mirrorDeliveryToPrisma(baseDelivery)
    expect(result.mirrored).toBe(false)
    expect(result.reason).toBe('error')
  })

  it('skips a delivery whose own id is not a UUID', async () => {
    const result = await mirrorDeliveryToPrisma({ ...baseDelivery, id: 'not-a-uuid' })
    expect(result.mirrored).toBe(false)
    expect(result.reason).toBe('no usable id')
    expect(mockClientFindUnique).not.toHaveBeenCalled()
  })
})
