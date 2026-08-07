import { describe, expect, it } from 'vitest'
import { generateQuoteEmail } from '@/lib/integrations/email'

const baseQuote = {
  ref: 'QUO/2026/0071',
  companyName: 'MIRRIAM NDUNGU',
  contactPersonName: 'MIRRIAM NDUNGU',
  total: 28000,
  validUntil: '2026-08-11',
  lines: [{ productName: 'Screen full assembly replacement', qty: 1, lineTotal: 28000 }],
}

describe('generateQuoteEmail', () => {
  it('uses Sales signature without phone or accept CTA', () => {
    const email = generateQuoteEmail({ ...baseQuote, kind: 'initial', pdfAttached: true })

    expect(email.subject).toContain('Quote QUO/2026/0071')
    expect(email.html).toContain('attached')
    expect(email.html).toContain('Best regards')
    expect(email.html).toContain('<strong>Sales</strong>')
    expect(email.html).not.toContain('Thank you for your interest')
    expect(email.html).not.toContain('To accept this quote')
    expect(email.html).not.toContain('If you have any questions')
    expect(email.html).not.toContain('+254')
    expect(email.html).not.toContain('account manager')
    expect(email.text).toContain('Best regards')
    expect(email.text).toContain('Sales')
    expect(email.text).not.toContain('+254')
  })

  it('labels revised quotations as updates', () => {
    const email = generateQuoteEmail({ ...baseQuote, kind: 'update', pdfAttached: true })

    expect(email.subject).toMatch(/^Updated Quote/)
    expect(email.html).toContain('Updated')
    expect(email.html).toContain('updated quotation')
    expect(email.html).toContain('<strong>Sales</strong>')
    expect(email.html).not.toContain('Thank you for your interest')
  })

  it('keeps personal message and still closes from Sales', () => {
    const email = generateQuoteEmail({
      ...baseQuote,
      kind: 'initial',
      message: 'Once we receive your approval, we will proceed.\n\nKind regards,\nSales Department',
      pdfAttached: true,
    })

    expect(email.html).toContain('Once we receive your approval')
    expect(email.html).not.toContain('Thank you for your interest')
    expect(email.html).toContain('<strong>Sales</strong>')
    expect(email.html).toContain('attached')
  })

  it('renders Download PDF button when a url is provided', () => {
    const email = generateQuoteEmail({
      ...baseQuote,
      kind: 'initial',
      pdfAttached: true,
      pdfDownloadUrl: 'https://erp.deed.co.ke/quote.pdf',
    })

    expect(email.html).toContain('Download PDF')
    expect(email.html).toContain('https://erp.deed.co.ke/quote.pdf')
    expect(email.text).toContain('Download PDF: https://erp.deed.co.ke/quote.pdf')
  })

  it('renders a View & Respond Online button when a portal link is provided', () => {
    const email = generateQuoteEmail({
      ...baseQuote,
      kind: 'initial',
      pdfAttached: true,
      portalLink: 'https://erp.deed.co.ke/portal/quotes/so-1?token=abc',
    })

    expect(email.html).toContain('View &amp; Respond Online')
    expect(email.html).toContain('https://erp.deed.co.ke/portal/quotes/so-1?token=abc')
    expect(email.text).toContain('View & respond online: https://erp.deed.co.ke/portal/quotes/so-1?token=abc')
  })

  it('omits the portal button entirely when no link is provided (Online Acceptance off)', () => {
    const email = generateQuoteEmail({ ...baseQuote, kind: 'initial', pdfAttached: true })
    expect(email.html).not.toContain('Respond Online')
  })
})
