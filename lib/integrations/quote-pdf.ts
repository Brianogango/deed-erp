import 'server-only'

/**
 * Server-side quotation PDF, attached to Send-by-Email for both CRM quotes
 * and sales quotations. Uses jsPDF (no headless browser required).
 */
export interface QuotePdfInput {
  ref: string
  companyName: string
  contactPersonName?: string
  date?: string
  validUntil?: string
  lines: Array<{ productName: string; qty: number; unitPrice?: number; lineTotal: number }>
  subtotal?: number
  taxTotal?: number
  total: number
  paymentTerms?: string
  notes?: string
}

const kes = (n: number | undefined) => `KES ${Number(n ?? 0).toLocaleString()}`

export async function generateQuotePdfBuffer(quote: QuotePdfInput): Promise<Buffer> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF()

  // Letterhead
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(process.env.PDF_COMPANY_NAME || 'DEED TECHNOLOGIES LTD', 20, 20)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(process.env.PDF_COMPANY_ADDRESS || 'Westlands, Nairobi', 20, 26)
  doc.text(process.env.PDF_COMPANY_PHONE || '+254 20 123 4567', 20, 31)
  doc.text(process.env.PDF_COMPANY_EMAIL || 'sales@deed.co.ke', 20, 36)

  // Document block
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('QUOTATION', 150, 20)
  doc.setFontSize(11)
  doc.text(quote.ref, 150, 26)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  if (quote.date) doc.text(`Date: ${quote.date}`, 150, 31)
  if (quote.validUntil) doc.text(`Valid Until: ${quote.validUntil}`, 150, 36)

  // Customer
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('BILL TO', 20, 50)
  doc.setFontSize(11)
  doc.text(quote.companyName, 20, 56)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  if (quote.contactPersonName && quote.contactPersonName !== quote.companyName) {
    doc.text(`Attention: ${quote.contactPersonName}`, 20, 61)
  }

  // Lines
  let yPos = 75
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('#', 20, yPos)
  doc.text('Description', 30, yPos)
  doc.text('Qty', 112, yPos, { align: 'right' })
  doc.text('Unit Price', 145, yPos, { align: 'right' })
  doc.text('Total', 185, yPos, { align: 'right' })

  yPos += 6
  doc.setFont('helvetica', 'normal')
  for (const [idx, line] of quote.lines.entries()) {
    if (yPos > 270) { doc.addPage(); yPos = 20 }
    doc.text(String(idx + 1), 20, yPos)
    doc.text(String(line.productName ?? '').slice(0, 48), 30, yPos)
    doc.text(String(line.qty), 112, yPos, { align: 'right' })
    if (line.unitPrice !== undefined) doc.text(kes(line.unitPrice), 145, yPos, { align: 'right' })
    doc.text(kes(line.lineTotal), 185, yPos, { align: 'right' })
    yPos += 5
  }

  // Totals
  yPos += 10
  doc.setFont('helvetica', 'bold')
  if (quote.subtotal !== undefined) { doc.text(`Subtotal: ${kes(quote.subtotal)}`, 185, yPos, { align: 'right' }); yPos += 5 }
  if (quote.taxTotal !== undefined) { doc.text(`Tax: ${kes(quote.taxTotal)}`, 185, yPos, { align: 'right' }); yPos += 5 }
  doc.setFontSize(12)
  doc.text(`TOTAL: ${kes(quote.total)}`, 185, yPos, { align: 'right' })

  // Terms & notes
  if (quote.paymentTerms || quote.notes) {
    yPos += 15
    doc.setFontSize(10)
    doc.text('Terms & Conditions', 20, yPos)
    yPos += 6
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    if (quote.paymentTerms) { doc.text(`Payment Terms: ${quote.paymentTerms}`, 20, yPos); yPos += 5 }
    if (quote.notes) {
      const wrapped = doc.splitTextToSize(`Notes: ${quote.notes}`, 170)
      doc.text(wrapped, 20, yPos)
    }
  }

  return Buffer.from(doc.output('arraybuffer'))
}
