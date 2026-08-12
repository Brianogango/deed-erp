import { NextRequest, NextResponse } from 'next/server'
import { verifyQuoteToken } from '@/lib/quote-token'
import { loadAppState } from '@/lib/server-store'
import { DEFAULT_COMPANY_SETTINGS } from '@/lib/store'
import { normalizeQuoteForClient } from '@/lib/quote-normalization'
import { findPortalDocument } from '@/lib/portal-document-lookup'
import { buildDeedDocumentPdf, deedPdfToBuffer } from '@/lib/deed-document-pdf'
import { loadLogoForPdfServer } from '@/lib/pdf-logo'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/quotes/[id]/pdf?token=<signed-token>
 * Public — generates and streams a PDF of the customer's quote.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const quoteId = params.id
    const token   = request.nextUrl.searchParams.get('token') ?? ''

    if (!verifyQuoteToken(quoteId, token)) {
      return NextResponse.json({ error: 'Invalid or expired link.' }, { status: 401 })
    }

    const found = await findPortalDocument(quoteId)
    if (!found) {
      return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
    }

    const state  = await loadAppState(['deed_companySettings', 'deed_bankAccounts'])
    const normalized = normalizeQuoteForClient(found.doc)
    const saved    = state['deed_companySettings'] as Record<string, unknown> | undefined
    const co       = { ...DEFAULT_COMPANY_SETTINGS, ...(saved ?? {}) }
    const lines    = normalized.lines as Array<Record<string, unknown>>
    const banks    = ((state['deed_bankAccounts'] ?? []) as any[]).filter(a => a.active)
    const logo     = await loadLogoForPdfServer(typeof co.logoUrl === 'string' ? co.logoUrl : null)

    const doc = buildDeedDocumentPdf(
      {
        title: 'Quotation',
        ref: String(normalized.ref ?? ''),
        date: String(normalized.issueDate ?? ''),
        dueLabel: 'Valid Until',
        dueDate: normalized.validUntil ? String(normalized.validUntil) : undefined,
        customerName: String(normalized.companyName ?? '—'),
        customerCountry: 'Kenya',
        attention: normalized.contactPersonName ? String(normalized.contactPersonName) : undefined,
        lines: lines.map(line => ({
          description: String(line.productName ?? line.description ?? ''),
          qty: Number(line.qty ?? 1),
          unitPrice: Number(line.unitPrice ?? 0),
          taxRate: Number(line.taxRate ?? co.vatRate ?? 16),
          subtotal: Number(line.lineTotal ?? line.subtotal ?? 0),
        })),
        subtotal: Number(normalized.subtotal ?? 0),
        taxTotal: Number(normalized.taxTotal ?? 0),
        total: Number(normalized.total ?? 0),
        notes: [normalized.paymentTerms ? `Payment Terms: ${normalized.paymentTerms}` : '', normalized.notes ? String(normalized.notes) : '']
          .filter(Boolean)
          .join('\n') || undefined,
        paymentCommunication: true,
      },
      {
        name: co.name,
        address: co.address,
        city: co.city,
        phone: co.phone,
        email: co.email,
        website: co.website,
        kraPin: co.kraPin,
        currency: co.currency,
        mpesaPaybill: co.mpesaPaybill,
        mpesaAccount: co.mpesaAccount,
        invoiceFooter: co.invoiceFooter,
        logoDataUrl: logo?.dataUrl,
        logoWidth: logo?.width,
        logoHeight: logo?.height,
        logoFormat: logo?.format,
      },
      banks,
    )

    const ref = String(normalized.ref ?? 'quote')
    return new NextResponse(deedPdfToBuffer(doc), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${ref}.pdf"`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
  }
}
