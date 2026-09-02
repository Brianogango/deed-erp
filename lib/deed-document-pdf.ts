/**
 * Deed Technologies commercial document family.
 * One clean A4 system for quotation, sales order, proforma invoice,
 * tax invoice, bill, receipt and delivery note.
 */

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { customerFacingNotes } from '@/lib/customer-facing-notes'

export interface DeedPdfLine {
  lineType?: 'item' | 'section'
  description: string
  qty: number
  unitPrice?: number
  taxRate?: number
  discountPct?: number
  subtotal?: number
  serial?: string
  specs?: string
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
  logoFormat?: 'PNG' | 'JPEG'
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
  customerEmail?: string
  attention?: string
  partyLabel?: string
  lines: DeedPdfLine[]
  subtotal?: number
  discountTotal?: number
  postTaxDiscountTotal?: number
  taxTotal?: number
  total?: number
  amountPaid?: number
  notes?: string
  paymentCommunication?: boolean
  hideAmounts?: boolean
  showPaymentDetails?: boolean
  showSignature?: boolean
  deliveryNoteLayout?: boolean
  recipientIdNumber?: string
  showReceiptAcknowledgement?: boolean
  extraPaymentLines?: string[]
  paymentDetailLines?: string[]
}

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 34
const RIGHT = PAGE_W - MARGIN
const CONTENT_W = PAGE_W - MARGIN * 2
const BODY_BOTTOM = PAGE_H - 54

const NAVY: [number, number, number] = [32, 22, 77]
const INK: [number, number, number] = [7, 22, 76]
const CYAN: [number, number, number] = [0, 174, 239]
const BLUE: [number, number, number] = [7, 139, 212]
const MUTED: [number, number, number] = [91, 107, 128]
const BORDER: [number, number, number] = [205, 219, 232]
const SOFT: [number, number, number] = [246, 250, 253]
const AMBER: [number, number, number] = [188, 101, 0]
const AMBER_SOFT: [number, number, number] = [255, 247, 232]

const money = (value: number) =>
  Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (value?: string) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
}

const cleanWebsite = (value?: string) =>
  (value || 'deed.africa').replace(/^https?:\/\//i, '').replace(/\/$/, '')

const titleKind = (title: string) => {
  const value = title.toLowerCase().replace(/-/g, '')
  if (value.includes('proforma')) return 'proforma'
  if (value.includes('quotation') || value.includes('quote')) return 'quotation'
  if (value.includes('sales order') || value.includes('sale order')) return 'sales-order'
  if (value.includes('delivery')) return 'delivery'
  if (value.includes('receipt')) return 'receipt'
  if (value.includes('bill')) return 'bill'
  return 'invoice'
}

const partyLabelFor = (input: DeedPdfInput) => {
  if (input.partyLabel) return input.partyLabel
  const kind = titleKind(input.title)
  if (kind === 'delivery') return 'DELIVER TO'
  if (kind === 'receipt') return 'RECEIPT TO'
  if (kind === 'bill') return 'BILL FROM'
  return 'BILL TO'
}

const line = (doc: jsPDF, x1: number, y: number, x2: number, color = BORDER, width = .55) => {
  doc.setDrawColor(...color).setLineWidth(width)
  doc.line(x1, y, x2, y)
}

const writeLabel = (doc: jsPDF, text: string, x: number, y: number) => {
  doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...BLUE)
  doc.text(text.toUpperCase(), x, y)
}

const writeValue = (doc: jsPDF, text: string, x: number, y: number, options: Record<string, unknown> = {}) => {
  doc.setFont('helvetica', 'normal').setFontSize(8.3).setTextColor(...INK)
  doc.text(text || '—', x, y, options as any)
}

function drawLogo(doc: jsPDF, company: DeedPdfCompany) {
  const maxW = 118
  const maxH = 48
  if (company.logoDataUrl && company.logoWidth && company.logoHeight) {
    const scale = Math.min(maxW / company.logoWidth, maxH / company.logoHeight)
    try {
      doc.addImage(
        company.logoDataUrl,
        company.logoFormat || 'PNG',
        MARGIN,
        22,
        company.logoWidth * scale,
        company.logoHeight * scale,
      )
      return
    } catch {
      // Fall through to the clean text mark only if the configured image is unreadable.
    }
  }
  doc.setFont('helvetica', 'bold').setFontSize(26).setTextColor(...NAVY)
  doc.text('deed', MARGIN, 50)
  doc.setFontSize(6.5).setTextColor(...CYAN)
  doc.text('TECHNOLOGIES', MARGIN + 8, 61)
}

