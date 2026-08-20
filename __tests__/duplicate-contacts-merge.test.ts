import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma, clients, updateManyCalls, people } = vi.hoisted(() => {
  const clients = new Map<string, any>()
  const updateManyCalls: Array<{ model: string; where: any; data: any }> = []
  const people: any[] = []

  function modelWithUpdateMany(name: string) {
    return {
      updateMany: vi.fn(async ({ where, data }: any) => {
        updateManyCalls.push({ model: name, where, data })
        return { count: 1 }
      }),
    }
  }

  const prisma = {
    client: {
      findUnique: vi.fn(async ({ where }: any) => clients.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const row = { ...clients.get(where.id), ...data }
        clients.set(where.id, row)
        return row
      }),
    },
    lead: modelWithUpdateMany('lead'),
    opportunity: modelWithUpdateMany('opportunity'),
    quote: modelWithUpdateMany('quote'),
    invoice: modelWithUpdateMany('invoice'),
    saleOrder: modelWithUpdateMany('saleOrder'),
    deliveryNote: modelWithUpdateMany('deliveryNote'),
    repair: modelWithUpdateMany('repair'),
    posTransaction: modelWithUpdateMany('posTransaction'),
    kilimallOrder: modelWithUpdateMany('kilimallOrder'),
    creditNote: modelWithUpdateMany('creditNote'),
    outboundRelease: modelWithUpdateMany('outboundRelease'),
    purchaseOrder: modelWithUpdateMany('purchaseOrder'),
    customerAsset: modelWithUpdateMany('customerAsset'),
    reconfigurationWorkOrder: modelWithUpdateMany('reconfigurationWorkOrder'),
    contactPerson: {
      findMany: vi.fn(async ({ where }: any) => people.filter(p => p.clientId === where.clientId)),
      update: vi.fn(async ({ where, data }: any) => {
        const row = people.find(p => p.id === where.id)
        Object.assign(row, data)
        return row
      }),
      delete: vi.fn(async ({ where }: any) => {
        const idx = people.findIndex(p => p.id === where.id)
        if (idx >= 0) people.splice(idx, 1)
      }),
    },
    $executeRawUnsafe: vi.fn(async () => 1),
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma)),
  }

  return { prisma, clients, updateManyCalls, people }
})

vi.mock('@/lib/prisma', () => ({ default: prisma }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn(async () => ({
    deed_invoices: [{ id: 'inv-1', partnerId: 'dup', customerId: 'dup' }],
    deed_saleOrders: [{ id: 'so-1', customerId: 'keep' }],
  })),
  saveStoreKeys: vi.fn(async () => undefined),
}))
vi.mock('@/lib/contact-prisma', () => ({
  broadcastContacts: vi.fn(async () => undefined),
}))

import { saveStoreKeys } from '@/lib/server-store'
import {
  mergeDuplicateContacts,
  rewriteCustomerIdsInRecords,
} from '@/lib/crm/inbox/duplicate-contacts'

beforeEach(() => {
  clients.clear()
  people.length = 0
  updateManyCalls.length = 0
  vi.clearAllMocks()
  clients.set('keep', {
    id: 'keep',
    name: 'Acme Ltd',
    email: 'info@acme.co.ke',
    phone: null,
    phoneAlt: null,
    companyName: 'Acme',
    isActive: true,
    creditBalance: 100,
    loyaltyPoints: 0,
    notes: '',
  })
  clients.set('dup', {
    id: 'dup',
    name: 'Need 10 laptops RFQ',
    email: 'info@acme.co.ke',
    phone: '0712345678',
    phoneAlt: null,
    companyName: null,
    isActive: true,
    creditBalance: 40,
    loyaltyPoints: 3,
    notes: 'from convert',
  })
  people.push(
    { id: 'p-keep', clientId: 'keep', email: 'info@acme.co.ke', phone: null },
    { id: 'p-dup', clientId: 'dup', email: 'info@acme.co.ke', phone: '0712345678' },
    { id: 'p-new', clientId: 'dup', email: 'buyer@acme.co.ke', phone: null },
  )
})

describe('rewriteCustomerIdsInRecords', () => {
  it('rewrites customer and partner ids on blob rows', () => {
    const next = rewriteCustomerIdsInRecords([
      { id: 'inv-1', partnerId: 'dup', customerId: 'dup' },
      { id: 'inv-2', partnerId: 'other' },
    ], 'dup', 'keep') as Array<Record<string, string>>
    expect(next[0].partnerId).toBe('keep')
    expect(next[0].customerId).toBe('keep')
    expect(next[1].partnerId).toBe('other')
  })
})

describe('mergeDuplicateContacts', () => {
  it('moves invoices, credit, and extra people onto the kept customer', async () => {
    const result = await mergeDuplicateContacts({ keepId: 'keep', mergeId: 'dup' })
    expect(result).toEqual({ ok: true, keepId: 'keep', mergedId: 'dup' })
    expect(clients.get('keep').phone).toBe('0712345678')
    expect(clients.get('keep').creditBalance).toBe(140)
    expect(clients.get('keep').loyaltyPoints).toBe(3)
    expect(clients.get('dup').isActive).toBe(false)
    expect(clients.get('dup').creditBalance).toBe(0)
    expect(updateManyCalls.some(call => call.model === 'invoice' && call.data.clientId === 'keep')).toBe(true)
    expect(updateManyCalls.some(call => call.model === 'saleOrder' && call.data.clientId === 'keep')).toBe(true)
    expect(people.find(p => p.id === 'p-dup')).toBeUndefined()
    expect(people.find(p => p.id === 'p-new')?.clientId).toBe('keep')
    expect(saveStoreKeys).toHaveBeenCalled()
  })

  it('refuses to merge a contact into itself', async () => {
    await expect(mergeDuplicateContacts({ keepId: 'keep', mergeId: 'keep' }))
      .resolves.toEqual({ ok: false, error: 'Same contact' })
  })
})
