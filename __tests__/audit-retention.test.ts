import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  default: {
    storeAuditArchive: {
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn().mockResolvedValue({ deed_audit_timeline_v1: [] }),
  saveStoreKeys: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/auth/server', () => ({
  getServerSession: vi.fn(),
}))

import { appendStoreAudit, MAX_AUDIT_ROWS } from '@/lib/store-audit'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { getServerSession } from '@/lib/auth/server'
import prisma from '@/lib/prisma'
import { CLIENT_IMMUTABLE_STORE_KEYS } from '@/lib/auth/authorization'

describe('P0-SEC-002 audit retention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('treats deed_auditLogs as client-immutable', () => {
    expect(CLIENT_IMMUTABLE_STORE_KEYS.has('deed_auditLogs')).toBe(true)
    expect(CLIENT_IMMUTABLE_STORE_KEYS.has('deed_audit_timeline_v1')).toBe(true)
  })

  it('archives displaced rows instead of discarding them', async () => {
    const existing = Array.from({ length: MAX_AUDIT_ROWS }, (_, i) => ({
      id: `old-${i}`,
      at: new Date(Date.now() - (MAX_AUDIT_ROWS - i) * 1000).toISOString(),
      actor: { id: 'u1', username: 'dir', role: 'director' },
      source: 'store_sync' as const,
      savedKeys: ['deed_products'],
      skippedKeys: [],
    }))
    vi.mocked(loadAppState).mockResolvedValue({ deed_audit_timeline_v1: existing })
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', username: 'dir', role: 'director', name: 'Dir', modules: [], active: true, createdAt: '' },
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    } as never)

    await appendStoreAudit(
      await getServerSession(),
      ['deed_quotes'],
      [],
    )

    expect(prisma.storeAuditArchive.createMany).toHaveBeenCalled()
    const archivedArg = vi.mocked(prisma.storeAuditArchive.createMany).mock.calls[0]?.[0]
    const archivedData = archivedArg?.data
    expect(Array.isArray(archivedData) ? archivedData.length : 0).toBeGreaterThanOrEqual(1)
    expect(vi.mocked(saveStoreKeys)).toHaveBeenCalled()
    const saved = JSON.parse(vi.mocked(saveStoreKeys).mock.calls[0][0].deed_audit_timeline_v1 as string)
    expect(saved).toHaveLength(MAX_AUDIT_ROWS)
  })
})