function drawLetterhead(doc: jsPDF, company: DeedPdfCompany, continuation?: string) {
  drawLogo(doc, company)
  const details = [
    [company.address, company.city].filter(Boolean).join(', '),
    company.phone,
    cleanWebsite(company.website),
    company.email,
  ].filter(Boolean) as string[]

  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...INK)
  details.slice(0, 4).forEach((item, index) => doc.text(item, RIGHT, 27 + index * 11, { align: 'right' }))
  line(doc, MARGIN, 76, RIGHT, CYAN, 1.2)

  if (continuation) {
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...NAVY)
    doc.text(continuation, MARGIN, 91)
  }
}

function drawFooter(doc: jsPDF, company: DeedPdfCompany, input: DeedPdfInput, page: number, pages: number) {
  line(doc, MARGIN, PAGE_H - 38, RIGHT, CYAN, .9)
  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED)
  doc.text(`Page ${page} of ${pages}`, MARGIN, PAGE_H - 22)
  doc.text(company.invoiceFooter || 'Thank you for your business.', PAGE_W / 2, PAGE_H - 22, { align: 'center' })
  const stamp = new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
  doc.text(`Generated: ${stamp}`, RIGHT, PAGE_H - 22, { align: 'right' })
  doc.setFont('helvetica', 'bold').setFontSize(6.5).setTextColor(...NAVY)
  doc.text(`${input.ref} · ${cleanWebsite(company.website)}`, RIGHT, PAGE_H - 10, { align: 'right' })
}

function pageBreak(doc: jsPDF, company: DeedPdfCompany, input: DeedPdfInput) {
  doc.addPage()
  drawLetterhead(doc, company, `${input.title.toUpperCase()} · ${input.ref}`)
  return 108
}

function ensureRoom(doc: jsPDF, company: DeedPdfCompany, input: DeedPdfInput, y: number, needed: number) {
  return y + needed > BODY_BOTTOM ? pageBreak(doc, company, input) : y
}

function drawMetaRow(doc: jsPDF, label: string, value: string, x: number, y: number, labelW = 82) {
  doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...MUTED)
  doc.text(label, x, y)
  doc.setFont('helvetica', 'normal').setFontSize(8.3).setTextColor(...INK)
  doc.text(value || '—', x + labelW, y, { maxWidth: 175 })
}

function defaultPaymentLines(input: DeedPdfInput, company: DeedPdfCompany, banks: DeedPdfBank[]) {
  if (input.paymentDetailLines?.length) return input.paymentDetailLines
  const output = [...(input.extraPaymentLines || [])]
  const bank = banks.find(item => item.active && item.accountNo && !/m-?pesa/i.test(item.bankName || ''))
  if (bank) {
    output.push('BANK TRANSFER')
    output.push(`Bank: ${bank.bankName || 'Bank account'}`)
    output.push(`Account name: ${company.name}`)
    output.push(`Account number: ${bank.accountNo}`)
  }
  if (company.mpesaPaybill) {
    output.push('M-PESA PAYMENT')
    output.push(`Paybill number: ${company.mpesaPaybill}`)
    output.push(`Account number: ${company.mpesaAccount || input.ref}`)
  }
  if (input.paymentCommunication || input.ref) output.push(`Payment reference: ${input.ref}`)
  return output
}

