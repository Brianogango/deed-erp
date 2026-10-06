import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  posted: [] as string[],
  liveJournalFor: new Set<string>(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1', role: 'director' } })) }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn(async () => h.state),
  saveStoreKeys: vi.fn(async (entries: Record<string, string>) => { for (const [k, v] of Object.entries(entries)) h.state[k] = JSON.parse(v) }),
}))
vi.mock('@/lib/accounting/invoice-journals', () => ({ postInvoiceJournalToPrisma: vi.fn(async (inv: any) => { h.posted.push(inv.id) }) }))
vi.mock('@/lib/prisma', () => ({
  default: { journalEntry: { findFirst: vi.fn(async ({ where }: any) => (h.liveJournalFor.has(where.invoiceId) ? { id: 'j' } : null)) } },
}))

import { POST } from '@/app/api/import/route'

const req = (body: unknown) => new NextRequest('http://x/api/import', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  h.posted = []
  h.liveJournalFor = new Set(['inv-paid'])
  h.state = {
    deed_invoices: [{ id: 'inv-paid', ref: 'INV/2026/0131', status: 'posted', total: 27000, amountPaid: 27000, payments: [{ id: 'p1', amount: 27000 }] }],
  }
})

describe('POST /api/import — invoices', () => {
  it('re-importing an older copy keeps the payments and posts no second sales entry', async () => {
    const res = await POST(req({ deed_invoices: [{ id: 'inv-paid', ref: 'INV/2026/0131', status: 'posted', total: 27000, amountPaid: 0, payments: [] }] }))
    expect(res.status).toBe(200)
    const [inv] = h.state.deed_invoices as any[]
    expect(inv.amountPaid).toBe(27000)
    expect(inv.payments).toHaveLength(1)
    expect(h.posted).toEqual([])
  })

  it('a new posted invoice still gets its sales entry', async () => {
    await POST(req({ deed_invoices: [{ id: 'inv-new', ref: 'INV/2026/0400', status: 'posted', total: 1000, amountPaid: 0 }] }))
    expect(h.posted).toEqual(['inv-new'])
  })
})
