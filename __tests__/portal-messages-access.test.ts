import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  session: null as any,
  settings: {} as any,
  added: [] as any[],
}))

vi.mock('@/lib/portal/portal-guard.server', () => ({
  cleanPortalText: (v: unknown) => String(v ?? '').trim(),
  clientIp: () => '127.0.0.1',
  guardPortalRoute: (_k: string, _n: number, handler: any) => handler,
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, resetAt: Date.now() + 1000 }) }))
vi.mock('@/lib/auth/server', () => ({ getServerSession: async () => h.session }))
vi.mock('@/lib/server-store', () => ({ loadAppState: async () => ({ deed_systemSettings: h.settings }) }))
vi.mock('@/lib/portal-repair-server', () => ({
  lookupRepair: async (ref: string) => (ref === 'REP/0001' ? { ref, customerPhone: '0712 345 678' } : null),
}))
vi.mock('@/lib/portal-repair-messages', () => ({
  MAX_MESSAGE_LENGTH: 1000,
  addMessageStored: async (_ref: string, m: any) => { h.added.push(m); return { id: 'm1', ...m } },
  getMessagesStored: async () => [{ id: 'm0', sender: 'staff', senderName: 'Shop', text: 'Hello', timestamp: '2026-10-01T00:00:00Z', read: false }],
  markMessagesReadStored: vi.fn(async () => undefined),
}))

import { GET, POST } from '@/app/api/portal/repair/[ref]/messages/route'

const ctx = { params: Promise.resolve({ ref: encodeURIComponent('REP/0001') }) }
const get = (qs = '') => GET(new NextRequest(`http://x/api/portal/repair/REP%2F0001/messages${qs}`), ctx)
const post = (body: unknown) => POST(new NextRequest('http://x/api/portal/repair/REP%2F0001/messages', { method: 'POST', body: JSON.stringify(body) }), ctx)

beforeEach(() => { h.session = null; h.settings = {}; h.added.length = 0 })

describe('portal repair messages need more than the reference', () => {
  it('will not show the thread without the phone number', async () => {
    expect((await get('?by=customer')).status).toBe(403)
    expect((await get('?by=customer&phone=0799999999')).status).toBe(403)
  })

  it('shows it with the phone number on the repair', async () => {
    const res = await get('?by=customer&phone=0712345678')
    expect(res.status).toBe(200)
    expect((await res.json()).messages).toHaveLength(1)
  })

  it('shows it to signed-in staff without a phone', async () => {
    h.session = { user: { id: 'u1', role: 'technician', name: 'Tech' } }
    expect((await get('?by=staff')).status).toBe(200)
  })

  it('will not take a customer message without the phone number', async () => {
    expect((await post({ sender: 'customer', text: 'hi' })).status).toBe(403)
    expect(h.added).toHaveLength(0)
  })

  it('takes a customer message with the phone number', async () => {
    const res = await post({ sender: 'customer', text: 'hi', verifyPhone: '+254 712 345 678' })
    expect(res.status).toBe(201)
    expect(h.added[0]).toMatchObject({ sender: 'customer', text: 'hi' })
  })

  it('still lets an admin turn the phone check off', async () => {
    h.settings = { secPortalRequirePhoneVerification: false }
    expect((await get('?by=customer')).status).toBe(200)
  })
})
