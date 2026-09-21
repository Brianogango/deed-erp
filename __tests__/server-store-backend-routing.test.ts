import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockSql, mockPrismaState, mockPrismaStore } = vi.hoisted(() => ({
  mockSql: vi.fn(),
  mockPrismaState: {
    loadPrismaState: vi.fn(),
    savePrismaStateEntries: vi.fn(),
    getPrismaStateVersion: vi.fn(),
    getLatestPrismaStateUpdatedAt: vi.fn(),
    getPrismaStateChangedKeysSince: vi.fn(),
  },
  mockPrismaStore: {
    writeStoreRecords: vi.fn(),
    readStoreRecords: vi.fn(),
  },
}))

vi.mock('@/lib/auth/db', () => ({ sql: mockSql, withDbTransaction: vi.fn() }))
vi.mock('@/lib/prisma-state-store', () => mockPrismaState)
vi.mock('@/lib/prisma-store', () => mockPrismaStore)
vi.mock('@/lib/repair-mirror', () => ({ loadRepairsFromPrisma: vi.fn().mockResolvedValue(null) }))

import { saveStoreKeys, loadAppState } from '@/lib/server-store'
import { BulkDeleteRefusedError } from '@/lib/store-bulk-delete-guard'

const sqlText = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?')
const legacyInserts = () => mockSql.mock.calls.filter(c => /INSERT INTO app_state/.test(sqlText(c)))

let storedAppState: Record<string, string> = {}
let storeRecordsPresent = false

const env = process.env as Record<string, string | undefined>
const originalNodeEnv = env.NODE_ENV
const originalBackend = env.STORE_BACKEND

beforeEach(() => {
  vi.clearAllMocks()
  storedAppState = {}
  storeRecordsPresent = false
  mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = strings.join('?')
    if (/to_regclass/.test(text)) return { rows: [{ present: storeRecordsPresent }] }
    if (/SELECT key, value FROM app_state/.test(text)) {
      return { rows: Object.entries(storedAppState).map(([key, value]) => ({ key, value })) }
    }
    return { rows: [] }
  })
  mockPrismaState.loadPrismaState.mockResolvedValue({})
  mockPrismaState.savePrismaStateEntries.mockResolvedValue(undefined)
  mockPrismaStore.writeStoreRecords.mockResolvedValue(undefined)
  mockPrismaStore.readStoreRecords.mockResolvedValue({})
  // Exercise the production persistence path, not the unit-fixture branch.
  env.NODE_ENV = 'production'
})

afterEach(() => {
  env.NODE_ENV = originalNodeEnv
  if (originalBackend === undefined) delete env.STORE_BACKEND
  else env.STORE_BACKEND = originalBackend
})

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }))

describe('saveStoreKeys honours STORE_BACKEND', () => {
  it('default (unset) writes app_state only — never the Prisma projection', async () => {
    delete env.STORE_BACKEND
    await saveStoreKeys({ deed_serials: JSON.stringify(rows(3)) })
    expect(legacyInserts()).toHaveLength(1)
    expect(mockPrismaState.savePrismaStateEntries).not.toHaveBeenCalled()
    expect(mockPrismaStore.writeStoreRecords).not.toHaveBeenCalled()
  })

  it('prisma writes the projection and not app_state', async () => {
    env.STORE_BACKEND = 'prisma'
    await saveStoreKeys({ deed_serials: JSON.stringify(rows(3)) })
    expect(mockPrismaState.savePrismaStateEntries).toHaveBeenCalledTimes(1)
    expect(legacyInserts()).toHaveLength(0)
  })

  it('dual writes both layers', async () => {
    env.STORE_BACKEND = 'dual'
    await saveStoreKeys({ deed_serials: JSON.stringify(rows(3)) })
    expect(legacyInserts()).toHaveLength(1)
    expect(mockPrismaState.savePrismaStateEntries).toHaveBeenCalledTimes(1)
  })

  it('skips store_records writes when that table does not exist', async () => {
    env.STORE_BACKEND = 'prisma'
    storeRecordsPresent = false
    await saveStoreKeys({ deed_serials: JSON.stringify(rows(3)) })
    expect(mockPrismaStore.writeStoreRecords).not.toHaveBeenCalled()
  })

  it('refuses a save that would delete hundreds of stored records', async () => {
    delete env.STORE_BACKEND
    storedAppState = { deed_serials: JSON.stringify(rows(800)) }
    await expect(saveStoreKeys({ deed_serials: JSON.stringify(rows(200)) }))
      .rejects.toBeInstanceOf(BulkDeleteRefusedError)
    expect(legacyInserts()).toHaveLength(0)
  })

  it('allows that save when the caller declares an intentional bulk delete', async () => {
    delete env.STORE_BACKEND
    storedAppState = { deed_serials: JSON.stringify(rows(800)) }
    await saveStoreKeys({ deed_serials: JSON.stringify(rows(200)) }, { allowBulkDelete: ['deed_serials'] })
    expect(legacyInserts()).toHaveLength(1)
  })
})

describe('loadAppState honours STORE_BACKEND', () => {
  it('default reads app_state and never consults the Prisma projection', async () => {
    delete env.STORE_BACKEND
    storedAppState = { deed_serials: JSON.stringify(rows(2)) }
    const state = await loadAppState(['deed_serials'])
    expect(state.deed_serials).toHaveLength(2)
    expect(mockPrismaState.loadPrismaState).not.toHaveBeenCalled()
  })

  it('prisma reads the projection first', async () => {
    env.STORE_BACKEND = 'prisma'
    mockPrismaState.loadPrismaState.mockResolvedValue({ deed_serials: rows(5) })
    const state = await loadAppState(['deed_serials'])
    expect(state.deed_serials).toHaveLength(5)
  })
})
