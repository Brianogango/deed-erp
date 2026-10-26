import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma, state } = vi.hoisted(() => ({
  mockPrisma: { invoice: { findMany: vi.fn() }, user: { findMany: vi.fn() }, $queryRawUnsafe: vi.fn() },
  state: { fp: 'a|b|c|d|users|clients', sigs: [] as Array<{ id: string; sig: string }> },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { loadScreenInvoices, clearInvoiceRowCache } from '@/lib/invoice-read-model.server'
import { clearReadModelCache } from '@/lib/read-model-cache'

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, invoiceNumber: `INV/${id}`, documentType: 'customer_invoice', clientId: 'c-1', status: 'approved',
  client: { name: 'Acme' }, items: [], payments: [], paymentAllocations: [],
  invoiceDate: new Date('2026-09-20'), dueDate: new Date('2026-10-20'),
  subtotal: 1000, taxAmount: 0, totalAmount: 1000, amountPaid: 0, discountAmount: 0,
  internalNotes: null, postedById: null, lockVersion: 0, exchangeRateToBase: 1,
  ...over,
})

let db: Record<string, ReturnType<typeof row>> = {}

beforeEach(() => {
  vi.clearAllMocks()
  clearReadModelCache()
  clearInvoiceRowCache()
  db = { a: row('a'), b: row('b') }
  state.fp = 'a|b|c|d|users|clients'
  state.sigs = [{ id: 'a', sig: 'a1' }, { id: 'b', sig: 'b1' }]
  mockPrisma.user.findMany.mockResolvedValue([])
  mockPrisma.$queryRawUnsafe.mockImplementation(async (sql: string) =>
    sql.includes('AS fp') ? [{ fp: state.fp }] : state.sigs)
  mockPrisma.invoice.findMany.mockImplementation(async (args: any) => {
    const ids: string[] | undefined = args?.where?.id?.in
    return Object.values(db).filter(r => !ids || ids.includes(r.id))
  })
})

describe('invoice list: only changed documents are re-read', () => {
  it('re-reads just the document whose signature changed', async () => {
    await loadScreenInvoices([])
    expect(mockPrisma.invoice.findMany).toHaveBeenLastCalledWith(expect.not.objectContaining({ where: expect.anything() }))

    db.b = row('b', { amountPaid: 1000 })
    state.fp = 'a2|b|c2|d2|users|clients'
    state.sigs = [{ id: 'a', sig: 'a1' }, { id: 'b', sig: 'b2' }]
    const list = await loadScreenInvoices([])

    expect(mockPrisma.invoice.findMany.mock.calls.at(-1)?.[0].where).toEqual({ id: { in: ['b'] } })
    expect(list.map(r => [r.id, r.amountPaid])).toEqual([['a', 0], ['b', 1000]])
  })

  it('drops a deleted document and adds a new one in list order', async () => {
    await loadScreenInvoices([])
    delete db.a
    db.c = row('c')
    state.fp = 'x|b|c|d|users|clients'
    state.sigs = [{ id: 'c', sig: 'c1' }, { id: 'b', sig: 'b1' }]
    const list = await loadScreenInvoices([])
    expect(list.map(r => r.id)).toEqual(['c', 'b'])
    expect(mockPrisma.invoice.findMany.mock.calls.at(-1)?.[0].where).toEqual({ id: { in: ['c'] } })
  })

  it('re-reads everything when user or client names change', async () => {
    await loadScreenInvoices([])
    db.a = row('a', { client: { name: 'Renamed' } })
    state.fp = 'a|b|c|d|users|clients2'
    const list = await loadScreenInvoices([])
    expect(mockPrisma.invoice.findMany.mock.calls.at(-1)?.[0].where).toBeUndefined()
    expect(list[0].partnerName).toBe('Renamed')
  })

  it('never serves the old form of a changed document that disappeared before it was read', async () => {
    await loadScreenInvoices([])
    delete db.b
    state.fp = 'z|b|c|d|users|clients'
    state.sigs = [{ id: 'a', sig: 'a1' }, { id: 'b', sig: 'b9' }]
    const list = await loadScreenInvoices([])
    expect(list.map(r => r.id)).toEqual(['a'])
  })

  it('falls back to a full read when signatures cannot be read', async () => {
    await loadScreenInvoices([])
    mockPrisma.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes('AS fp')) return [{ fp: 'q|b|c|d|users|clients' }]
      throw new Error('boom')
    })
    const list = await loadScreenInvoices([])
    expect(list.map(r => r.id)).toEqual(['a', 'b'])
    expect(mockPrisma.invoice.findMany.mock.calls.at(-1)?.[0].where).toBeUndefined()
  })
})
