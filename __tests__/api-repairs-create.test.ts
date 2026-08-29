import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetServerSession, mockLoadAppState, mockSaveStoreKeys, mockGetNextRepairRef } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockGetNextRepairRef: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({
  getServerSession: mockGetServerSession,
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  loadAppStateForWrite: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
  withAppStateKeyLock: (_key: string, fn: () => Promise<unknown>) => fn(),
}))

vi.mock('@/lib/repair-ref-counter', () => ({
  getNextRepairRef: mockGetNextRepairRef,
}))

import { POST } from '@/app/api/repairs/route'

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/repairs', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue({
    user: { id: 'u1', role: 'technical_lead', name: 'Lead' },
  })
  mockLoadAppState.mockResolvedValue({ deed_repairs_v2: [] })
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockGetNextRepairRef.mockResolvedValue('REP/2099/0001')
})

describe('POST /api/repairs — intake fields', () => {
  it('persists Direct Repair path, waiver, and warranty on create', async () => {
    const body = {
      id: 'rep_intake_1',
      customerId: 'c1',
      customerName: 'Jane Doe',
      productName: 'HP EliteBook',
      serialNumber: 'SN-ABC-1234',
      issueDescription: 'No power',
      repairPath: 'direct_repair',
      underWarranty: true,
      warrantyCoverage: 'full',
      warrantyId: 'war_1',
      liabilityWaiverAccepted: true,
      liabilityWaiverSignature: 'Jane Doe',
      diagnosisFeeStatus: 'not_applicable',
      diagnosisFee: 0,
    }

    const res = await POST(makeReq(body))
    expect(res.status).toBe(201)
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_repairs_v2)
    expect(saved[0]).toEqual(expect.objectContaining({
      id: 'rep_intake_1',
      ref: 'REP/2099/0001',
      repairPath: 'direct_repair',
      underWarranty: true,
      warrantyCoverage: 'full',
      warrantyId: 'war_1',
      liabilityWaiverAccepted: true,
      liabilityWaiverSignature: 'Jane Doe',
      diagnosisFeeStatus: 'not_applicable',
    }))
  })

  it('merges with an existing same-id draft instead of clobbering path/warranty', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_repairs_v2: [{
        id: 'rep_intake_2',
        ref: 'TEMP',
        customerName: 'Jane Doe',
        productName: 'HP EliteBook',
        repairPath: 'direct_repair',
        underWarranty: true,
        warrantyCoverage: 'full',
        serialWarrantyException: true,
        serialWarrantyExceptionReason: 'label_unreadable',
      }],
    })

    const res = await POST(makeReq({
      id: 'rep_intake_2',
      customerName: 'Jane Doe',
      productName: 'HP EliteBook',
      // thinner create body without path — must not wipe existing intake
      status: 'received',
      underWarranty: false,
    }))
    expect(res.status).toBe(201)
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_repairs_v2)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toEqual(expect.objectContaining({
      id: 'rep_intake_2',
      ref: 'REP/2099/0001',
      repairPath: 'direct_repair',
      underWarranty: true,
      warrantyCoverage: 'full',
      serialWarrantyException: true,
      serialWarrantyExceptionReason: 'label_unreadable',
    }))
  })

  it('keeps an already-allocated sequential ticket instead of minting another', async () => {
    const res = await POST(makeReq({
      id: 'rep_keep_1',
      ref: 'REP/0275',
      customerName: 'Fiona Akoth',
      productName: 'HP 840 G4',
    }))
    expect(res.status).toBe(201)
    expect(mockGetNextRepairRef).not.toHaveBeenCalled()
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_repairs_v2)
    expect(saved[0].ref).toBe('REP/0275')
  })

  it('stores the timestamp placeholder as previousRefs when allocating sequential', async () => {
    const res = await POST(makeReq({
      id: 'rep_alias_1',
      ref: 'REP-227532',
      customerName: 'Fiona Akoth',
      productName: 'HP 840 G4',
      intakeDate: '2026-08-17T10:57:07.532Z',
    }))
    expect(res.status).toBe(201)
    expect(mockGetNextRepairRef).toHaveBeenCalledTimes(1)
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_repairs_v2)
    expect(saved[0].ref).toBe('REP/2099/0001')
    expect(saved[0].previousRefs).toEqual(['REP-227532'])
  })
})
