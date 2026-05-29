import { NextRequest, NextResponse } from 'next/server'
import { verifyQuoteToken } from '@/lib/quote-token'
import { loadAppState } from '@/lib/server-store'
import { DEFAULT_COMPANY_SETTINGS } from '@/lib/store'

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

    const state  = await loadAppState()
    const quotes = (state['deed_quotes'] ?? []) as Array<Record<string, unknown>>
    const quote  = quotes.find(q => q.id === quoteId)

    if (!quote) {
      return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
    }

    const saved    = state['deed_companySettings'] as Record<string, unknown> | undefined
    const co       = { ...DEFAULT_COMPANY_SETTINGS, ...(saved ?? {}) }
    const lines    = (quote.lines ?? []) as Array<Record<string, unknown>>
    const ref      = String(quote.ref ?? quoteId)
    const issueDate = String(quote.issueDate ?? '')
    const validUntil = String(quote.validUntil ?? '')
    const subtotal  = Number(quote.subtotal ?? 0)
    const taxTotal  = Number(quote.taxTotal ?? 0)
    const total     = Number(quote.total ?? subtotal + taxTotal)

    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const W = 595, margin = 40

    // ── Header bar ──────────────────────────────────────────────────────────
    doc.setFillColor(27, 39, 98)
    doc.rect(0, 0, W, 56, 'F')
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(255, 255, 255)
    doc.text(co.name, margin, 36)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text(`${co.address}  ·  Tel: ${co.phone}  ·  ${co.email}`, margin, 48)

    // ── Quote label ─────────────────────────────────────────────────────────
    doc.setTextColor(27, 39, 98)
    doc.setFontSize(22)
    doc.setFont('helvetica', 'bold')
    doc.text('QUOTATION', W - margin, 36, { align: 'right' })
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80, 80, 80)
    doc.text(ref, W - margin, 50, { align: 'right' })

    // ── Quote meta ───────────────────────────────────────────────────────────
    let y = 80
    doc.setFontSize(9)
    doc.setTextColor(80, 80, 80)
    doc.text(`Date: ${issueDate}`, margin, y)
    if (validUntil) doc.text(`Valid Until: ${validUntil}`, margin + 130, y)

    // ── Bill To ─────────────────────────────────────────────────────────────
    y += 22
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(27, 39, 98)
    doc.text('BILL TO', margin, y)
    y += 12
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 30, 30)
    doc.setFontSize(11)
    doc.text(String(quote.companyName ?? '—'), margin, y)
    if (quote.contactPersonName) {
      y += 14
      doc.setFontSize(9)
      doc.setTextColor(80, 80, 80)
      doc.text(`Attn: ${quote.contactPersonName}`, margin, y)
    }

    // ── Table header ─────────────────────────────────────────────────────────
    y += 26
    doc.setFillColor(243, 244, 246)
    doc.rect(margin, y - 10, W - margin * 2, 18, 'F')
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(80, 80, 80)
    const colX = { desc: margin + 4, qty: 320, price: 380, total: 490 }
    doc.text('#', margin + 2, y)
    doc.text('Description', colX.desc + 16, y)
    doc.text('Qty', colX.qty, y)
    doc.text('Unit Price', colX.price, y)
    doc.text('Total', colX.total, y)

    // ── Table rows ────────────────────────────────────────────────────────────
    y += 12
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 30, 30)
    lines.forEach((line, idx) => {
      if (y > 740) {
        doc.addPage()
        y = margin + 20
      }
      doc.setFontSize(8)
      doc.text(String(idx + 1), margin + 2, y)
      const name = String(line.productName ?? line.description ?? '')
      doc.text(doc.splitTextToSize(name, 250)[0], colX.desc + 16, y)
      doc.text(String(line.qty ?? ''), colX.qty, y)
      doc.text(`KES ${Number(line.unitPrice ?? 0).toLocaleString()}`, colX.price, y)
      doc.text(`KES ${Number(line.lineTotal ?? 0).toLocaleString()}`, colX.total, y)
      y += 14
      if (line.specs) {
        doc.setFontSize(7)
        doc.setTextColor(120, 120, 120)
        doc.text(doc.splitTextToSize(String(line.specs), 250)[0], colX.desc + 16, y)
        doc.setTextColor(30, 30, 30)
        y += 10
      }
    })

    // ── Totals ────────────────────────────────────────────────────────────────
    y += 8
    doc.setDrawColor(200, 200, 200)
    doc.line(colX.price - 10, y, W - margin, y)
    y += 12
    doc.setFontSize(9)
    doc.setTextColor(80, 80, 80)
    doc.text('Subtotal:', colX.price - 10, y)
    doc.text(`KES ${subtotal.toLocaleString()}`, colX.total, y)
    if (taxTotal > 0) {
      y += 14
      doc.text('VAT (16%):', colX.price - 10, y)
      doc.text(`KES ${taxTotal.toLocaleString()}`, colX.total, y)
    }
    y += 14
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(27, 39, 98)
    doc.text('TOTAL:', colX.price - 10, y)
    doc.text(`KES ${total.toLocaleString()}`, colX.total, y)

    // ── Terms / Notes ──────────────────────────────────────────────────────
    if (quote.paymentTerms || quote.notes) {
      y += 28
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(80, 80, 80)
      if (quote.paymentTerms) {
        doc.setFont('helvetica', 'bold')
        doc.text('Payment Terms:', margin, y)
        doc.setFont('helvetica', 'normal')
        doc.text(String(quote.paymentTerms), margin + 85, y)
        y += 12
      }
      if (quote.notes) {
        doc.setFont('helvetica', 'bold')
        doc.text('Notes:', margin, y)
        doc.setFont('helvetica', 'normal')
        doc.text(doc.splitTextToSize(String(quote.notes), W - margin * 2 - 40)[0], margin + 40, y)
      }
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = 820
    doc.setFontSize(7)
    doc.setTextColor(160, 160, 160)
    doc.text(co.invoiceFooter ?? 'Thank you for your business.', W / 2, footerY, { align: 'center' })

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'))
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${ref}.pdf"`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
  }
}
