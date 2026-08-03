/**
 * Shared Deed commercial-document PDF layout (server + client safe).
 * Used by portal quote/invoice/receipt routes and mirrored by the
 * client commercial-pdf generator for Sales / Invoice downloads.
 */

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface DeedPdfLine {
  lineType?: 'item' | 'section'
  description: string
  qty: number
  unitPrice?: number
  taxRate?: number
  discountPct?: number
  subtotal?: number
}

export interface DeedPdfCompany {
  name: string
  address?: string
  city?: string
  phone?: string
  email?: string
  website?: string
  kraPin?: string
  currency?: string
  mpesaPaybill?: string
  mpesaAccount?: string
  invoiceFooter?: string
  logoDataUrl?: string
  logoWidth?: number
  logoHeight?: number
}

export interface DeedPdfBank {
  active?: boolean
  id?: string
  accountNo?: string
  bankName?: string
  currency?: string
}

export interface DeedPdfInput {
  title: string
  ref: string
  date?: string
  dueLabel?: string
  dueDate?: string
  salesperson?: string
  sourceRef?: string
  customerName: string
  customerAddress?: string
  customerCountry?: string
  customerTaxId?: string
  customerPhone?: string
  /** Shown under the customer name in the party block. */
  attention?: string
  partyLabel?: string
  lines: DeedPdfLine[]
  subtotal?: number
  discountTotal?: number
  taxTotal?: number
  total?: number
  amountPaid?: number
  notes?: string
  paymentCommunication?: boolean
  hideAmounts?: boolean
  showPaymentDetails?: boolean
  showSignature?: boolean
  /** Extra rows under payment details (receipts). */
  extraPaymentLines?: string[]
  /**
   * When provided, replaces the default bank/M-Pesa block (still includes
   * payment reference / extra lines as already composed by the caller).
   */
  paymentDetailLines?: string[]
}

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 36
const NAVY: [number, number, number] = [27, 39, 98]
const LIGHT_BLUE: [number, number, number] = [91, 155, 213]
const CYAN: [number, number, number] = [0, 174, 239]
const GRAY: [number, number, number] = [100, 116, 139]
const TEXT: [number, number, number] = [15, 23, 42]
const BORDER: [number, number, number] = [203, 213, 225]
const SURFACE: [number, number, number] = [248, 250, 252]
const FOOTER_GRAY: [number, number, number] = [148, 163, 184]

const money = (n: number) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (value?: string) => {
  if (!value) return ''
  try {
    return new Date(value).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return value }
}

