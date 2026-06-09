import { NextRequest, NextResponse } from 'next/server'
import { loadAppState } from '@/lib/server-store'
import { DEFAULT_COMPANY_SETTINGS, DEFAULT_BANK_ACCOUNTS } from '@/lib/store'
import { CO } from '@/lib/company'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/repair/[ref]/invoice-pdf
 * Public — generates and streams the invoice PDF for a completed repair.
 * Only available once the repair has a linked invoice.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } }
) {
  try {
    const ref = decodeURIComponent(params.ref)

    const state = await loadAppState(['deed_repairs_v2', 'deed_invoices', 'deed_companySettings', 'deed_bankAccounts'])
    const repairs = (state['deed_repairs_v2'] ?? []) as any[]
    const invoices = (state['deed_invoices'] ?? []) as any[]
    const savedSettings = state['deed_companySettings'] as Record<string, unknown> | undefined
    const savedBankAccounts = (state['deed_bankAccounts'] ?? DEFAULT_BANK_ACCOUNTS) as any[]

    const co = { ...DEFAULT_COMPANY_SETTINGS, ...(savedSettings ?? {}) }

    // Find the repair
    const repair = repairs.find((r: any) => r.ref.toLowerCase() === ref.toLowerCase())
    if (!repair) {
      return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
    }

    // Find the linked invoice
    const invoiceKey = repair.invoiceId ?? repair.linkedInvoiceId
    const invoice = invoices.find((inv: any) =>
      inv.id === invoiceKey ||
      inv.ref === repair.linkedInvoiceRef ||
      inv.invoiceNumber === repair.linkedInvoiceRef
    )
    if (!invoice) {
      return NextResponse.json({ error: 'No invoice found for this repair.' }, { status: 404 })
    }

    // Find primary bank account (not cash/mpesa)
    const primaryBankAcc = savedBankAccounts.find(
      (a: any) => a.active && a.id !== 'cash' && a.id !== 'mpesa'
    )

    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const W = 595
    const margin = 40

    const esc = (s: string) => String(s ?? '').replace(/[^\x20-\x7E]/g, '')
    const fmt = (n: number) => Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const fmtDate = (d: string) => {
      try { return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) }
      catch { return d }
    }

    let y = 0

    // ── Header bar ──────────────────────────────────────────────────────────
    doc.setFillColor(27, 39, 98)
    doc.rect(0, 0, W, 60, 'F')
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(255, 255, 255)
    doc.text(esc(co.name), margin, 28)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text(`${esc(co.address)}  ·  Tel: ${esc(co.phone)}  ·  ${esc(co.email)}`, margin, 42)
    doc.text(`KRA PIN: ${esc(co.kraPin)}`, margin, 54)

    // ── Invoice title ────────────────────────────────────────────────────────
    y = 90
    doc.setTextColor(27, 39, 98)
    doc.setFontSize(24)
    doc.setFont('helvetica', 'bold')
    doc.text('INVOICE', margin, y)

    // ── Invoice meta (right side) ────────────────────────────────────────────
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(80, 80, 80)
    doc.text('Invoice No:', W - margin - 160, y - 14)
    doc.text('Date:', W - margin - 160, y)
    doc.text('Due Date:', W - margin - 160, y + 14)
    doc.text('Repair Ref:', W - margin - 160, y + 28)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 30, 30)
    doc.text(esc(invoice.ref ?? invoice.invoiceNumber ?? '—'), W - margin, y - 14, { align: 'right' })
    doc.text(fmtDate(invoice.date), W - margin, y, { align: 'right' })
    doc.text(fmtDate(invoice.dueDate), W - margin, y + 14, { align: 'right' })
    doc.text(esc(ref), W - margin, y + 28, { align: 'right' })

    // ── Divider ──────────────────────────────────────────────────────────────
    y += 50
    doc.setDrawColor(200, 200, 200)
    doc.line(margin, y, W - margin, y)

    // ── Bill To ──────────────────────────────────────────────────────────────
    y += 18
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(27, 39, 98)
    doc.text('BILL TO', margin, y)
    y += 14
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 30, 30)
    doc.setFontSize(11)
    doc.text(esc(invoice.partnerName ?? repair.customerName ?? '—'), margin, y)
    if (repair.customerPhone) {
      y += 13
      doc.setFontSize(9)
      doc.setTextColor(80, 80, 80)
      doc.text(`Tel: ${esc(repair.customerPhone)}`, margin, y)
    }
    if (repair.customerEmail) {
      y += 12
      doc.setFontSize(9)
      doc.setTextColor(80, 80, 80)
      doc.text(esc(repair.customerEmail), margin, y)
    }

    // ── Device info ──────────────────────────────────────────────────────────
    y += 20
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(27, 39, 98)
    doc.text('DEVICE', margin, y)
    y += 12
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 30, 30)
    doc.setFontSize(9)
    const deviceDesc = [repair.deviceBrand, repair.deviceModel, repair.deviceColor].filter(Boolean).join(' ')
    if (deviceDesc) doc.text(esc(deviceDesc), margin, y)
    if (repair.deviceSerial) {
      y += 12
      doc.text(`S/N: ${esc(repair.deviceSerial)}`, margin, y)
    }

    // ── Table header ─────────────────────────────────────────────────────────
    y += 26
    doc.setFillColor(243, 244, 246)
    doc.rect(margin, y - 10, W - margin * 2, 18, 'F')
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(80, 80, 80)
    const colX = { desc: margin + 4, qty: 320, price: 390, total: 490 }
    doc.text('#', margin + 2, y)
    doc.text('Description', colX.desc + 16, y)
    doc.text('Qty', colX.qty, y)
    doc.text('Unit Price', colX.price, y)
    doc.text('Total', colX.total, y)

    // ── Table rows ────────────────────────────────────────────────────────────
    y += 14
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 30, 30)
    const lines = (invoice.lines ?? []) as any[]
    lines.forEach((line: any, idx: number) => {
      if (y > 700) { doc.addPage(); y = margin + 20 }
      doc.setFontSize(8)
      doc.text(String(idx + 1), margin + 2, y)
      const name = esc(line.description ?? line.productName ?? '')
      doc.text(doc.splitTextToSize(name, 250)[0], colX.desc + 16, y)
      doc.text(String(line.qty ?? 1), colX.qty, y)
      doc.text(`KES ${fmt(Number(line.unitPrice ?? 0))}`, colX.price, y)
      doc.text(`KES ${fmt(Number(line.subtotal ?? line.lineTotal ?? 0))}`, colX.total, y)
      y += 14
    })

    // ── Totals ────────────────────────────────────────────────────────────────
    y += 8
    doc.setDrawColor(200, 200, 200)
    doc.line(colX.price - 10, y, W - margin, y)
    y += 12
    doc.setFontSize(9)
    doc.setTextColor(80, 80, 80)
    doc.text('Subtotal:', colX.price - 10, y)
    doc.text(`KES ${fmt(Number(invoice.subtotal ?? 0))}`, colX.total, y)
    if (Number(invoice.taxTotal ?? 0) > 0) {
      y += 14
      doc.text(`VAT (${co.vatRate ?? 16}%):`, colX.price - 10, y)
      doc.text(`KES ${fmt(Number(invoice.taxTotal))}`, colX.total, y)
    }
    if (Number(invoice.amountPaid ?? 0) > 0) {
      y += 14
      doc.setTextColor(5, 150, 105)
      doc.text('Amount Paid:', colX.price - 10, y)
      doc.text(`− KES ${fmt(Number(invoice.amountPaid))}`, colX.total, y)
      doc.setTextColor(80, 80, 80)
    }
    y += 14
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(27, 39, 98)
    const outstanding = Math.max(0, Number(invoice.total ?? 0) - Number(invoice.amountPaid ?? 0))
    doc.text('TOTAL DUE:', colX.price - 10, y)
    doc.text(`KES ${fmt(outstanding)}`, colX.total, y)

    // ── Payment details ───────────────────────────────────────────────────────
    y += 28
    doc.setDrawColor(200, 200, 200)
    doc.line(margin, y, W - margin, y)
    y += 16
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(27, 39, 98)
    doc.text('PAYMENT DETAILS', margin, y)
    y += 14
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 30, 30)
    doc.setFontSize(8.5)

    // M-Pesa
    const mpesaPaybill = esc(co.mpesaPaybill || CO.mpesaPaybill)
    const mpesaAccount = esc(co.mpesaAccount || CO.mpesaAccount)
    if (mpesaPaybill) {
      doc.setFont('helvetica', 'bold')
      doc.text('M-PESA:', margin, y)
      doc.setFont('helvetica', 'normal')
      doc.text(`Paybill: ${mpesaPaybill}  ·  Account: ${mpesaAccount}  ·  Amount: KES ${fmt(outstanding)}`, margin + 50, y)
      y += 14
    }

    // Bank
    if (primaryBankAcc) {
      doc.setFont('helvetica', 'bold')
      doc.text('Bank Transfer:', margin, y)
      doc.setFont('helvetica', 'normal')
      doc.text(`${esc(primaryBankAcc.bankName)}  ·  A/C: ${esc(primaryBankAcc.accountNo)}`, margin + 80, y)
      y += 12
      doc.text(`Branch: ${esc(CO.bankBranch)}  ·  SWIFT: ${esc(CO.swiftCode)}`, margin + 80, y)
      y += 14
    } else {
      doc.setFont('helvetica', 'bold')
      doc.text('Bank Transfer:', margin, y)
      doc.setFont('helvetica', 'normal')
      doc.text(`${esc(CO.bankName)}  ·  A/C: ${esc(CO.bankAccount)}`, margin + 80, y)
      y += 12
      doc.text(`Branch: ${esc(CO.bankBranch)}  ·  SWIFT: ${esc(CO.swiftCode)}`, margin + 80, y)
      y += 14
    }

    // Payment reference
    y += 4
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(27, 39, 98)
    doc.text(`Please use "${esc(invoice.ref ?? ref)}" as your payment reference.`, margin, y)

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = 820
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(160, 160, 160)
    doc.text('Thank you for choosing Deed Technologies. For queries contact accounts@deed.co.ke', W / 2, footerY, { align: 'center' })
    doc.text(esc(co.website ?? CO.website), W / 2, footerY + 12, { align: 'center' })

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'))
    const filename = `Invoice-${esc(invoice.ref ?? ref)}.pdf`

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[PORTAL_INVOICE_PDF]', err)
    return NextResponse.json({ error: 'Failed to generate invoice PDF.' }, { status: 500 })
  }
}
