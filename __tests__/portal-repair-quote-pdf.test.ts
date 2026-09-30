import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { repairQuoteDocument } from '@/lib/portal/repair-quote-document'

const { mockLoadAppState, mockSession, mockBuild } = vi.hoisted(() => ({
  mockLoadAppState: vi.fn(),
  mockSession: vi.fn(),
  mockBuild: vi.fn(),
}))

vi.mock('@/lib/server-store', () => ({ loadAppState: mockLoadAppState }))
vi.mock('@/lib/auth/server', () => ({ getServerSession: mockSession }))
vi.mock('@/lib/pdf-logo.server', () => ({ loadLogoForPdfServer: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/deed-document-pdf', () => ({
  buildDeedDocumentPdf: mockBuild,
  deedPdfToBuffer: () => new Uint8Array([37, 80, 68, 70]),
}))
vi.mock('@/lib/store', () => ({ DEFAULT_COMPANY_SETTINGS: { name: 'Deed' }, DEFAULT_BANK_ACCOUNTS: [] }))

import { GET } from '@/app/api/portal/repair/[ref]/quote-pdf/route'

const repair = {
  ref: 'REP/2026/0101',
  customerName: 'Jane',
  customerPhone: '0712345678',
  productName: 'Dell Latitude 5400',
  quote: {
    lines: [
      { description: 'Screen replacement', qty: 1, unitPrice: 9000, subtotal: 9000, decision: 'approved' },
      { description: 'Keyboard', qty: 1, unitPrice: 3000, subtotal: 3000, decision: 'declined' },
    ],
    subtotal: 12000, tax: 1920, total: 13920, approvedTotal: 10440,
    sentDate: '2026-09-28T10:00:00Z', validUntil: '2026-10-05', approvedDate: '2026-09-29T09:00:00Z',
  },
}

describe('the quote document', () => {
  it('carries the lines, VAT and totals the client sees', () => {
    const doc = repairQuoteDocument(repair, '2026-09-30')!
    expect(doc).toMatchObject({ title: 'Quotation', subtotal: 12000, taxTotal: 1920, total: 13920, dueDate: '2026-10-05' })
    expect(doc.lines[0]).toMatchObject({ description: 'Screen replacement', taxRate: 16, subtotal: 9000 })
    expect(doc.lines[1].description).toBe('Keyboard (declined)')
    expect(doc.notes).toContain('Approved on 2026-09-29')
  })

  it('is not offered before there is a quote', () => {
    expect(repairQuoteDocument({ ref: 'REP/1', quote: null }, '2026-09-30')).toBeNull()
    expect(repairQuoteDocument({ ref: 'REP/1', quote: { lines: [] } }, '2026-09-30')).toBeNull()
  })
})

describe('downloading it from the portal', () => {
  const get = (phone: string) => GET(
    new NextRequest(`http://localhost/api/portal/repair/REP%2F2026%2F0101/quote-pdf?phone=${phone}`),
    { params: Promise.resolve({ ref: encodeURIComponent('REP/2026/0101') }) },
  )

  beforeEach(() => {
    vi.clearAllMocks()
    mockSession.mockResolvedValue(null)
    mockLoadAppState.mockResolvedValue({ deed_repairs_v2: [repair], deed_systemSettings: {} })
    mockBuild.mockReturnValue({})
  })

  it('gives the client the PDF when the phone matches', async () => {
    const res = await get('0712345678')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('Quote-')
  })

  it('refuses without the registered phone number', async () => {
    const res = await get('0799999999')
    expect(res.status).toBe(403)
    expect(mockBuild).not.toHaveBeenCalled()
  })
})
