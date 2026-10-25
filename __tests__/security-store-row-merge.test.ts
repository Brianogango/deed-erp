import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { mergeFilteredStoreWrite } from '@/lib/auth/authorization'

const m = vi.hoisted(() => ({ getServerSession: vi.fn(), state: {} as Record<string, unknown>, saveStoreKeys: vi.fn(), tombstones: [] as unknown[] }))
vi.mock('@/lib/auth/server', () => ({ getServerSession: m.getServerSession }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn(async () => structuredClone(m.state)),
  loadAppStateForWrite: vi.fn(async () => structuredClone(m.state)),
  saveStoreKeys: m.saveStoreKeys,
  getAppStateVersion: vi.fn(async () => 'v1'),
}))
vi.mock('@/lib/repair-tombstones', () => ({
  loadRepairTombstones: vi.fn(async () => m.tombstones),
  tombstoneIds: (rows: Array<{ id: string }>) => new Set(rows.map(r => r.id)),
}))

import { PUT } from '@/app/api/store/[key]/route'

const tech = { id: 'tech-a', role: 'technician' as const, modules: ['repair' as const] }

describe('mergeFilteredStoreWrite with the writer', () => {
  it('keeps rows outside the writer\'s slice as stored', () => {
    const stored = [
      { id: 'mine', assignedTechnicianId: 'tech-a', diagnosis: 'old' },
      { id: 'theirs', assignedTechnicianId: 'tech-b', diagnosis: 'theirs' },
    ]
    const incoming = [
      { id: 'mine', assignedTechnicianId: 'tech-a', diagnosis: 'new' },
      { id: 'theirs', assignedTechnicianId: 'tech-a', diagnosis: 'hijacked' },
      { id: 'brand-new', createdByUserId: 'tech-a' },
    ]
    const merged = mergeFilteredStoreWrite(stored, incoming, { user: tech, key: 'deed_repairs_v2' })
    expect(merged.find(r => r.id === 'mine')?.diagnosis).toBe('new')
    expect(merged.find(r => r.id === 'theirs')).toEqual(stored[1])
    expect(merged.find(r => r.id === 'brand-new')).toBeDefined()
  })

  it('a user cannot rewrite a colleague\'s expense claim', () => {
    const stored = [{ id: 'e1', submittedByUserId: 'someone', amount: 100 }]
    const merged = mergeFilteredStoreWrite(stored, [{ id: 'e1', submittedByUserId: 'u9', amount: 1 }], { user: { id: 'u9', role: 'sales_rep' as const, modules: ['expenses' as const] }, key: 'deed_expenses' })
    expect(merged).toEqual(stored)
  })
})

describe('PUT /api/store/deed_repairs_v2', () => {
  beforeEach(() => { vi.clearAllMocks(); m.saveStoreKeys.mockResolvedValue(undefined) })

  it('does not bring back a deleted repair', async () => {
    m.getServerSession.mockResolvedValue({ user: { id: 'lead', role: 'technical_lead', modules: ['repair' as const] } })
    m.state = { deed_repairs_v2: [{ id: 'r1', ref: 'REP/1' }] }
    m.tombstones = [{ id: 'r-deleted' }]
    const req = new NextRequest('http://x/api/store/deed_repairs_v2', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify([{ id: 'r1', ref: 'REP/1' }, { id: 'r-deleted', ref: 'REP/2' }]) }),
    })
    const res = await PUT(req, { params: Promise.resolve({ key: 'deed_repairs_v2' }) })
    expect(res.status).toBe(200)
    const saved = JSON.parse(m.saveStoreKeys.mock.calls[0][0].deed_repairs_v2)
    expect(saved.map((r: { id: string }) => r.id)).toEqual(['r1'])
  })
})
