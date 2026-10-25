import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Customer portal files: repair refs are sequential, so photos and reports
// need a staff session or the phone on the repair; the public status
// response never carries the files inline; only raster photos are served;
// and an unverified caller cannot replace the payment proof.
const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  state: {} as Record<string, unknown>,
  saveStoreKeys: vi.fn(),
  lookupRepair: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/server', () => ({ getServerSession: m.getServerSession }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn(async (keys?: string[]) => keys ? Object.fromEntries(keys.filter(k => k in m.state).map(k => [k, m.state[k]])) : m.state),
  loadAppStateForWrite: vi.fn(async () => m.state),
  saveStoreKeys: m.saveStoreKeys,
  withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/portal/portal-guard.server', async orig => ({
  ...(await orig() as object),
  guardPortalRoute: (_b: string, _l: number, h: unknown) => h,
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/portal-repair-server', () => ({ lookupRepair: m.lookupRepair }))

import { GET as photoGet } from '@/app/api/portal/repair/[ref]/photos/[index]/route'
import { GET as qcGet } from '@/app/api/portal/repair/[ref]/qc-report/[id]/route'
import { GET as diagnosisGet } from '@/app/api/portal/repair/[ref]/diagnosis-report/[id]/route'
import { GET as statusGet } from '@/app/api/portal/repair/[ref]/route'
import { POST as confirmPayment } from '@/app/api/portal/repair/[ref]/payment-confirmation/route'

const REF = 'REP/0190'
const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
const html = 'data:text/html;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64')
const repair = {
  id: 'r1', ref: REF, customerPhone: '0712345678', issuePhotos: [{ url: png, name: 'a' }, { url: html, name: 'b' }],
  qcReportData: html, qcReportName: 'qc.html', diagnosisReportData: 'data:application/pdf;base64,JVBERi0=', diagnosisReportName: 'd.pdf',
}
const get = (path: string) => new NextRequest(`http://x/api/portal/repair/${encodeURIComponent(REF)}/${path}`)

beforeEach(() => {
  vi.clearAllMocks()
  m.getServerSession.mockResolvedValue(null)
  m.state = { deed_repairs_v2: [structuredClone(repair)], deed_systemSettings: {} }
  m.lookupRepair.mockResolvedValue(structuredClone(repair))
})

describe('portal repair files', () => {
  it('photos and reports need the phone on the repair', async () => {
    const p = { params: Promise.resolve({ ref: encodeURIComponent(REF), index: '0', id: 'latest' }) }
    expect((await photoGet(get('photos/0'), p)).status).toBe(403)
    expect((await qcGet(get('qc-report/latest'), p)).status).toBe(403)
    expect((await diagnosisGet(get('diagnosis-report/latest'), p)).status).toBe(403)
    expect((await photoGet(get('photos/0?phone=0700000000'), p)).status).toBe(403)

    const ok = await photoGet(get('photos/0?phone=0712345678&original=1'), p)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/png')
    expect(ok.headers.get('cache-control')).toContain('private')
  })

  it('serves only raster photos and never a report as HTML', async () => {
    const p1 = { params: Promise.resolve({ ref: encodeURIComponent(REF), index: '1' }) }
    expect((await photoGet(get('photos/1?phone=0712345678'), p1)).status).toBe(415)
    const qc = await qcGet(get('qc-report/latest?phone=0712345678'), { params: Promise.resolve({ ref: encodeURIComponent(REF), id: 'latest' }) })
    expect(qc.status).toBe(200)
    expect(qc.headers.get('content-type')).toBe('application/octet-stream')
    expect(qc.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('a staff session reads without a phone', async () => {
    m.getServerSession.mockResolvedValue({ user: { id: 'u', role: 'technician' } })
    const p = { params: Promise.resolve({ ref: encodeURIComponent(REF), index: '0' }) }
    expect((await photoGet(get('photos/0'), p)).status).toBe(200)
  })

  it('the public status response carries links, not file contents', async () => {
    const res = await statusGet(get(''), { params: Promise.resolve({ ref: encodeURIComponent(REF) }) })
    const body = await res.json()
    const text = JSON.stringify(body)
    expect(text).not.toContain('base64')
    expect(body.repair.qcReportUrl).toContain('/qc-report/')
    expect(body.repair.diagnosisReportUrl).toContain('/diagnosis-report/')
    expect(body.repair.issuePhotos[1].url).toContain('/photos/1')
  })

  it('an unverified payment confirmation does not overwrite the stored proof', async () => {
    const fd = new FormData()
    fd.append('confirmationText', 'QWE1234567 Confirmed. Ksh100 paid')
    fd.append('verifyPhone', '0700000000')
    fd.append('screenshot', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 's.png', { type: 'image/png' }))
    const req = new NextRequest(`http://x/api/portal/repair/x/payment-confirmation`, { method: 'POST', body: fd })
    const res = await confirmPayment(req, { params: Promise.resolve({ ref: encodeURIComponent(REF) }) })
    expect(res.status).toBe(403)
    expect(m.saveStoreKeys).not.toHaveBeenCalled()
  })
})
