import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks (route-level regression) ────────────────────────────────────
const { mockGetSession, mockLoadAppState, mockSaveStoreKeys, mockGetAppStateVersion } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockGetAppStateVersion: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetSession }))
vi.mock('@/lib/server-store', async () => {
  // Keep the real, database-free assertNoBulkDeletes; mock only I/O.
  const actual = await vi.importActual<typeof import('@/lib/server-store')>('@/lib/server-store')
  return {
    assertNoBulkDeletes: actual.assertNoBulkDeletes,
    loadAppState: mockLoadAppState,
    loadAppStateForWrite: mockLoadAppState,
    saveStoreKeys: mockSaveStoreKeys,
    getAppStateVersion: mockGetAppStateVersion,
  }
})
vi.mock('@/lib/auth/db', () => ({ sql: vi.fn(), withDbTransaction: vi.fn() }))

import {
  BULK_DELETE_MAX_REMOVALS,
  BulkDeleteRefusedError,
  assessCollectionShrink,
  guardCollectionWrite,
  unionMissingRecords,
} from '@/lib/store-bulk-delete-guard'
import { assertNoBulkDeletes } from '@/lib/server-store'
import { storeBackend, readsPrismaState, writesLegacyAppState, writesPrismaState } from '@/lib/store-backend'
import { POST as STORE_POST } from '@/app/api/store/route'

const serial = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  serial: `SN${i}`,
  status: 'available',
  ...extra,
})
const collection = (n: number) => Array.from({ length: n }, (_, i) => serial(i))

describe('assessCollectionShrink', () => {
  it('counts stored records missing from the payload', () => {
    const shrink = assessCollectionShrink(collection(800), collection(200))
    expect(shrink).toMatchObject({ existing: 800, incoming: 200, removed: 600, isBulkDelete: true })
  })

  it('does not treat additions or small deletes as bulk', () => {
    expect(assessCollectionShrink(collection(10), collection(12)).isBulkDelete).toBe(false)
    const fewer = collection(800).slice(BULK_DELETE_MAX_REMOVALS)
    expect(assessCollectionShrink(collection(800), fewer)).toMatchObject({
      removed: BULK_DELETE_MAX_REMOVALS,
      isBulkDelete: false,
    })
  })

  it('compares by identity, not length (same count, different records)', () => {
    const swapped = [...collection(800).slice(0, 790), ...Array.from({ length: 10 }, (_, i) => serial(1000 + i))]
    expect(assessCollectionShrink(collection(800), swapped)).toMatchObject({ removed: 10, isBulkDelete: true })
  })
})

describe('guardCollectionWrite / unionMissingRecords', () => {
  it('REGRESSION 21-Sep-2026: saving a 200-record page of an 800-record collection keeps all 800', () => {
    const stored = collection(800)
    const page = collection(200).map((row, i) => (i === 0 ? { ...row, status: 'sold' } : row))
    const guarded = guardCollectionWrite(stored, page)
    expect(guarded.blocked).toBe(true)
    const value = guarded.value as Array<{ id: string; status: string }>
    expect(value).toHaveLength(800)
    expect(new Set(value.map(r => r.id)).size).toBe(800)
    // The caller's edit on a record it did load still wins.
    expect(value.find(r => r.id === page[0].id)?.status).toBe('sold')
  })

  it('lets a normal single-record delete through unchanged', () => {
    const stored = collection(50)
    const incoming = stored.filter((_, i) => i !== 7)
    const guarded = guardCollectionWrite(stored, incoming)
    expect(guarded.blocked).toBe(false)
    expect(guarded.value).toBe(incoming)
  })

  it('passes non-array values through', () => {
    expect(guardCollectionWrite(true, false)).toMatchObject({ value: false, blocked: false })
  })

  it('union keeps incoming order first and appends unseen stored rows', () => {
    const merged = unionMissingRecords([serial(1), serial(2), serial(3)], [serial(3), serial(9)]) as Array<{ serial: string }>
    expect(merged.map(r => r.serial)).toEqual(['SN3', 'SN9', 'SN1', 'SN2'])
  })
})

