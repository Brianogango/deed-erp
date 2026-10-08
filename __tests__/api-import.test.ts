import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  saved: [] as string[],
  upserted: [] as string[],
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1', role: 'director' } })) }))
vi.mock('@/lib/server-store', () => ({
  FROZEN_STORE_KEYS: new Set(['deed_invoices', 'deed_saleOrders', 'deed_contacts']),
  loadAppState: vi.fn(async () => h.state),
  saveStoreKeys: vi.fn(async (entries: Record<string, string>) => { h.saved.push(...Object.keys(entries)) }),
}))
vi.mock('@/lib/contact-prisma', () => ({
  upsertContact: vi.fn(async (_p: unknown, c: { name: string }) => {
    h.upserted.push(c.name)
    return { contact: { id: c.name }, created: c.name !== 'Existing' }
  }),
}))
vi.mock('@/lib/prisma', () => ({ default: {} }))

import { POST } from '@/app/api/import/route'

const req = (body: unknown) => new NextRequest('http://x/api/import', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  h.state = {}
  h.saved = []
  h.upserted = []
})

describe('POST /api/import', () => {
  it('saves contacts to the clients table, not the frozen screen copy', async () => {
    const res = await POST(req({ deed_contacts: [{ name: 'New Ltd' }, { name: 'Existing' }] }))
    expect(res.status).toBe(200)
    expect(h.upserted).toEqual(['New Ltd', 'Existing'])
    expect(h.saved).toEqual([])
    expect((await res.json()).summary.deed_contacts).toEqual({ imported: 1, skipped: 1, total: 2 })
  })

  it('refuses keys whose screen copy is frozen', async () => {
    const res = await POST(req({ deed_invoices: [{ id: 'inv-1' }] }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/deed_invoices/)
    expect(h.saved).toEqual([])
  })

  it('still imports other keys', async () => {
    const res = await POST(req({ deed_warranties: [{ id: 'w-1' }], deed_saleOrders: [{ id: 'so-1' }] }))
    expect(res.status).toBe(200)
    expect(h.saved).toEqual(['deed_warranties'])
    expect((await res.json()).refused).toEqual(['deed_saleOrders'])
  })
})