export function buildDeedDocumentPdf(
  input: DeedPdfInput,
  company: DeedPdfCompany,
  bankAccounts: DeedPdfBank[] = [],
): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const kind = titleKind(input.title)
  const delivery = Boolean(input.deliveryNoteLayout) || kind === 'delivery'
  const showAmounts = !input.hideAmounts
  const currency = company.currency || 'KES'
  const customerLabel = partyLabelFor(input)

  drawLetterhead(doc, company)

  let y = 112
  doc.setFont('helvetica', 'bold').setFontSize(21).setTextColor(...NAVY)
  doc.text(input.title.toUpperCase(), MARGIN, y)

  y += 24
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...NAVY)
  doc.text(input.ref, MARGIN, y)
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
  const topDateLabel = kind === 'quotation' || kind === 'proforma' ? `Valid until: ${fmtDate(input.dueDate)}` : `${input.dueLabel || 'Date'}: ${fmtDate(input.dueDate || input.date)}`
  doc.text(topDateLabel, RIGHT, y, { align: 'right' })

  y += 28
  const leftX = MARGIN + 10
  const splitX = MARGIN + 232
  const rightX = splitX + 18
  writeLabel(doc, customerLabel, leftX, y)
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK)
  doc.text(input.customerName || 'Customer', leftX, y + 17, { maxWidth: 195 })
  let partyY = y + 32
  const partyLines = [
    input.attention ? `Attention: ${input.attention}` : '',
    input.customerAddress || '',
    input.customerCountry || '',
    input.customerPhone ? `Phone: ${input.customerPhone}` : '',
    input.customerEmail ? `Email: ${input.customerEmail}` : '',
    input.customerTaxId ? `PIN: ${input.customerTaxId}` : '',
  ].filter(Boolean)
  partyLines.slice(0, 6).forEach(value => {
    const wrapped = doc.splitTextToSize(value, 195) as string[]
    writeValue(doc, wrapped.slice(0, 2).join('\n'), leftX, partyY, { maxWidth: 195 })
    partyY += Math.max(12, wrapped.slice(0, 2).length * 10)
  })

  doc.setDrawColor(...BORDER).setLineWidth(.5)
  doc.line(splitX, y - 5, splitX, Math.max(y + 92, partyY + 3))
  const meta: Array<[string, string]> = [
    ['Issue date', fmtDate(input.date)],
    ...(input.sourceRef ? [['Source document', input.sourceRef] as [string, string]] : []),
    ...(input.dueDate ? [[input.dueLabel || (kind === 'sales-order' ? 'Delivery date' : 'Valid until'), fmtDate(input.dueDate)] as [string, string]] : []),
    ...(input.salesperson ? [['Salesperson', input.salesperson] as [string, string]] : []),
    ...(showAmounts ? [['Currency', currency] as [string, string]] : []),
  ]
  meta.forEach((entry, index) => drawMetaRow(doc, entry[0], entry[1], rightX, y + index * 18, 92))
  y = Math.max(partyY + 14, y + Math.max(94, meta.length * 18 + 14))

  if (kind === 'proforma') {
    doc.setFillColor(...AMBER_SOFT).setDrawColor(238, 177, 92).setLineWidth(.6)
    doc.roundedRect(MARGIN, y, CONTENT_W, 28, 4, 4, 'FD')
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...AMBER)
    doc.text('!  This is a proforma invoice and not a tax invoice.', MARGIN + 12, y + 18)
    y += 40
  }

  const commercialHead = [['#', 'DESCRIPTION', 'QTY', 'UNIT', `UNIT PRICE (${currency})`, 'VAT', `AMOUNT (${currency})`]]
  const deliveryHead = [['#', 'ITEM DESCRIPTION', 'QTY', 'SERIAL / IMEI', 'SPECS', 'CONDITION']]
  let rowNo = 0
  const body = input.lines.map(item => {
    if (item.lineType === 'section') {
      return [{
        content: item.description,
        colSpan: delivery ? 6 : 7,
        styles: { fontStyle: 'bold' as const, textColor: NAVY, fillColor: SOFT },
      }]
    }
    rowNo += 1
    if (delivery) {
      return [
        String(rowNo),
        item.description,
        String(item.qty),
        item.serial || '—',
        item.specs || '—',
        '',
      ]
    }
    return [
      String(rowNo),
      item.description,
      String(item.qty),
      'Unit(s)',
      money(item.unitPrice || 0),
      item.taxRate ? `${item.taxRate}%` : '0%',
      money(item.subtotal || 0),
    ]
  })

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: 108, bottom: 62 },
    head: delivery ? deliveryHead : commercialHead,
    body: body as any,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 7.8,
      textColor: INK,
      lineColor: BORDER,
      lineWidth: .45,
      cellPadding: { top: 7, right: 6, bottom: 7, left: 6 },
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: SOFT,
      textColor: NAVY,
      fontStyle: 'bold',
      fontSize: 6.8,
      minCellHeight: 24,
      halign: 'center',
    },
    alternateRowStyles: { fillColor: [252, 253, 255] },
    columnStyles: delivery
      ? {
          0: { cellWidth: 24, halign: 'center' },
          1: { cellWidth: 150 },
          2: { cellWidth: 34, halign: 'center' },
          3: { cellWidth: 96 },
          4: { cellWidth: 'auto' },
          5: { cellWidth: 62, halign: 'center' },
        }
      : {
          0: { cellWidth: 24, halign: 'center' },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 34, halign: 'center' },
          3: { cellWidth: 48, halign: 'center' },
          4: { cellWidth: 82, halign: 'right' },
          5: { cellWidth: 38, halign: 'center' },
          6: { cellWidth: 86, halign: 'right' },
        },
    didDrawPage: data => {
      if (data.pageNumber > 1) drawLetterhead(doc, company, `${input.title.toUpperCase()} · ${input.ref}`)
    },
  })

  y = (doc as any).lastAutoTable.finalY + 14
  const notes = customerFacingNotes(input.notes) || ''

  if (showAmounts) {
    const totalRows: Array<[string, string, boolean?]> = []
    const lineDiscount = Number(input.discountTotal) || 0
    const subtotal = Number(input.subtotal) || 0
    totalRows.push(['Subtotal', `${currency} ${money(lineDiscount > 0 ? subtotal + lineDiscount : subtotal)}`])
    if (lineDiscount > 0) totalRows.push(['Discount', `- ${currency} ${money(lineDiscount)}`])
    totalRows.push(['VAT', `${currency} ${money(input.taxTotal || 0)}`])
    if (Number(input.postTaxDiscountTotal) > 0) totalRows.push(['Order discount', `- ${currency} ${money(input.postTaxDiscountTotal || 0)}`])
    totalRows.push(['TOTAL', `${currency} ${money(input.total || 0)}`, true])
    if (Number(input.amountPaid) > 0) {
      totalRows.push(['Paid', `- ${currency} ${money(input.amountPaid || 0)}`])
      totalRows.push(['BALANCE DUE', `${currency} ${money(Math.max(0, Number(input.total || 0) - Number(input.amountPaid || 0)))}`, true])
    }

    const totalH = totalRows.length * 19 + 6
    const notesLines = notes ? doc.splitTextToSize(notes, 250) as string[] : []
    const notesH = notesLines.length ? Math.max(46, notesLines.length * 10 + 26) : 0
    y = ensureRoom(doc, company, input, y, Math.max(totalH, notesH) + 12)

    if (notesLines.length) {
      writeLabel(doc, kind === 'sales-order' ? 'Fulfilment notes' : 'Notes', MARGIN, y + 10)
      doc.setFont('helvetica', 'normal').setFontSize(7.7).setTextColor(...INK)
      doc.text(notesLines, MARGIN, y + 27)
    }

    const totalsX = RIGHT - 220
    totalRows.forEach((item, index) => {
      const rowY = y + 14 + index * 19
      if (item[2]) {
        doc.setFillColor(...SOFT)
        doc.rect(totalsX - 8, rowY - 13, 228, 19, 'F')
      }
      if (item[2] && index > 0) line(doc, totalsX - 8, rowY - 13, RIGHT, BORDER, .55)
      doc.setFont('helvetica', item[2] ? 'bold' : 'normal').setFontSize(item[2] ? 9.5 : 8).setTextColor(...INK)
      doc.text(item[0], totalsX, rowY)
      doc.text(item[1], RIGHT - 6, rowY, { align: 'right' })
    })
    y += Math.max(totalH, notesH) + 12
  } else if (notes) {
    const wrapped = doc.splitTextToSize(notes, CONTENT_W - 10) as string[]
    y = ensureRoom(doc, company, input, y, wrapped.length * 10 + 34)
    writeLabel(doc, 'Delivery notes', MARGIN, y + 10)
    doc.setFont('helvetica', 'normal').setFontSize(7.8).setTextColor(...INK)
    doc.text(wrapped, MARGIN, y + 27)
    y += wrapped.length * 10 + 38
  }

  if (input.showPaymentDetails ?? (showAmounts && kind !== 'quotation' && kind !== 'sales-order')) {
    const payment = defaultPaymentLines(input, company, bankAccounts)
    if (payment.length) {
      const paymentH = Math.max(56, Math.ceil(payment.length / 2) * 14 + 30)
      y = ensureRoom(doc, company, input, y, paymentH + 12)
      line(doc, MARGIN, y, RIGHT, BORDER, .55)
      writeLabel(doc, 'Payment instructions', MARGIN, y + 18)
      const midpoint = Math.ceil(payment.length / 2)
      payment.forEach((entry, index) => {
        const isRight = index >= midpoint
        const itemIndex = isRight ? index - midpoint : index
        const x = isRight ? MARGIN + CONTENT_W / 2 + 12 : MARGIN
        doc.setFont('helvetica', /BANK|M-PESA|PAYMENT/i.test(entry) ? 'bold' : 'normal')
          .setFontSize(7.5)
          .setTextColor(...INK)
        doc.text(entry, x, y + 36 + itemIndex * 13, { maxWidth: CONTENT_W / 2 - 24 })
      })
      y += paymentH
    }
  }

  const showSignature = input.showSignature ?? true
  const showAck = input.showReceiptAcknowledgement ?? delivery
  if (showAck) {
    y = ensureRoom(doc, company, input, y, 108)
    line(doc, MARGIN, y, RIGHT, BORDER, .55)
    writeLabel(doc, 'Receipt acknowledgement', MARGIN, y + 18)
    const half = CONTENT_W / 2 - 16
    const fields: Array<[string, string, number, number]> = [
      ['Received by', input.attention || '', MARGIN, y + 48],
      ['ID / Passport No.', input.recipientIdNumber || '', MARGIN + half + 32, y + 48],
      ['Signature', '', MARGIN, y + 84],
      ['Date received', '', MARGIN + half + 32, y + 84],
    ]
    fields.forEach(([label, value, x, rowY]) => {
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED)
      doc.text(label, x, rowY - 10)
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...INK)
      doc.text(value, x, rowY)
      line(doc, x, rowY + 5, x + half, BORDER, .55)
    })
    y += 102
  } else if (showSignature && kind !== 'quotation' && kind !== 'proforma' && kind !== 'invoice' && kind !== 'bill' && kind !== 'receipt') {
    y = ensureRoom(doc, company, input, y, 102)
    line(doc, MARGIN, y, RIGHT, BORDER, .55)
    writeLabel(doc, 'Authorised by', MARGIN, y + 18)
    writeLabel(doc, 'Received by', MARGIN + CONTENT_W / 2 + 14, y + 18)
    const leftWidth = CONTENT_W / 2 - 14
    const signatureFields = ['Signature', 'Name', 'Date']
    signatureFields.forEach((label, index) => {
      const rowY = y + 42 + index * 18
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED)
      doc.text(`${label}:`, MARGIN, rowY)
      line(doc, MARGIN + 48, rowY + 2, MARGIN + leftWidth, BORDER, .55)
      const rx = MARGIN + CONTENT_W / 2 + 14
      doc.text(`${label}:`, rx, rowY)
      line(doc, rx + 48, rowY + 2, RIGHT, BORDER, .55)
    })
    y += 98
  }

  if (kind === 'proforma') {
    y = ensureRoom(doc, company, input, y, 54)
    writeLabel(doc, 'Important', MARGIN, y + 12)
    doc.setFont('helvetica', 'normal').setFontSize(7.7).setTextColor(...INK)
    doc.text('This proforma invoice is valid until the expiry date stated above.', MARGIN, y + 29)
    doc.text('Full payment must be received before goods or services are delivered.', MARGIN, y + 42)
  }

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    drawFooter(doc, company, input, page, pages)
  }

  return doc
}

export function deedPdfToBuffer(doc: jsPDF): Uint8Array<ArrayBuffer> {
  const output = doc.output('arraybuffer') as ArrayBuffer
  return new Uint8Array(output)
}