describe('assertNoBulkDeletes (storage-layer backstop)', () => {
  const loadCurrent = async () => ({ deed_serials: collection(800) })

  it('refuses a save that would delete 600 records', async () => {
    await expect(
      assertNoBulkDeletes({ deed_serials: JSON.stringify(collection(200)) }, loadCurrent),
    ).rejects.toBeInstanceOf(BulkDeleteRefusedError)
  })

  it('allows an explicit bulk delete for that key', async () => {
    await expect(
      assertNoBulkDeletes(
        { deed_serials: JSON.stringify(collection(200)) },
        loadCurrent,
        { allowBulkDelete: ['deed_serials'] },
      ),
    ).resolves.toBeUndefined()
  })

  it('ignores scalar keys and does not load anything for them', async () => {
    const load = vi.fn(loadCurrent)
    await assertNoBulkDeletes({ deed_posSessionOpen: 'true' }, load)
    expect(load).not.toHaveBeenCalled()
  })
})

describe('POST /api/store — partial collection payloads', () => {
  const director = { user: { id: 'u2', name: 'Director', username: 'director', role: 'director', modules: ['inventory'] } }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(director)
    mockSaveStoreKeys.mockResolvedValue(undefined)
    mockGetAppStateVersion.mockResolvedValue('v1')
  })

  it('REGRESSION: a browser holding 200 of 800 serials cannot truncate deed_serials', async () => {
    mockLoadAppState.mockResolvedValue({ deed_serials: collection(800), deed_stockMoves: collection(778) })
    const res = await STORE_POST(new Request('http://localhost/api/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deed_serials: JSON.stringify(collection(200)),
        deed_stockMoves: JSON.stringify(collection(200)),
      }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bulkDeleteBlockedKeys.sort()).toEqual(['deed_serials', 'deed_stockMoves'])
    const saved = mockSaveStoreKeys.mock.calls.find(([entries]) => 'deed_serials' in entries)?.[0]
    expect(JSON.parse(saved.deed_serials)).toHaveLength(800)
    expect(JSON.parse(saved.deed_stockMoves)).toHaveLength(778)
  })

  it('still saves a one-record delete as a replace', async () => {
    mockLoadAppState.mockResolvedValue({ deed_serials: collection(20) })
    const res = await STORE_POST(new Request('http://localhost/api/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deed_serials: JSON.stringify(collection(19)) }),
    }))
    const body = await res.json()
    expect(body.bulkDeleteBlockedKeys).toEqual([])
    const saved = mockSaveStoreKeys.mock.calls.find(([entries]) => 'deed_serials' in entries)?.[0]
    expect(JSON.parse(saved.deed_serials)).toHaveLength(19)
  })
})

describe('STORE_BACKEND', () => {
  const original = process.env.STORE_BACKEND
  afterEach(() => {
    if (original === undefined) delete process.env.STORE_BACKEND
    else process.env.STORE_BACKEND = original
  })

  it('defaults to app_state: reads and writes stay on the legacy table', () => {
    delete process.env.STORE_BACKEND
    expect(storeBackend()).toBe('app_state')
    expect(readsPrismaState()).toBe(false)
    expect(writesLegacyAppState()).toBe(true)
    expect(writesPrismaState()).toBe(false)
  })

  it('dual writes both layers but still reads app_state', () => {
    process.env.STORE_BACKEND = 'dual'
    expect(readsPrismaState()).toBe(false)
    expect(writesLegacyAppState()).toBe(true)
    expect(writesPrismaState()).toBe(true)
  })

  it('prisma reads and writes only the projection', () => {
    process.env.STORE_BACKEND = 'prisma'
    expect(readsPrismaState()).toBe(true)
    expect(writesLegacyAppState()).toBe(false)
    expect(writesPrismaState()).toBe(true)
  })
})
