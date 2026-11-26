import { beforeEach, describe, expect, it, vi } from 'vitest'

// A unit only in deed_serials used to crash the bench job on its first write
// (serial_id foreign key) with a bare "Internal server error".
const db = { serials: new Map<string, any>(), bySerial: new Map<string, any>(), products: new Set<string>(), created: [] as any[], blob: [] as any[] }

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  default: {
    serialNumber: {
      findUnique: async ({ where }: any) => (where.id ? db.serials.get(where.id) : db.bySerial.get(where.serialNumber)) ?? null,
      create: async ({ data }: any) => { db.created.push(data); db.serials.set(data.id, data) },
    },
    product: { findUnique: async ({ where }: any) => (db.products.has(where.id) ? { id: where.id } : null) },
  },
}))
vi.mock('@/lib/server-store', () => ({ loadAppState: async () => ({ deed_serials: db.blob }) }))

const { ensureDeviceInDatabase } = await import('@/lib/reconfiguration/ensure-device-row')

const SER = '11111111-1111-4111-8111-111111111111'
const PROD = '22222222-2222-4222-8222-222222222222'
const device = { serialId: SER, manufacturerSerial: 'MP1CVDWY', productId: PROD, productName: 'Lenovo Thinkpad Yoga 370' }

beforeEach(() => {
  db.serials.clear(); db.bySerial.clear(); db.products.clear(); db.created = []
  db.blob = [{ id: SER, serial: 'MP1CVDWY', productId: PROD, status: 'available', location: 'warehouse', specs: '16GB 512GB SSD' }]
})

describe('ensureDeviceInDatabase', () => {
  it('does nothing when the unit is already in the database', async () => {
    db.serials.set(SER, { id: SER })
    await ensureDeviceInDatabase(device)
    expect(db.created).toHaveLength(0)
  })

  it('copies an app-state-only unit in when its product is in the database', async () => {
    db.products.add(PROD)
    await ensureDeviceInDatabase(device)
    expect(db.created).toHaveLength(1)
    expect(db.created[0]).toMatchObject({ id: SER, serialNumber: 'MP1CVDWY', productId: PROD, status: 'in_stock', location: 'warehouse' })
  })

  it('stops with a clear 422 before any write when the product is missing', async () => {
    await expect(ensureDeviceInDatabase(device)).rejects.toMatchObject({ status: 422, message: expect.stringContaining('MP1CVDWY') })
    expect(db.created).toHaveLength(0)
  })

  it('refuses to create a second row for a serial number already in use', async () => {
    db.products.add(PROD)
    db.bySerial.set('MP1CVDWY', { id: 'other' })
    await expect(ensureDeviceInDatabase(device)).rejects.toMatchObject({ status: 409 })
    expect(db.created).toHaveLength(0)
  })
})
