import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSession, mockLoadAppState, mockSaveStoreKeys, mockGetAppStateVersion } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockGetAppStateVersion: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetSession }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  loadAppStateForWrite: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
  getAppStateVersion: mockGetAppStateVersion,
}))
vi.mock('@/lib/auth/db', () => ({ sql: vi.fn(), withDbTransaction: vi.fn() }))

import { applyCollectionDelta, computeCollectionDelta, isCollectionDelta } from '@/lib/store-delta'
import { POST as STORE_POST } from '@/app/api/store/route'

const row = (i: number, extra: Record<string, unknown> = {}) => ({ id: `s${i}`, serial: `SN${i}`, status: 'available', ...extra })
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i))
const json = (v: unknown) => JSON.stringify(v)

describe('computeCollectionDelta', () => {
  it('sends only the changed, new and removed records', () => {
    const before = rows(40)
    const after = [row(99), ...before.filter(r => r.id !== 's5').map(r => (r.id === 's3' ? { ...r, status: 'sold' } : r))]
    const delta = computeCollectionDelta(json(before), json(after))!
    expect(delta.upsert.map((r: any) => r.id).sort()).toEqual(['s3', 's99'])
    expect(delta.remove).toEqual(['s5'])
  })

  it('an unchanged collection is an empty delta', () => {
    expect(computeCollectionDelta(json(rows(40)), json(rows(40)))).toEqual({ upsert: [], remove: [] })
  })

  it('falls back to the full value when a delta cannot stand in for it', () => {
    expect(computeCollectionDelta(json(rows(5)), json(rows(6)))).toBeNull() // small
    expect(computeCollectionDelta(json(rows(40)), json(rows(40).map(r => ({ ...r, status: 'x' }))))).toBeNull() // most changed
    expect(computeCollectionDelta(json(rows(40)), json([...rows(40), { serial: 'no-id' }]))).toBeNull()
    expect(computeCollectionDelta(json(rows(40)), json([...rows(40), row(1)]))).toBeNull() // duplicate id
    expect(computeCollectionDelta(json({ a: 1 }), json(rows(40)))).toBeNull()
    expect(computeCollectionDelta('not json', json(rows(40)))).toBeNull()
  })
})

describe('applyCollectionDelta', () => {
  it('replaces in place, puts new rows first and drops removed rows', () => {
    const out = applyCollectionDelta(rows(4), { upsert: [row(2, { status: 'sold' }), row(9)], remove: ['s0'] }) as any[]
    expect(out.map(r => r.id)).toEqual(['s9', 's1', 's2', 's3'])
    expect(out[2].status).toBe('sold')
  })

  it('keeps records the browser never touched — including other people\'s newer edits', () => {
    const stored = rows(4).map(r => (r.id === 's1' ? { ...r, status: 'edited-by-someone-else' } : r))
    const out = applyCollectionDelta(stored, { upsert: [row(3, { status: 'sold' })], remove: [] }) as any[]
    expect(out.find(r => r.id === 's1').status).toBe('edited-by-someone-else')
  })

  it('refuses a stored value that is not a collection', () => {
    expect(applyCollectionDelta({ a: 1 }, { upsert: [], remove: [] })).toBeNull()
    expect(applyCollectionDelta(undefined, { upsert: [row(1)], remove: [] })).toEqual([row(1)])
  })

  it('validates the shape', () => {
    expect(isCollectionDelta({ upsert: [row(1)], remove: ['s2'] })).toBe(true)
    expect(isCollectionDelta({ upsert: [{ serial: 'x' }], remove: [] })).toBe(false)
    expect(isCollectionDelta({ upsert: [], remove: [5] })).toBe(false)
    expect(isCollectionDelta([])).toBe(false)
  })
})

describe('POST /api/store — changed-records saves', () => {
  const director = { user: { id: 'u2', name: 'Director', username: 'director', role: 'director', modules: ['inventory'] } }
  const post = (body: unknown) => STORE_POST(new Request('http://localhost/api/store', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(director)
    mockSaveStoreKeys.mockResolvedValue(undefined)
    mockGetAppStateVersion.mockResolvedValue('v1')
  })

  it('rebuilds the full collection from the stored copy and saves it', async () => {
    mockLoadAppState.mockResolvedValue({ deed_serials: rows(30) })
    const res = await post({ _delta: { deed_serials: { upsert: [row(4, { status: 'sold' }), row(77)], remove: ['s0'] } } })
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_serials)
    expect(saved).toHaveLength(30)
    expect(saved[0].id).toBe('s77')
    expect(saved.find((r: any) => r.id === 's4').status).toBe('sold')
    expect(saved.some((r: any) => r.id === 's0')).toBe(false)
  })

  it('still applies write permissions to a changed-records save', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u9', name: 'Rep', username: 'rep', role: 'sales_rep', modules: ['sales'] } })
    mockLoadAppState.mockResolvedValue({ deed_auditLogs: rows(30) })
    const res = await post({ _delta: { deed_journalEntries: { upsert: [row(1)], remove: [] } } })
    expect([200, 403]).toContain(res.status)
    const savedJournals = mockSaveStoreKeys.mock.calls.some(([entries]) => 'deed_journalEntries' in entries)
    expect(savedJournals).toBe(false)
  })

  it('rejects a malformed delta, and one sent alongside the full value', async () => {
    mockLoadAppState.mockResolvedValue({ deed_serials: rows(30) })
    expect((await post({ _delta: { deed_serials: { upsert: [{ serial: 'x' }], remove: [] } } })).status).toBe(400)
    expect((await post({ deed_serials: json(rows(30)), _delta: { deed_serials: { upsert: [], remove: [] } } })).status).toBe(400)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('answers 409 when the stored value is not a collection, so the browser resends it whole', async () => {
    mockLoadAppState.mockResolvedValue({ deed_serials: { broken: true } })
    const res = await post({ _delta: { deed_serials: { upsert: [row(1)], remove: [] } } })
    expect(res.status).toBe(409)
  })
})
