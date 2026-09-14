import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetServerSession,
  mockLoadAppState,
  mockSaveStoreKeys,
  mockFindRepairInPrisma,
  mockLoadRepairsFromPrisma,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockFindRepairInPrisma: vi.fn(),
  mockLoadRepairsFromPrisma: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({
  getServerSession: mockGetServerSession,
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
  withAppStateKeyLock: (_key: string, fn: () => Promise<unknown>) => fn(),
}))

vi.mock('@/lib/repair-mirror', () => ({
  findRepairInPrisma: mockFindRepairInPrisma,
  loadRepairsFromPrisma: mockLoadRepairsFromPrisma,
}))

vi.mock('@/lib/repair-warranty', () => ({
  findOpenRepairWithSerial: vi.fn().mockReturnValue(null),
  normalizeRepairSerial: (v: string) => String(v || '').trim().toUpperCase(),
  resolveRepairWarranty: vi.fn().mockReturnValue({ covered: false }),
  warrantyPatchFromDecision: vi.fn().mockReturnValue({}),
}))

import { GET, PATCH } from '@/app/api/repairs/[id]/route'

const REPAIR_ID = 'rep_open_1'
const leadSession = {
  user: { id: 'lead', role: 'technical_lead', name: 'Peter', modules: ['repair'] },
}

const prismaRepair = {
  id: REPAIR_ID,
  ref: 'REP/2026/0100',
  status: 'assigned',
  assignedTechnicianId: 't1',
  createdByUserId: 'lead',
  diagnosis: { findings: 'Blown DC jack', faultDescription: 'No power' },
}

let blob: unknown[] = []

beforeEach(() => {
  vi.clearAllMocks()
  blob = []
  mockGetServerSession.mockResolvedValue(leadSession)
  mockLoadAppState.mockImplementation(async () => ({ deed_repairs_v2: blob, deed_warranties: [] }))
  mockSaveStoreKeys.mockImplementation(async (entries: Record<string, string>) => {
    if (entries.deed_repairs_v2) blob = JSON.parse(entries.deed_repairs_v2)
  })
  mockFindRepairInPrisma.mockResolvedValue(prismaRepair)
  mockLoadRepairsFromPrisma.mockResolvedValue([prismaRepair])
})

describe('GET /api/repairs/:id', () => {
  it('returns the Prisma payload when the blob backup does not have the job', async () => {
    const res = await GET(new NextRequest(`http://localhost/api/repairs/${REPAIR_ID}`), {
      params: Promise.resolve({ id: REPAIR_ID }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).repair.diagnosis.findings).toBe('Blown DC jack')
  })
})

describe('PATCH /api/repairs/:id', () => {
  it('hydrates the blob from Prisma so diagnosis can persist when the backup row is missing', async () => {
    mockFindRepairInPrisma.mockResolvedValue(prismaRepair)
    const res = await PATCH(
      new NextRequest(`http://localhost/api/repairs/${REPAIR_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'diagnosed',
          diagnosis: { findings: 'Blown DC jack', faultDescription: 'No power' },
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: REPAIR_ID }) },
    )
    expect(mockSaveStoreKeys).toHaveBeenCalled()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item.status).toBe('diagnosed')
    expect(body.item.diagnosis.findings).toBe('Blown DC jack')
  })
})
