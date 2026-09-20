import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => {
  const records = new Map<string, { key: string; value: unknown; updatedAt: Date; createdAt: Date }>()
  return {
    mockPrisma: {
      __records: records,
      storeRecord: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        upsert: vi.fn(),
        count: vi.fn(),
        deleteMany: vi.fn(),
        aggregate: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  }
})

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import {
  countStoreRecords,
  deleteStoreRecords,
  latestStoreRecordUpdatedAt,
  loadStoreRecordChangesSince,
  readStoreRecords,
  storeBackend,
  storeRecordVersion,
  writeStoreRecords,
} from '@/lib/prisma-store'

const originalBackend = process.env.STORE_BACKEND

beforeEach(() => {
  mockPrisma.__records.clear()
  vi.clearAllMocks()
  delete process.env.STORE_BACKEND

  mockPrisma.storeRecord.findMany.mockImplementation(async (args?: { where?: { key?: { in?: string[] }; updatedAt?: { gt?: Date } }; orderBy?: { updatedAt?: string } }) => {
    let rows = [...mockPrisma.__records.values()]
    if (args?.where?.key?.in) {
      const wanted = new Set(args.where.key.in)
      rows = rows.filter(r => wanted.has(r.key))
    }
    if (args?.where?.updatedAt?.gt) {
      const gt = args.where.updatedAt.gt
      rows = rows.filter(r => r.updatedAt > gt)
    }
    if (args?.orderBy?.updatedAt === 'asc') {
      rows.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    }
    return rows
  })
  mockPrisma.storeRecord.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
    return mockPrisma.__records.get(where.key) ?? null
  })
  mockPrisma.storeRecord.upsert.mockImplementation(async ({ where, create, update }: {
    where: { key: string }
    create: { key: string; value: unknown }
    update: { value: unknown }
  }) => {
    const existing = mockPrisma.__records.get(where.key)
    const now = new Date()
    const row = existing
      ? { ...existing, value: update.value, updatedAt: now }
      : { key: create.key, value: create.value, updatedAt: now, createdAt: now }
    mockPrisma.__records.set(row.key, row)
    return row
  })
  mockPrisma.storeRecord.count.mockImplementation(async () => mockPrisma.__records.size)
  mockPrisma.storeRecord.deleteMany.mockImplementation(async ({ where }: { where: { key: { in: string[] } } }) => {
    let count = 0
    for (const key of where.key.in) {
      if (mockPrisma.__records.delete(key)) count += 1
    }
    return { count }
  })
  mockPrisma.storeRecord.aggregate.mockImplementation(async ({ where }: { where?: { key?: { in?: string[] } } }) => {
    let rows = [...mockPrisma.__records.values()]
    if (where?.key?.in) {
      const wanted = new Set(where.key.in)
      rows = rows.filter(r => wanted.has(r.key))
    }
    const latest = rows.reduce<Date | null>((max, row) => (!max || row.updatedAt > max ? row.updatedAt : max), null)
    return { _max: { updatedAt: latest }, _count: { _all: rows.length } }
  })
  mockPrisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops))
})

afterEach(() => {
  if (originalBackend === undefined) delete process.env.STORE_BACKEND
  else process.env.STORE_BACKEND = originalBackend
})

describe('storeBackend()', () => {
  it('defaults to prisma', () => {
    expect(storeBackend()).toBe('prisma')
  })

  it('accepts dual and app_state aliases', () => {
    process.env.STORE_BACKEND = 'dual'
    expect(storeBackend()).toBe('dual')
    process.env.STORE_BACKEND = 'blob'
    expect(storeBackend()).toBe('app_state')
    process.env.STORE_BACKEND = 'app_state'
    expect(storeBackend()).toBe('app_state')
  })
})

describe('store_records KV', () => {
  it('writes JSON collections and skips binary object-store keys', async () => {
    await writeStoreRecords({
      deed_serials: JSON.stringify([{ id: 's1' }]),
      expense_receipt_abc: 'data:image/png;base64,xx',
    })
    expect(mockPrisma.storeRecord.upsert).toHaveBeenCalledTimes(1)
    const stored = await readStoreRecords()
    expect(stored.deed_serials).toEqual([{ id: 's1' }])
    expect(stored.expense_receipt_abc).toBeUndefined()
  })

  it('reads requested keys only', async () => {
    await writeStoreRecords({
      deed_serials: '[]',
      deed_contacts: '[{"id":"1"}]',
    })
    const stored = await readStoreRecords(['deed_contacts', 'expense_receipt_x'])
    expect(Object.keys(stored)).toEqual(['deed_contacts'])
  })

  it('tracks version and changes since', async () => {
    await writeStoreRecords({ deed_serials: '[]' })
    const ver = await storeRecordVersion(['deed_serials'])
    expect(ver.n).toBe(1)
    expect(ver.latest).toMatch(/T/)
    expect(await countStoreRecords()).toBe(1)
    expect(await latestStoreRecordUpdatedAt()).toBe(ver.latest)

    const since = await loadStoreRecordChangesSince('1970-01-01T00:00:00.000Z')
    expect(since.changes.deed_serials).toEqual([])
  })

  it('deletes selected keys', async () => {
    await writeStoreRecords({ a: '1', b: '2' })
    expect(await deleteStoreRecords(['a'])).toBe(1)
    expect(await readStoreRecords()).toEqual({ b: 2 })
  })
})