const displayWebsite = (website?: string) => {
  if (!website) return 'shop.deed.africa'
  return website.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

const docNoLabel = (title: string) => {
  const t = title.toLowerCase()
  if (t.includes('receipt')) return 'Receipt No'
  if (t.includes('quote') || t.includes('quotation')) return 'Quote No'
  if (t.includes('pro-forma') || t.includes('proforma')) return 'Proforma No'
  if (t.includes('delivery')) return 'DN No'
  if (t.includes('bill')) return 'Bill No'
  return 'Invoice No'
}

const partyLabelFor = (title: string, override?: string) => {
  if (override) return override
  const t = title.toLowerCase()
  if (t.includes('receipt')) return 'Receipt To'
  if (t.includes('quote') || t.includes('quotation')) return 'Quote To'
  if (t.includes('pro-forma') || t.includes('proforma')) return 'Bill To'
  if (t.includes('delivery')) return 'Deliver To'
  if (t.includes('bill')) return 'Bill From'
  return 'Invoice To'
}

function drawFooterTriangles(doc: jsPDF) {
  const baseY = PAGE_H
  doc.setFillColor(91, 155, 213)
  doc.triangle(PAGE_W - 210, baseY, PAGE_W - 40, baseY - 95, PAGE_W, baseY, 'F')
  doc.setFillColor(27, 39, 98)
  doc.triangle(PAGE_W - 130, baseY, PAGE_W - 10, baseY - 70, PAGE_W, baseY, 'F')
  doc.setFillColor(148, 163, 184)
  doc.triangle(PAGE_W - 70, baseY, PAGE_W, baseY - 48, PAGE_W, baseY, 'F')
  doc.setFillColor(203, 213, 225)
  doc.triangle(MARGIN, baseY, MARGIN + 90, baseY - 28, MARGIN + 160, baseY, 'F')
}

function drawContactIcon(doc: jsPDF, kind: 'phone' | 'email' | 'pin', x: number, y: number) {
  doc.setDrawColor(...LIGHT_BLUE)
  doc.setFillColor(239, 246, 255)
  doc.circle(x, y, 7, 'FD')
  doc.setFont('helvetica', 'bold').setFontSize(6).setTextColor(...NAVY)
  const glyph = kind === 'phone' ? 'T' : kind === 'email' ? '@' : 'P'
  doc.text(glyph, x, y + 2, { align: 'center' })
}

export function buildDeedDocumentPdf(
  input: DeedPdfInput,
  company: DeedPdfCompany,
  bankAccounts: DeedPdfBank[] = [],
): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const currency = company.currency || 'KES'
  const rightX = PAGE_W - MARGIN
  const contentW = PAGE_W - MARGIN * 2
  const contentBottom = PAGE_H - 88
  const showAmounts = !input.hideAmounts
  const showPayment = input.showPaymentDetails ?? showAmounts
  const showSignature = input.showSignature ?? true
  const partyLabel = partyLabelFor(input.title, input.partyLabel)
  const website = displayWebsite(company.website)

  const ensureRoom = (y: number, needed: number): number => {
    if (y + needed <= contentBottom) return y
    doc.addPage()
    return 56
  }

  // Letterhead
  if (company.logoDataUrl && company.logoWidth && company.logoHeight) {
    const maxH = 42
    const maxW = 128
    const scale = Math.min(maxH / company.logoHeight, maxW / company.logoWidth)
    try {
      doc.addImage(company.logoDataUrl, 'PNG', MARGIN, 28, company.logoWidth * scale, company.logoHeight * scale)
    } catch {
      doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...NAVY)
      doc.text('deed', MARGIN, 48)
    }
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...NAVY)
    doc.text('deed', MARGIN, 48)
    doc.setFillColor(...CYAN)
    doc.circle(MARGIN + 42, 40, 2.2, 'F')
  }

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...FOOTER_GRAY)
  doc.text(website, rightX, 44, { align: 'right' })

  // Watermark
  doc.setFont('helvetica', 'bold').setFontSize(64).setTextColor(230, 238, 248)
  doc.text('deed', PAGE_W / 2, 420, { align: 'center' })

  let y = 88
  doc.setFont('helvetica', 'bold').setFontSize(28).setTextColor(...NAVY)
  doc.text(input.title.toUpperCase(), MARGIN, y)

  y += 22
  const metaRows = [
    { label: docNoLabel(input.title), value: input.ref },
    ...(input.date ? [{ label: 'Date', value: fmtDate(input.date) }] : []),
    ...(input.dueDate ? [{ label: input.dueLabel ?? 'Due Date', value: fmtDate(input.dueDate) }] : []),
  ]
  metaRows.forEach(row => {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...TEXT)
    doc.text(`${row.label}:`, MARGIN, y)
    doc.setFont('helvetica', 'normal')
    doc.text(row.value, MARGIN + 78, y)
    y += 14
  })

  let partyY = 88
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...LIGHT_BLUE)
  doc.text(`${partyLabel}:`, rightX, partyY, { align: 'right' })
  partyY += 14
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...LIGHT_BLUE)
  doc.text(input.customerName, rightX, partyY, { align: 'right', maxWidth: 240 })
  partyY += 14
  if (input.attention) {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...LIGHT_BLUE)
    doc.text(`Attn: ${input.attention}`, rightX, partyY, { align: 'right', maxWidth: 240 })
    partyY += 14
  }
  if (input.customerCountry || input.customerAddress) {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...LIGHT_BLUE)
    doc.text(input.customerCountry || 'Kenya', rightX, partyY, { align: 'right' })
    partyY += 14
  }
  if (input.customerPhone) {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...LIGHT_BLUE)
    doc.text(input.customerPhone, rightX, partyY, { align: 'right' })
    partyY += 14
  }
  if (input.sourceRef) {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...LIGHT_BLUE)
    doc.text(`Reference: ${input.sourceRef}`, rightX, partyY, { align: 'right' })
    partyY += 14
  } else if (input.salesperson) {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...LIGHT_BLUE)
    doc.text(`Prepared by: ${input.salesperson}`, rightX, partyY, { align: 'right' })
    partyY += 14
  }
  if (input.customerTaxId) {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRAY)
    doc.text(`PIN: ${input.customerTaxId}`, rightX, partyY, { align: 'right' })
    partyY += 12
  }

  y = Math.max(y, partyY) + 18

  const head = showAmounts
    ? [['SL.', 'ITEM DESCRIPTION', 'UNIT PRICE', 'QUANTITY', 'TAX', 'TOTAL']]
    : [['SL.', 'ITEM DESCRIPTION', 'QUANTITY']]

  let sl = 0
  const bodyRows = input.lines.map(line => {
    if (line.lineType === 'section') {
      return [{
        content: line.description,
        colSpan: showAmounts ? 6 : 3,
        styles: { fontStyle: 'bold' as const, textColor: NAVY, fillColor: [239, 246, 255] as [number, number, number] },
      }]
    }
    sl += 1
    if (!showAmounts) {
      return [
        String(sl),
        line.description,
        Number.isInteger(line.qty) ? String(line.qty) : money(line.qty),
      ]
    }
    const taxCell = [
      line.taxRate ? `VAT ${line.taxRate}%` : null,
      (line.discountPct ?? 0) > 0 ? `Disc ${line.discountPct}%` : null,
    ].filter(Boolean).join('\n') || '—'
    return [
      String(sl),
      line.description,
      `${currency} ${money(line.unitPrice ?? 0)}`,
      Number.isInteger(line.qty) ? String(line.qty) : money(line.qty),
      taxCell,
      `${currency} ${money(line.subtotal ?? 0)}`,
    ]
  })

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: 56, bottom: 96 },
    head,
    body: bodyRows as any,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      textColor: TEXT,
      cellPadding: { top: 7, bottom: 7, left: 6, right: 6 },
      lineColor: BORDER,
      lineWidth: 0.4,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: NAVY,
      fontSize: 7.5,
      fontStyle: 'bold',
      textColor: [255, 255, 255],
      lineColor: NAVY,
      minCellHeight: 24,
      halign: 'center',
    },
    alternateRowStyles: { fillColor: SURFACE },
    columnStyles: showAmounts
      ? {
          0: { cellWidth: 28, halign: 'center' },
          1: { cellWidth: 'auto', halign: 'left' },
          2: { cellWidth: 88,halign: 'right' },
          3: { cellWidth: 58,halign: 'center' },
          4: { cellWidth: 58,halign: 'center' },
          5: { cellWidth: 92,halign: 'right' },
        }
      : {
          0: { cellWidth: 28,halign: 'center' },
          1: { cellWidth: 'auto',halign: 'left' },
          2: { cellWidth: 70,halign: 'center' },
        },
  })

  y = (doc as any).lastAutoTable.finalY + 18

  const notesText = input.notes?.trim() || (input.sourceRef ? `Created from ${input.sourceRef}.` : '')
  const taxRates = Array.from(new Set(input.lines.filter(l => l.lineType !== 'section' && (l.taxRate ?? 0) > 0).map(l => l.taxRate)))
  const vatLabel = taxRates.length === 1 ? `VAT ${taxRates[0]}%` : 'VAT'

  const totals: Array<{ label: string; value: string; bold?: boolean; accent?: boolean }> = []
  if (showAmounts) {
    const disc = Number(input.discountTotal) || 0
    const net = Number(input.subtotal) || 0
    // When line discounts exist, show gross → discount → net so the PDF doesn't
    // look like discount is applied twice on an already-net subtotal.
    if (disc > 0) {
      totals.push({ label: 'Subtotal', value: `${currency} ${money(net + disc)}` })
      totals.push({ label: 'Discount', value: `- ${currency} ${money(disc)}` })
    } else {
      totals.push({ label: 'Subtotal', value: `${currency} ${money(net)}` })
    }
    if (input.taxTotal) totals.push({ label: vatLabel, value: `${currency} ${money(input.taxTotal)}` })
    totals.push({ label: 'TOTAL', value: `${currency} ${money(input.total ?? 0)}`, bold: true, accent: true })
    if (input.amountPaid && input.amountPaid > 0) {
      totals.push({ label: 'Amount Paid', value: `- ${currency} ${money(input.amountPaid)}` })
      totals.push({
        label: 'Amount Due',
        value: `${currency} ${money(Math.max(0, (input.total ?? 0) - input.amountPaid))}`,
        bold: true,
        accent: true,
      })
    }
  }

  const leftW = contentW * 0.52
  const rightW = contentW * 0.42
  const totalsH = Math.max(48, totals.length * 16 + 8)
  const notesWrapped = notesText ? (doc.splitTextToSize(notesText, leftW - 18) as string[]) : []
  const notesH = notesText ? Math.max(48, notesWrapped.length * 11 + 28) : 0
  const notesTotalsH = Math.max(notesH, totalsH, showAmounts ? 48 : 0)

  const paymentLines: string[] = []
  if (showPayment) {
    if (Array.isArray(input.paymentDetailLines) && input.paymentDetailLines.length > 0) {
      paymentLines.push(...input.paymentDetailLines)
    } else {
      paymentLines.push(...(input.extraPaymentLines ?? []))
      if (input.paymentCommunication || input.ref) {
        paymentLines.unshift(`Payment Reference: ${input.ref}`)
      }
      const primaryBank = bankAccounts.find(a => a.active && a.id !== 'cash' && a.id !== 'mpesa')
      if (primaryBank?.accountNo) {
        paymentLines.push('Bank Transfer:')
        paymentLines.push(`Account Name: ${company.name}`)
        paymentLines.push(`Account Number: ${primaryBank.accountNo} (${primaryBank.currency || currency})`)
        if (primaryBank.bankName) paymentLines.push(`Bank: ${primaryBank.bankName}`)
      }
      if (company.mpesaPaybill) {
        paymentLines.push('M-PESA:')
        paymentLines.push(`Pay Bill No: ${company.mpesaPaybill}`)
        if (company.mpesaAccount) paymentLines.push(`Account Number: ${company.mpesaAccount} (${currency})`)
      }
    }
  }

  const paymentH = paymentLines.length ? paymentLines.length * 11 + 28 : 0
  const sigH = showSignature ? 70 : 0
  const bottomBlockH = Math.max(paymentH, sigH)
  // Notes/totals + gap + payment/signature. Keep the contact footer band clear.
  const closingH = notesTotalsH + 16 + (bottomBlockH > 0 ? bottomBlockH + 8 : 0)

  // Short quotes/invoices: pin the closing band just above the page footer so
  // the document fills the A4 page. The contact footer is always drawn at the
  // absolute page bottom (not under sparse mid-page content).
  let pinnedClosing = false
  if (closingH > 0 && y + closingH <= contentBottom) {
    y = Math.max(y, contentBottom - closingH)
    pinnedClosing = true
  }

  y = ensureRoom(y, notesTotalsH + 12)

  if (notesText) {
    doc.setFillColor(...CYAN)
    doc.roundedRect(MARGIN, y, 3.5, 14, 1, 1, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...NAVY)
    doc.text('Notes', MARGIN + 10, y + 11)
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...GRAY)
    doc.text(notesWrapped, MARGIN + 10, y + 26)
  }

  if (showAmounts && totals.length) {
    const totalsX = rightX - rightW
    let totalsY = y + 10
    for (const row of totals) {
      doc.setFont('helvetica', row.bold ? 'bold' : 'normal').setFontSize(row.bold ? 12 : 9)
      doc.setTextColor(...(row.accent ? NAVY : TEXT))
      doc.text(row.label, totalsX, totalsY)
      doc.text(row.value, rightX, totalsY, { align: 'right' })
      totalsY += row.bold ? 18 : 15
    }
  }

  y += notesTotalsH + 16

  if (bottomBlockH > 0) {
    const pagesBefore = doc.getNumberOfPages()
    y = ensureRoom(y, bottomBlockH + 8)
    const spilledToNewPage = doc.getNumberOfPages() > pagesBefore
    // Pin payment/signature above the footer on short pages, or after a spill.
    // Skip when the full closing band was already pinned (preserves the gap).
    if (spilledToNewPage || !pinnedClosing) {
      if (y + bottomBlockH <= contentBottom) {
        y = Math.max(y, contentBottom - bottomBlockH)
      }
    }
  }

  if (paymentLines.length) {
    doc.setFillColor(...NAVY)
    doc.roundedRect(MARGIN, y, 3.5, 14, 1, 1, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...NAVY)
    doc.text('Payment Details', MARGIN + 10, y + 11)
    let payY = y + 28
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...TEXT)
    for (const line of paymentLines) {
      const isHeading = line.endsWith(':') && !line.includes('Reference')
      doc.setFont('helvetica', isHeading ? 'bold' : 'normal')
      doc.text(line, MARGIN + 10, payY, { maxWidth: leftW - 10 })
      payY += 11
    }
  }

  if (showSignature) {
    const sigX = rightX - rightW
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...GRAY)
    doc.text('AUTHORISED SIGNATURE', sigX, y + 11)
    doc.setDrawColor(...BORDER).setLineWidth(0.8)
    doc.line(sigX, y + 48, rightX, y + 48)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRAY)
    doc.text('Authorised Signature', sigX + rightW / 2, y + 62, { align: 'center' })
  }

  const pageCount = doc.getNumberOfPages()
  const phone = company.phone || ''
  const email = company.email || ''
  const address = [company.address, company.city, 'Kenya'].filter(Boolean).join(', ')
  const pin = company.kraPin || ''

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page)
    if (page > 1) {
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...NAVY)
      doc.text(`${input.title.toUpperCase()} · ${input.ref}`, MARGIN, 28)
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...FOOTER_GRAY)
      doc.text(website, rightX, 28, { align: 'right' })
    }

    // Page chrome is always absolute to A4 — never follows mid-page content.
    drawFooterTriangles(doc)

    const footerY = PAGE_H - 52
    doc.setDrawColor(...BORDER).setLineWidth(0.5)
    doc.line(MARGIN, footerY - 14, rightX - 120, footerY - 14)

    const col1 = MARGIN + 12
    const col2 = MARGIN + contentW * 0.34
    const col3 = MARGIN + contentW * 0.62
    drawContactIcon(doc, 'phone', col1, footerY)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRAY)
    doc.text(phone, col1 + 12, footerY + 2)

    drawContactIcon(doc, 'email', col2, footerY)
    doc.text(email, col2 + 12, footerY + 2)

    drawContactIcon(doc, 'pin', col3, footerY)
    const addrLines = doc.splitTextToSize(address, 150) as string[]
    doc.text(addrLines.slice(0, 2), col3 + 12, footerY - 2)

    if (pin) {
      doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...NAVY)
      doc.text(`PIN: ${pin}`, rightX - 100, footerY + 2, { align: 'right' })
    }

    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRAY)
    doc.text(company.invoiceFooter || 'Thank you for your business.', PAGE_W / 2, PAGE_H - 18, { align: 'center' })
  }

  return doc
}

export function deedPdfToBuffer(doc: jsPDF): Uint8Array<ArrayBuffer> {
  const ab = doc.output('arraybuffer') as ArrayBuffer
  return new Uint8Array(ab)
}
