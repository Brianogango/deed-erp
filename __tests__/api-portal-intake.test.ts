import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockCheckRateLimit, mockLoadAppState, mockSaveStoreKeys, mockGetNextRepairRef } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockGetNextRepairRef: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
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

// ── Import (after mocks) ──────────────────────────────────────────────────────
import { POST } from '@/app/api/portal/intake/route'

// ── Helpers ───────────────────────────────────────────────────────────────────
const WAIVER_TEXT = 'I authorise Deed to proceed with direct repair work and acknowledge that customer-caused damage, liquid damage, previous tampering, or unavailable parts may affect warranty coverage and repair outcome.'

const validBody = {
  customerName: 'Alice Wanjiku',
  customerPhone: '+254712345678',
  productName: 'MacBook Pro 14"',
  issueDescription: 'Screen flickers when on battery',
  repairPath: 'diagnosis_first',
}

const directRepairBody = {
  ...validBody,
  repairPath: 'direct_repair',
  liabilityWaiverAccepted: true,
}

function makeReq(body: unknown, ip = '10.0.0.1'): NextRequest {
  return new NextRequest('http://localhost/api/portal/intake', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
  })
}

function rlOk() {
  return { success: true, remaining: 4, resetAt: Date.now() + 3600_000 }
}

function rlExceeded() {
  return { success: false, remaining: 0, resetAt: Date.now() + 3600_000 }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(rlOk())
  mockLoadAppState.mockResolvedValue({ deed_repairs_v2: [] })
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockGetNextRepairRef.mockResolvedValue('REP/0001')
})

// ── Rate limiting ─────────────────────────────────────────────────────────────
describe('POST /api/portal/intake — rate limiting', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    mockCheckRateLimit.mockResolvedValue(rlExceeded())
    const res = await POST(makeReq(validBody))
    expect(res.status).toBe(429)
  })

  it('includes Retry-After header on 429', async () => {
    mockCheckRateLimit.mockResolvedValue(rlExceeded())
    const res = await POST(makeReq(validBody))
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })

  it('includes error message on 429', async () => {
    mockCheckRateLimit.mockResolvedValue(rlExceeded())
    const body = await (await POST(makeReq(validBody))).json()
    expect(body.error).toContain('Too many submissions')
  })

  it('passes IP from x-forwarded-for to checkRateLimit', async () => {
    await POST(makeReq(validBody, '1.2.3.4'))
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.stringContaining('1.2.3.4'),
      5,
      3600,
    )
  })
})

// ── Input validation ──────────────────────────────────────────────────────────
describe('POST /api/portal/intake — validation', () => {
  it('returns 400 for malformed JSON', async () => {
    const req = new NextRequest('http://localhost/api/portal/intake', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 422 when customerName is missing', async () => {
    const { customerName: _, ...body } = validBody
    const res = await POST(makeReq(body))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('Customer name')
  })

  it('returns 422 when customerPhone is missing', async () => {
    const { customerPhone: _, ...body } = validBody
    const res = await POST(makeReq(body))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('phone')
  })

  it('returns 422 when productName is missing', async () => {
    const { productName: _, ...body } = validBody
    const res = await POST(makeReq(body))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('Device')
  })

  it('returns 422 when issueDescription is missing', async () => {
    const { issueDescription: _, ...body } = validBody
    const res = await POST(makeReq(body))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('Issue description')
  })

  it('returns 422 for direct_repair without liability waiver', async () => {
    const res = await POST(makeReq({ ...validBody, repairPath: 'direct_repair', liabilityWaiverAccepted: false }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('waiver')
  })

  it('accepts direct_repair when waiver is accepted', async () => {
    const res = await POST(makeReq(directRepairBody))
    expect(res.status).toBe(201)
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────
describe('POST /api/portal/intake — success', () => {
  it('returns 201 with repair object and trackingUrl', async () => {
    const res = await POST(makeReq(validBody))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.repair).toBeDefined()
    expect(body.trackingUrl).toContain('REP') // URL-encoded: REP%2F0001
  })

  it('sets status to "pending_verification"', async () => {
    const res = await POST(makeReq(validBody))
    const { repair } = await res.json()
    expect(repair.status).toBe('pending_verification')
  })

  it('sets intakeChannel to "website"', async () => {
    const res = await POST(makeReq(validBody))
    const { repair } = await res.json()
    expect(repair.intakeChannel).toBe('website')
  })

  it('sets repairPath from body', async () => {
    const res = await POST(makeReq(validBody))
    const { repair } = await res.json()
    expect(repair.repairPath).toBe('diagnosis_first')
  })

  it('sets default priority to "normal" when not provided', async () => {
    const res = await POST(makeReq(validBody))
    const { repair } = await res.json()
    expect(repair.priority).toBe('normal')
  })

  it('accepts explicit priority values', async () => {
    const res = await POST(makeReq({ ...validBody, priority: 'urgent' }))
    const { repair } = await res.json()
    expect(repair.priority).toBe('urgent')
  })

  it('rejects unknown priority and defaults to "normal"', async () => {
    const res = await POST(makeReq({ ...validBody, priority: 'extreme' }))
    const { repair } = await res.json()
    expect(repair.priority).toBe('normal')
  })

  it('sets liabilityWaiverText for direct_repair', async () => {
    const res = await POST(makeReq(directRepairBody))
    const { repair } = await res.json()
    expect(repair.liabilityWaiverText).toBe(WAIVER_TEXT)
  })

  it('does not set liabilityWaiverText for diagnosis_first', async () => {
    const res = await POST(makeReq(validBody))
    const { repair } = await res.json()
    expect(repair.liabilityWaiverText).toBeUndefined()
  })

  it('parses accessories from array', async () => {
    const accessories = [{ name: 'Charger' }, { name: 'Mouse' }]
    const res = await POST(makeReq({ ...validBody, accessories }))
    const { repair } = await res.json()
    expect(repair.accessories).toHaveLength(2)
    expect(repair.accessories[0].name).toBe('Charger')
    expect(repair.accessories[0].received).toBe(true)
  })

  it('parses accessories from comma-separated string', async () => {
    const res = await POST(makeReq({ ...validBody, accessories: 'Charger, Mouse, Bag' }))
    const { repair } = await res.json()
    expect(repair.accessories).toHaveLength(3)
    expect(repair.accessories.map((a: any) => a.name)).toContain('Charger')
  })

  it('filters out blank accessory names', async () => {
    const res = await POST(makeReq({ ...validBody, accessories: 'Charger,  , ' }))
    const { repair } = await res.json()
    expect(repair.accessories).toHaveLength(1)
  })

  it('stores the new repair in app state', async () => {
    await POST(makeReq(validBody))
    expect(mockSaveStoreKeys).toHaveBeenCalledWith(
      expect.objectContaining({ deed_repairs_v2: expect.any(String) })
    )
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_repairs_v2)
    expect(saved[0].status).toBe('pending_verification')
  })

  it('prepends to existing repairs list', async () => {
    const oldRepair = { id: 'old', ref: 'REP/0000', status: 'intake' }
    mockLoadAppState.mockResolvedValue({ deed_repairs_v2: [oldRepair] })
    await POST(makeReq(validBody))
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_repairs_v2)
    expect(saved).toHaveLength(2)
    expect(saved[0].ref).toBe('REP/0001')
    expect(saved[1].ref).toBe('REP/0000')
    expect(mockGetNextRepairRef).toHaveBeenCalledWith(['REP/0000'])
  })
})
