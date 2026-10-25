import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ saved: [] as any[] }))

vi.mock('@/lib/portal/portal-guard.server', () => ({
  cleanPortalText: (v: unknown) => String(v ?? '').trim(),
  clientIp: () => '127.0.0.1',
  guardPortalRoute: (_k: string, _n: number, handler: any) => handler,
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, resetAt: Date.now() + 1000 }) }))
vi.mock('@/lib/portal-repair-server', () => ({
  lookupRepair: async (ref: string) => ({ ref, customerPhone: '0712345678' }),
}))
vi.mock('@/lib/server-store', () => ({
  loadAppState: async () => ({ deed_systemSettings: {}, deed_repairs_v2: [], deed_invoices: [] }),
  loadAppStateForWrite: async () => ({ deed_repairs_v2: [] }),
  withAppStateKeyLock: (_k: string, fn: () => Promise<unknown>) => fn(),
  saveStoreKeys: async (entries: any) => { h.saved.push(entries) },
}))

import { POST } from '@/app/api/portal/repair/[ref]/payment-confirmation/route'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const send = (phone: string) => {
  const form = new FormData()
  form.set('confirmationText', 'QWE1234567 Confirmed. Ksh 1,000 paid')
  form.set('verifyPhone', phone)
  form.set('screenshot', new File([PNG], 'proof.png', { type: 'image/png' }))
  return POST(new NextRequest('http://x/api/portal/repair/REP%2F0001/payment-confirmation', { method: 'POST', body: form }), { params: Promise.resolve({ ref: encodeURIComponent('REP/0001') }) })
}

beforeEach(() => { h.saved.length = 0 })

describe('portal payment confirmation', () => {
  it('saves nothing — not even the proof image — when the phone is wrong', async () => {
    const res = await send('0799999999')
    expect(res.status).toBe(403)
    expect(h.saved).toHaveLength(0)
  })
})
