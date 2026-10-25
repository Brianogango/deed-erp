import { describe, it, expect, vi, beforeEach } from 'vitest'

// send-quote signs a portal acceptance link for quoteId and mails from the
// sales mailbox: the document must exist and its content comes from the
// server copy. Real lib/auth/api role checks run.
const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  loadAppState: vi.fn(),
  sendEmail: vi.fn(),
  generateQuoteEmail: vi.fn(),
  pdf: vi.fn(),
  appendSend: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/server', () => ({ getServerSession: m.getServerSession }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/server-store', () => ({ loadAppState: m.loadAppState, saveStoreKeys: vi.fn() }))
vi.mock('@/lib/integrations/email', () => ({
  sendEmail: m.sendEmail, generateQuoteEmail: m.generateQuoteEmail, logEmailForDev: vi.fn(),
  generateRfqEmail: vi.fn(() => ({ subject: 'RFQ', html: '', text: '' })),
}))
vi.mock('@/lib/integrations/whatsapp', () => ({ sendQuoteViaWhatsApp: vi.fn(), logWhatsAppForDev: vi.fn() }))
vi.mock('@/lib/integrations/quote-pdf', () => ({ generateQuotePdfBuffer: m.pdf }))
vi.mock('@/lib/integrations/document-pdf.server', () => ({ rfqAttachment: vi.fn(async () => null) }))
vi.mock('@/lib/document-email-sends', () => ({ appendDocumentEmailSend: m.appendSend, parseEmailList: (v: unknown) => (Array.isArray(v) ? v : v ? [String(v)] : []) }))
vi.mock('@/lib/quote-token', () => ({ generateQuoteToken: () => 'tok' }))

import { POST as sendQuote } from '@/app/api/integrations/send-quote/route'
import { POST as sendRfq } from '@/app/api/integrations/send-rfq/route'

const session = (role: string) => ({ user: { id: 'u1', name: 'U', username: 'u', role, modules: ['sales', 'purchase'] } })
const req = (url: string, body: unknown) => new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
const stored = {
  id: 'so-1', ref: 'S00042', customerName: 'Acme Ltd', status: 'quotation', total: 1160, subtotal: 1000, taxTotal: 160,
  lines: [{ productName: 'Laptop', qty: 1, unitPrice: 1000, subtotal: 1000, lineTotal: 1160 }, { lineType: 'section', productName: 'Header' }],
}
const forged = {
  quoteId: 'so-1', channels: ['email'],
  quote: { ref: 'URGENT', companyName: 'Bank', contactEmail: 'customer@example.com', total: 1, validUntil: '2026-12-01', ownerName: 'X', lines: [{ productName: 'Pay here', qty: 1, lineTotal: 1 }] },
}

describe('POST /api/integrations/send-quote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'production')
    m.loadAppState.mockImplementation(async (keys: string[]) => keys.includes('deed_saleOrders') ? { deed_quotes: [], deed_saleOrders: [stored] } : {})
    m.sendEmail.mockResolvedValue({ success: true, messageId: 'mid' })
    m.generateQuoteEmail.mockReturnValue({ subject: 'Quote', html: '', text: '' })
    m.pdf.mockResolvedValue(Buffer.from('pdf'))
    m.appendSend.mockResolvedValue({ id: 'send-1' })
  })

  it('refuses roles that cannot send quotations', async () => {
    m.getServerSession.mockResolvedValue(session('inventory_officer'))
    const res = await sendQuote(req('http://x/api/integrations/send-quote', forged))
    expect(res.status).toBe(403)
    expect(m.sendEmail).not.toHaveBeenCalled()
  })

  it('refuses an id that is not a saved quotation (no link is signed for it)', async () => {
    m.getServerSession.mockResolvedValue(session('sales_rep'))
    const res = await sendQuote(req('http://x/api/integrations/send-quote', { ...forged, quoteId: 'someone-elses-id' }))
    expect(res.status).toBe(404)
    expect(m.sendEmail).not.toHaveBeenCalled()
  })

  it('sends the stored quotation, not the text in the request', async () => {
    m.getServerSession.mockResolvedValue(session('sales_rep'))
    const res = await sendQuote(req('http://x/api/integrations/send-quote', forged))
    expect(res.status).toBe(200)
    const pdfInput = m.pdf.mock.calls[0][0]
    expect(pdfInput).toMatchObject({ ref: 'S00042', companyName: 'Acme Ltd', total: 1160 })
    expect(pdfInput.lines).toEqual([{ productName: 'Laptop', qty: 1, unitPrice: 1000, lineTotal: 1160 }])
    expect(m.generateQuoteEmail.mock.calls[0][0]).toMatchObject({ ref: 'S00042', total: 1160 })
    expect(m.sendEmail.mock.calls[0][0].to).toBe('customer@example.com')
  })
})

describe('POST /api/integrations/send-rfq', () => {
  const rfq = { to: 'vendor@example.com', rfq: { ref: 'P00001', vendorName: 'V', lines: [{ productName: 'A', qty: 1, unitPrice: 1, subtotal: 1 }], subtotal: 1, taxTotal: 0, total: 1 } }
  beforeEach(() => { vi.clearAllMocks(); m.sendEmail.mockResolvedValue({ success: true, messageId: 'mid' }); m.appendSend.mockResolvedValue({}) })

  it('refuses roles outside purchasing', async () => {
    for (const role of ['sales_rep', 'technician']) {
      m.getServerSession.mockResolvedValue(session(role))
      expect((await sendRfq(req('http://x/api/integrations/send-rfq', rfq))).status).toBe(403)
    }
    expect(m.sendEmail).not.toHaveBeenCalled()
  })

  it('inventory officers can send', async () => {
    m.getServerSession.mockResolvedValue(session('inventory_officer'))
    expect((await sendRfq(req('http://x/api/integrations/send-rfq', rfq))).status).toBe(200)
  })
})
