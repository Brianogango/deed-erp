import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/portal/quotes/[id]/pdf
 * Download quote as PDF
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const quoteId = params.id

    // TODO: Fetch quote from database
    const quote = {
      id: quoteId,
      ref: 'QT-2024-0001',
      companyName: 'Acme Corporation',
      contactPersonName: 'John Doe',
      issueDate: '2024-04-15',
      validUntil: '2024-05-15',
      subtotal: 100000,
      taxTotal: 16000,
      total: 116000,
      paymentTerms: '30 days',
      notes: 'Thank you for your business',
      ownerName: 'Jane Smith',
      lines: [
        {
          productName: 'Dell Latitude 5520',
          sku: 'DELL-LAT-5520',
          qty: 5,
          unitPrice: 20000,
          discount: 0,
          taxRate: 16,
          lineTotal: 100000,
        },
      ],
    }

    // Generate PDF
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF()

    // Header
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text(process.env.PDF_COMPANY_NAME || 'DEED TECHNOLOGIES LTD', 20, 20)

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(process.env.PDF_COMPANY_ADDRESS || 'Westlands, Nairobi', 20, 26)
    doc.text(process.env.PDF_COMPANY_PHONE || '+254 20 123 4567', 20, 31)

    // Quote info
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('QUOTATION', 150, 20)
    doc.setFontSize(11)
    doc.text(quote.ref, 150, 26)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(`Date: ${quote.issueDate}`, 150, 31)
    doc.text(`Valid Until: ${quote.validUntil}`, 150, 36)

    // Customer info
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('BILL TO', 20, 50)
    doc.setFontSize(11)
    doc.text(quote.companyName, 20, 56)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(`Attention: ${quote.contactPersonName}`, 20, 61)

    // Table
    let yPos = 75
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('#', 20, yPos)
    doc.text('Description', 30, yPos)
    doc.text('Qty', 110, yPos)
    doc.text('Unit Price', 130, yPos)
    doc.text('Total', 170, yPos)

    yPos += 6
    doc.setFont('helvetica', 'normal')
    quote.lines.forEach((line: any, idx: number) => {
      doc.text(String(idx + 1), 20, yPos)
      doc.text(line.productName, 30, yPos)
      doc.text(String(line.qty), 110, yPos)
      doc.text(`KES ${line.unitPrice.toLocaleString()}`, 130, yPos)
      doc.text(`KES ${line.lineTotal.toLocaleString()}`, 170, yPos)
      yPos += 5
    })

    // Totals
    yPos += 10
    doc.setFont('helvetica', 'bold')
    doc.text(`Subtotal: KES ${quote.subtotal.toLocaleString()}`, 130, yPos)
    yPos += 5
    doc.text(`Tax: KES ${quote.taxTotal.toLocaleString()}`, 130, yPos)
    yPos += 5
    doc.setFontSize(12)
    doc.text(`TOTAL: KES ${quote.total.toLocaleString()}`, 130, yPos)

    // Generate PDF buffer
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'))

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${quote.ref}.pdf"`,
      },
    })
  } catch (error) {
    console.error('Generate PDF error:', error)
    return NextResponse.json(
      { error: 'Failed to generate PDF' },
      { status: 500 }
    )
  }
}
