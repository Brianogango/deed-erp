import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SLIM_MARK, isSlimRow, restoreSlimRows, slimCollection } from '@/lib/store-slim'

const history = [{ status: 'received', date: 'd1' }, { status: 'collected', date: 'd2' }]
const qc = [{ id: 'q1', label: 'Screen', result: 'pass' }]
const dx = [{ id: 'dx1', findings: 'bad screen', revision: 1 }]
const repair = (over: Record<string, unknown> = {}) => ({
  id: 'r1', ref: 'REP-1', status: 'collected', customerName: 'Jane', quote: { total: 5000 },
  diagnosis: dx[0], qcItems: qc, statusHistory: history, diagnosisHistory: dx, ...over,
})

describe('slimCollection', () => {
  it('drops heavy fields from finished repairs and marks the row', () => {
    const [row] = slimCollection('deed_repairs_v2', [repair()]) as any[]
    expect(row[SLIM_MARK]).toEqual(['qcItems', 'statusHistory', 'diagnosisHistory'])
    expect(row.qcItems).toEqual([])
    expect(row.statusHistory).toEqual([])
    expect(row.diagnosisHistory).toEqual([])
    // Kept: what lists, KPIs and actions read.
    expect(row.diagnosis).toEqual(dx[0])
    expect(row.quote).toEqual({ total: 5000 })
  })

  it('leaves active repairs whole — they are being worked on', () => {
    const rows = [repair({ status: 'in_repair' }), repair({ status: 'qc' }), repair({ status: 'ready' })]
    expect(slimCollection('deed_repairs_v2', rows)).toEqual(rows)
  })

  it('drops signatures from completed releases only', () => {
    const rows = slimCollection('deed_outboundReleases', [
      { id: 'o1', status: 'released', receiverSigData: 'data:image/png;base64,AAA', customerAckSigData: 'data:x' },
      { id: 'o2', status: 'verified', receiverSigData: 'data:image/png;base64,BBB' },
    ]) as any[]
    expect(rows[0]).toMatchObject({ [SLIM_MARK]: ['receiverSigData', 'customerAckSigData'] })
    expect(rows[0].receiverSigData).toBeUndefined()
    expect(rows[1].receiverSigData).toBe('data:image/png;base64,BBB')
    expect(isSlimRow(rows[1])).toBe(false)
  })

  it('leaves other collections alone', () => {
    const rows = [{ id: 'i1', lines: [1, 2, 3] }]
    expect(slimCollection('deed_invoices', rows)).toBe(rows)
  })
})

describe('restoreSlimRows — a slimmed row never overwrites stored data', () => {
  const stored = [repair()]

  it('puts the stored fields back when a slimmed row is saved unchanged', () => {
    const slim = slimCollection('deed_repairs_v2', stored) as any[]
    const [row] = restoreSlimRows('deed_repairs_v2', stored, slim) as any[]
    expect(row).toEqual(repair())
    expect(SLIM_MARK in row).toBe(false)
  })

  it('a status change on a collected job appends to the stored log, keeping the rest', () => {
    const [slim] = slimCollection('deed_repairs_v2', stored) as any[]
    // What the store does: statusHistory: [...(r.statusHistory ?? []), entry]
    const closed = { ...slim, status: 'closed', statusHistory: [...slim.statusHistory, { status: 'closed', date: 'd3' }] }
    const [row] = restoreSlimRows('deed_repairs_v2', stored, [closed]) as any[]
    expect(row.status).toBe('closed')
    expect(row.statusHistory).toEqual([...history, { status: 'closed', date: 'd3' }])
    expect(row.qcItems).toEqual(qc)
    expect(row.diagnosisHistory).toEqual(dx)
  })

  it('ignores a checklist or diagnosis log rebuilt from the empty slim value', () => {
    const [slim] = slimCollection('deed_repairs_v2', stored) as any[]
    const rebuilt = { ...slim, qcItems: [{ id: 'default', label: 'Default', result: '' }], diagnosisHistory: [{ id: 'new', revision: 1 }] }
    const [row] = restoreSlimRows('deed_repairs_v2', stored, [rebuilt]) as any[]
    expect(row.qcItems).toEqual(qc)
    expect(row.diagnosisHistory).toEqual(dx)
  })

  it('saving the same slimmed row twice does not duplicate appended entries', () => {
    const [slim] = slimCollection('deed_repairs_v2', stored) as any[]
    const closed = { ...slim, status: 'closed', statusHistory: [{ status: 'closed', date: 'd3' }] }
    const once = restoreSlimRows('deed_repairs_v2', stored, [closed]) as any[]
    const twice = restoreSlimRows('deed_repairs_v2', once, [closed]) as any[]
    expect(twice[0].statusHistory).toHaveLength(3)
  })

  it('full rows (a record that was opened) pass through untouched', () => {
    const full = [repair({ qcItems: [{ id: 'q1', result: 'fail' }] })]
    expect(restoreSlimRows('deed_repairs_v2', stored, full)).toBe(full)
  })
})

// The route applies the restore to every save, delta or full.
const { mockGetSession, mockLoadAppState, mockSaveStoreKeys } = vi.hoisted(() => ({
  mockGetSession: vi.fn(), mockLoadAppState: vi.fn(), mockSaveStoreKeys: vi.fn(),
}))
vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetSession }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState, loadAppStateForWrite: mockLoadAppState, saveStoreKeys: mockSaveStoreKeys,
  getAppStateVersion: vi.fn().mockResolvedValue('v'), getAppStateKeyVersions: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/auth/db', () => ({ sql: vi.fn(), withDbTransaction: vi.fn() }))
vi.mock('@/lib/repair-tombstones', () => ({ loadRepairTombstones: vi.fn().mockResolvedValue([]), tombstoneIds: () => new Set() }))
import { GET, POST } from '@/app/api/store/route'
import { NextRequest } from 'next/server'

describe('/api/store with slim lists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'u1', role: 'director', modules: ['repair'] } })
    mockLoadAppState.mockResolvedValue({ deed_repairs_v2: [repair()] })
    mockSaveStoreKeys.mockResolvedValue(undefined)
  })

  it('GET sends finished repairs slimmed', async () => {
    const body = await (await GET(new NextRequest('http://localhost/api/store?keys=deed_repairs_v2'))).json()
    expect(isSlimRow(body.deed_repairs_v2[0])).toBe(true)
  })

  it('POST of a slimmed, changed row stores the full row with the change', async () => {
    const [slim] = slimCollection('deed_repairs_v2', [repair()]) as any[]
    const closed = { ...slim, status: 'closed', statusHistory: [{ status: 'closed', date: 'd3' }] }
    const res = await POST(new Request('http://localhost/api/store', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _delta: { deed_repairs_v2: { upsert: [closed], remove: [] } } }),
    }))
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_repairs_v2)
    expect(saved[0].status).toBe('closed')
    expect(saved[0].qcItems).toEqual(qc)
    expect(saved[0].diagnosisHistory).toEqual(dx)
    expect(saved[0].statusHistory).toHaveLength(3)
    expect(SLIM_MARK in saved[0]).toBe(false)
  })
})
