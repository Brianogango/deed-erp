import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockRequireRole, mockPrismaOutboundRelease, mockPrismaRepair } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockPrismaOutboundRelease: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  mockPrismaRepair: {
    update: vi.fn(),
  },
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      const msg = status < 500 ? (err?.message ?? 'Bad request') : 'Internal server error'
      return new Response(JSON.stringify({ error: msg }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  },
  getRequiredSession: vi.fn(),
  requireRole: mockRequireRole,
}))

vi.mock('@/lib/prisma', () => ({
  default: { outboundRelease: mockPrismaOutboundRelease, repair: mockPrismaRepair },
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn(),
  saveStoreKeys: vi.fn(),
}))

vi.mock('@/lib/portal-repairs', () => ({
  registerPortalRepair: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { pickHandler, voidHandler } from '@/app/api/outbound-releases/[id]/route'

const operationalActor = { id: 'u1', name: 'Sales Rep', username: 'sales', role: 'sales_rep' }
const RELEASE_ID = 'release-1'

function err403() { return Object.assign(new Error('Forbidden — insufficient role'), { status: 403 }) }

function req(body: unknown = {}): NextRequest {
  return new NextRequest('http://localhost/api/outbound-releases/release-1/pick', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue(operationalActor)
})

describe('pickHandler', () => {
  it('allows an operational role to pick a pending release', async () => {
    mockPrismaOutboundRelease.findUniqueOrThrow.mockResolvedValue({ id: RELEASE_ID, status: 'pending' })
    mockPrismaOutboundRelease.update.mockResolvedValue({ id: RELEASE_ID, status: 'all_picked' })
    const res = await pickHandler(req(), RELEASE_ID)
    expect(res.status).toBe(200)
  })

  it('returns 403 for a role outside OPERATIONAL_ROLES (e.g. technician)', async () => {
    mockRequireRole.mockRejectedValue(err403())
    const res = await pickHandler(req(), RELEASE_ID)
    expect(res.status).toBe(403)
    expect(mockPrismaOutboundRelease.update).not.toHaveBeenCalled()
  })
})

describe('voidHandler', () => {
  it('allows an operational role to void a pending (not yet verified) release', async () => {
    mockPrismaOutboundRelease.findUniqueOrThrow.mockResolvedValue({ id: RELEASE_ID, status: 'pending', repairId: null })
    mockPrismaOutboundRelease.update.mockResolvedValue({ id: RELEASE_ID, status: 'voided' })
    const res = await voidHandler(req({ reason: 'mistake' }), RELEASE_ID)
    expect(res.status).toBe(200)
  })

  it('returns 403 for a role outside OPERATIONAL_ROLES on a pending release', async () => {
    mockRequireRole.mockRejectedValue(err403())
    const res = await voidHandler(req({ reason: 'mistake' }), RELEASE_ID)
    expect(res.status).toBe(403)
    expect(mockPrismaOutboundRelease.update).not.toHaveBeenCalled()
  })

  it('requires the stricter director-only gate to void an already-verified release', async () => {
    mockPrismaOutboundRelease.findUniqueOrThrow.mockResolvedValue({ id: RELEASE_ID, status: 'verified', repairId: null })
    // First requireRole call (OPERATIONAL_ROLES) succeeds, second (VOID_AFTER_VERIFIED_ROLES) fails.
    mockRequireRole.mockResolvedValueOnce(operationalActor).mockRejectedValueOnce(err403())
    const res = await voidHandler(req({ reason: 'mistake' }), RELEASE_ID)
    expect(res.status).toBe(403)
    expect(mockPrismaOutboundRelease.update).not.toHaveBeenCalled()
  })
})
