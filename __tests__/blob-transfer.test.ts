import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSql, mockPrisma, mockWriteStoreRecords } = vi.hoisted(() => {
  const appState = new Map<string, string>()
  return {
    mockSql: Object.assign(
      vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = String.raw({ raw: strings }, ...values.map(() => '?'))
        if (text.includes('SELECT key, value FROM app_state') && !text.includes('WHERE')) {
          return {
            rows: [...appState.entries()]
              .filter(([key]) => !key.startsWith('archive:'))
              .map(([key, value]) => ({ key, value })),
          }
        }
        if (text.includes('INSERT INTO app_state')) {
          const key = String(values[0])
          const value = String(values[1])
          appState.set(key, value)
          return { rows: [] }
        }
        if (text.includes('DELETE FROM app_state')) {
          const key = String(values[0])
          appState.delete(key)
          return { rows: [] }
        }
        if (text.includes('COUNT(*)')) {
          const n = [...appState.keys()].filter(k => !k.startsWith('archive:')).length
          return { rows: [{ n }] }
        }
        return { rows: [] }
      }),
      { __appState: appState },
    ),
    mockWriteStoreRecords: vi.fn(async () => undefined),
    mockPrisma: {
      user: { findFirst: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }) },
      storeRecord: {
        findUnique: vi.fn(),
      },
      product: { findUnique: vi.fn() },
      serialNumber: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
      stockMovement: { upsert: vi.fn() },
      goodsReceivedNote: { upsert: vi.fn() },
      purchaseOrder: { findUnique: vi.fn() },
    },
  }
})

vi.mock('@/lib/auth/db', () => ({ sql: mockSql }))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/prisma-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/prisma-store')>('@/lib/prisma-store')
  return {
    ...actual,
    writeStoreRecords: mockWriteStoreRecords,
    storeBackend: () => 'prisma',
  }
})
vi.mock('@/lib/repair-mirror', () => ({
  mirrorRepairsToPrisma: vi.fn().mockResolvedValue({ upserted: 1, mirrored: 1 }),
}))
vi.mock('@/lib/accounting/account-journal-mirror', () => ({
  mirrorAccountsToPrisma: vi.fn().mockResolvedValue(undefined),
  mirrorJournalEntriesToPrisma: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/inventory/reservation-mirror', () => ({
  mirrorStockReservationsToPrisma: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/accounting/deposit-mirror', () => ({
  mirrorDepositsToPrisma: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/accounting/holdover-mirror', () => ({
  mirrorHoldoversToPrisma: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/delivery-mirror', () => ({
  mirrorDeliveryToPrisma: vi.fn().mockResolvedValue({ mirrored: true }),
}))
vi.mock('@/lib/purchase/po-prisma-sync', () => ({
  ensurePrismaPurchaseOrder: vi.fn().mockResolvedValue('po-1'),
}))

import { countLiveAppStateKeys, transferBlobsToPrisma } from '@/lib/blob-transfer'
import { POST as blobTransferPost } from '@/app/api/admin/blob-transfer/route'

vi.mock('@/lib/auth/server', () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: 'director' } }),
}))
vi.mock('@/lib/auth/authorization', () => ({
  isRoleAllowed: () => true,
}))

beforeEach(() => {
  mockSql.__appState.clear()
  vi.clearAllMocks()
  mockPrisma.user.findFirst.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
  mockPrisma.storeRecord.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => (
    where.key === 'deed_serials' || where.key === 'deed_contacts' ? { key: where.key } : null
  ))
  mockWriteStoreRecords.mockResolvedValue(undefined)
})

describe('transferBlobsToPrisma', () => {
  it('copies JSON app_state keys into store_records and skips binaries', async () => {
    mockSql.__appState.set('deed_serials', JSON.stringify([{ id: 's1', serial: 'ABC', productId: 'not-uuid' }]))
    mockSql.__appState.set('expense_receipt_x', 'data:image/png;base64,xx')
    mockSql.__appState.set('archive:old', '[]')

    const result = await transferBlobsToPrisma()
    expect(result.ok).toBe(true)
    expect(result.copied).toBe(1)
    expect(result.retired).toBe(0)
    expect(mockWriteStoreRecords).toHaveBeenCalledWith({
      deed_serials: JSON.stringify([{ id: 's1', serial: 'ABC', productId: 'not-uuid' }]),
    })
    expect(result.domains[0].key).toBe('deed_serials')
    expect(mockSql.__appState.has('deed_serials')).toBe(true)
  })

  it('refuses to retire a key that has no Prisma copy', async () => {
    mockSql.__appState.set('deed_contacts', '[]')
    mockPrisma.storeRecord.findUnique.mockResolvedValue(null)

    const result = await transferBlobsToPrisma({ retire: true })
    expect(result.ok).toBe(false)
    expect(result.retired).toBe(0)
    expect(result.errors[0]).toMatch(/Refuse to retire deed_contacts/)
    expect(mockSql.__appState.has('deed_contacts')).toBe(true)
  })

  it('archives then deletes live app_state after a Prisma copy exists', async () => {
    mockSql.__appState.set('deed_serials', '[]')
    mockPrisma.storeRecord.findUnique.mockResolvedValue({ key: 'deed_serials' })

    const result = await transferBlobsToPrisma({ retire: true })
    expect(result.ok).toBe(true)
    expect(result.retired).toBe(1)
    expect(mockSql.__appState.has('deed_serials')).toBe(false)
    expect(mockSql.__appState.has('archive:deed_serials:prisma-transfer')).toBe(true)
  })

  it('counts live app_state keys excluding archives', async () => {
    mockSql.__appState.set('deed_serials', '[]')
    mockSql.__appState.set('archive:x', '[]')
    expect(await countLiveAppStateKeys()).toBe(1)
  })
})

describe('POST /api/admin/blob-transfer', () => {
  it('requires RETIRE_APP_STATE to retire live blobs', async () => {
    const req = new Request('http://localhost/api/admin/blob-transfer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ retire: true }),
    })
    const res = await blobTransferPost(req as never)
    expect(res).toBeDefined()
    expect(res!.status).toBe(400)
    const body = await res!.json()
    expect(body.error).toMatch(/RETIRE_APP_STATE/)
  })
})
