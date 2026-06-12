import { NextRequest, NextResponse } from 'next/server'
import { loadAppState } from '@/lib/server-store'
import { DEFAULT_COMPANY_SETTINGS } from '@/lib/store'
import { CO } from '@/lib/company'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } }
) {
  try {
    const ref = decodeURIComponent(params.ref)
    const state = await loadAppState(['deed_repairs_v2', 'deed_invoices', 'deed_companySettings'])
    const repairs = (state.deed_repairs_v2 ?? []) as any[]
    const invoices = (state.deed_invoices ?? []) as any[]
    const co = { ...DEFAULT_COMPANY_SETTINGS, ...((state.deed_companySettings as Record<string, unknown> | undefined) ?? {}) }

    const repair = repairs.find((r: any) => r.ref?.toLowerCase() === ref.toLowerCase())
    if (!repair) return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })

    const invoiceKey = repair.invoiceId ?? repair.linkedInvoiceId
    const invoice = invoices.find((inv: any) =>
      inv.id === invoiceKey ||
      inv.ref === repair.linkedInvoiceRef ||
      inv.invoiceNumber === repair.linkedInvoiceRef
    )

    const paymentStatus = repair.paymentConfirmationStatus
    const isPaid = paymentStatus === 'auto_paid' || paymentStatus === 'paid' || Number(invoice?.amountPaid ?? 0) > 0
    if (!isPaid) return NextResponse.json({ error: 'Payment has not been confirmed for this repair.' }, { status: 409 })

    const amountPaid = Number(invoice?.amountPaid ?? repair.paymentConfirmationAmount ?? invoice?.total ?? invoice?.totalAmount ?? repair.quote?.approvedTotal ?? repair.quote?.total ?? 0)
    const receiptNo = repair.paymentReceiptNumber ?? invoice?.paymentReference ?? `RCPT-${repair.ref}`.replace(/[^\w-]/g, '-')
    const paidAt = repair.paymentConfirmationSubmittedAt ?? invoice?.paymentDate ?? new Date().toISOString()

    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const W = 595
    const margin = 44
    const esc = (value: unknown) => String(value ?? '').replace(/[^\x20-\x7E]/g, '')
    const fmt = (n: number) => Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const fmtDate = (d: string) => {
      try { return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) }
      catch { return d }
    }

    doc.setFillColor(15, 23, 42)
    doc.rect(0, 0, W, 74, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.text(esc(co.name), margin, 30)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(`${esc(co.address)}  ·  ${esc(co.phone)}  ·  ${esc(co.email)}`, margin, 48)
    doc.text(`KRA PIN: ${esc(co.kraPin)}`, margin, 61)

    let y = 112
    doc.setTextColor(3, 105, 161)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(24)
    doc.text('PAYMENT RECEIPT', margin, y)

    doc.setTextColor(71, 85, 105)
    doc.setFontSize(9)
    doc.text('Receipt No:', W - margin - 150, y - 16)
    doc.text('Date:', W - margin - 150, y)
    doc.text('Repair Ref:', W - margin - 150, y + 16)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(15, 23, 42)
    doc.text(esc(receiptNo), W - margin, y - 16, { align: 'right' })
    doc.text(fmtDate(paidAt), W - margin, y, { align: 'right' })
    doc.text(esc(ref), W - margin, y + 16, { align: 'right' })

    y += 52
    doc.setDrawColor(226, 232, 240)
    doc.line(margin, y, W - margin, y)

    y += 28
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(3, 105, 161)
    doc.text('RECEIVED FROM', margin, y)
    y += 16
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(12)
    doc.setTextColor(15, 23, 42)
    doc.text(esc(repair.customerName), margin, y)
    if (repair.customerPhone) {
      y += 14
      doc.setFontSize(9)
      doc.setTextColor(71, 85, 105)
      doc.text(`Tel: ${esc(repair.customerPhone)}`, margin, y)
    }

    y += 34
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(margin, y - 14, W - margin * 2, 92, 8, 8, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(15, 23, 42)
    doc.text('Payment for repair services', margin + 16, y + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(71, 85, 105)
    doc.text(`Device: ${esc(repair.productName)}`, margin + 16, y + 22)
    doc.text(`Invoice: ${esc(invoice?.ref ?? invoice?.invoiceNumber ?? repair.linkedInvoiceRef ?? '-')}`, margin + 16, y + 38)
    doc.text(`Method: ${esc(invoice?.paymentMethod ?? 'M-Pesa')}`, margin + 16, y + 54)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.setTextColor(5, 150, 105)
    doc.text(`KES ${fmt(amountPaid)}`, W - margin - 16, y + 32, { align: 'right' })

    y += 112
    doc.setTextColor(15, 23, 42)
    doc.setFontSize(10)
    doc.text('Status: PAID', margin, y)
    y += 16
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(71, 85, 105)
    doc.text('This receipt confirms payment received for the repair reference shown above.', margin, y)

    const footerY = 800
    doc.setDrawColor(226, 232, 240)
    doc.line(margin, footerY - 16, W - margin, footerY - 16)
    doc.setFontSize(8)
    doc.setTextColor(148, 163, 184)
    doc.text(`Thank you for choosing ${esc(co.name)}.`, W / 2, footerY, { align: 'center' })
    doc.text(esc(co.website ?? CO.website), W / 2, footerY + 12, { align: 'center' })

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'))
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Receipt-${esc(receiptNo)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[PORTAL_RECEIPT_PDF]', err)
    return NextResponse.json({ error: 'Failed to generate receipt PDF.' }, { status: 500 })
  }
}
