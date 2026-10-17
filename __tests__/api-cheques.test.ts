import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as any[],
  requireRole: vi.fn(),
  put: vi.fn(async () => ({})),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try { return await handler() } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status, headers: { 'Content-Type': 'application/json' } })
    }
  },
  requireRole: h.requireRole,
}))
vi.mock('@/lib/infra/object-store', () => ({ putObject: h.put, getObject: vi.fn(async () => null) }))
vi.mock('@/lib/prisma', () => ({
  default: {
    cheque: {
      findMany: vi.fn(async () => h.rows),
      findFirst: vi.fn(async ({ where }: any) => h.rows.find(r =>
        r.direction === where.direction && r.chequeNumber === where.chequeNumber && r.status !== 'cancelled') ?? null),
      findUnique: vi.fn(async ({ where }: any) => h.rows.find(r => r.id === where.id) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { ...data, currency: 'KES', createdAt: new Date(), updatedAt: new Date(), status: 'pending', imageType: data.imageType ?? null }
        h.rows.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = h.rows.find(r => r.id === where.id)
        Object.assign(row, data, { updatedAt: new Date() })
        return row
      }),
    },
  },
}))

import { GET, POST } from '@/app/api/cheques/route'
import { PATCH } from '@/app/api/cheques/[id]/route'

const user = { id: 'u-1', name: 'Fin Officer', username: 'fin', role: 'finance_officer' }
const post = (body: unknown) => POST(new Request('http://x/api/cheques', { method: 'POST', body: JSON.stringify(body) }))
const patch = (id: string, body: unknown) => PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })
const valid = { direction: 'received', chequeNumber: '000123', bankName: 'Equity Bank', partyName: 'Farm To Feed Kenya', amount: 249400, chequeDate: '2026-10-20' }

beforeEach(() => {
  h.rows.length = 0
  h.requireRole.mockReset()
  h.requireRole.mockResolvedValue(user)
  h.put.mockClear()
})

describe('cheque register API', () => {
  it('only lets director, admin officer and finance officer in', async () => {
    h.requireRole.mockRejectedValueOnce(Object.assign(new Error('Forbidden — insufficient role'), { status: 403 }))
    expect((await GET()).status).toBe(403)
    expect(h.requireRole).toHaveBeenCalledWith(['director', 'admin_officer', 'finance_officer'])
  })

  it('adds a cheque and records who received it', async () => {
    const res = await post(valid)
    expect(res.status).toBe(201)
    const { cheque } = await res.json()
    expect(cheque.status).toBe('pending')
    expect(cheque.chequeDate).toBe('2026-10-20')
    expect(cheque.history[0].note).toBe('Cheque received')
    expect(h.rows[0].createdBy).toBe('u-1')
  })

  it('refuses an incomplete cheque with a plain message', async () => {
    const res = await post({ ...valid, amount: 0 })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Enter the cheque amount')
  })

  it('refuses the same cheque twice', async () => {
    await post(valid)
    const res = await post(valid)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('000123')
  })

  it('keeps the photo and rejects one that is not an image', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')
    const ok = await post({ ...valid, chequeNumber: '000200', imageBase64: png, imageType: 'image/png' })
    expect(ok.status).toBe(201)
    expect(h.put).toHaveBeenCalledTimes(1)
    const bad = await post({ ...valid, chequeNumber: '000201', imageBase64: Buffer.from('not an image at all').toString('base64'), imageType: 'image/png' })
    expect(bad.status).toBe(415)
  })

  it('moves a cheque through banking to cleared and logs each step', async () => {
    const { cheque } = await (await post(valid)).json()
    expect((await patch(cheque.id, { status: 'deposited' })).status).toBe(200)
    const cleared = await patch(cheque.id, { status: 'cleared' })
    expect(cleared.status).toBe(200)
    const body = await cleared.json()
    expect(body.cheque.status).toBe('cleared')
    expect(body.cheque.history.map((x: any) => x.status)).toEqual(['pending', 'deposited', 'cleared'])
  })

  it('needs a reason to bounce, and will not reopen a cleared cheque', async () => {
    const { cheque } = await (await post(valid)).json()
    const noReason = await patch(cheque.id, { status: 'bounced' })
    expect(noReason.status).toBe(422)
    expect((await patch(cheque.id, { status: 'bounced', note: 'Insufficient funds' })).status).toBe(200)
    await patch(cheque.id, { status: 'pending' })
    await patch(cheque.id, { status: 'cleared' })
    expect((await patch(cheque.id, { status: 'bounced', note: 'late' })).status).toBe(409)
    expect((await patch(cheque.id, { amount: 1 })).status).toBe(409)
  })
})
