/**
 * Deed Technologies commercial document family.
 * One clean A4 system for quotation, sales order, proforma invoice,
 * tax invoice, bill, receipt and delivery note.
 */

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { customerFacingNotes } from '@/lib/customer-facing-notes'
import {
  normalizeDocumentBackground,
  normalizeDocumentFont,
  normalizeDocumentLayout,
  normalizeHexColor,
  normalizePaperFormat,
  type DocumentBackgroundId,
  type DocumentFontId,
  type DocumentLayoutId,
  type DocumentPaperFormat,
} from '@/lib/document-layout'

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

interface DeedPdfCompany {
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
  printTemplate?: DocumentLayoutId | 'classic' | 'light' | 'modern' | 'compact'
  printFont?: DocumentFontId
  printBackground?: DocumentBackgroundId
  printPrimaryColor?: string
  printSecondaryColor?: string
  printTagline?: string
  printPaperFormat?: DocumentPaperFormat
  logoDataUrl?: string
  logoWidth?: number
  logoHeight?: number
  logoFormat?: 'PNG' | 'JPEG'
}

interface DeedPdfBank {
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
  customerPoNumber?: string
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

const MARGIN = 34
const pageW = (doc: jsPDF) => doc.internal.pageSize.getWidth()
const pageH = (doc: jsPDF) => doc.internal.pageSize.getHeight()
const right = (doc: jsPDF) => pageW(doc) - MARGIN
const contentW = (doc: jsPDF) => pageW(doc) - MARGIN * 2
const bodyBottom = (doc: jsPDF) => pageH(doc) - 54

const NAVY: [number, number, number] = [32, 22, 77]
const INK: [number, number, number] = [7, 22, 76]
const CYAN: [number, number, number] = [0, 174, 239]
const BLUE: [number, number, number] = [7, 139, 212]
const MUTED: [number, number, number] = [91, 107, 128]
const BORDER: [number, number, number] = [205, 219, 232]
const SOFT: [number, number, number] = [246, 250, 253]
function hexRgb(value: unknown, fallback: string): [number, number, number] {
  const color = normalizeHexColor(value, fallback)
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ]
}

function layoutAccent(_layout: DocumentLayoutId, company: DeedPdfCompany): [number, number, number] {
  return hexRgb(company.printPrimaryColor, '#1B2762')
}

function layoutSecondary(company: DeedPdfCompany): [number, number, number] {
  return hexRgb(company.printSecondaryColor, '#00AEEF')
}

function pdfFont(value: unknown): 'helvetica' | 'times' | 'courier' {
  const font = normalizeDocumentFont(value)
  if (font === 'times') return 'times'
  if (font === 'courier') return 'courier'
  return 'helvetica'
}

function drawDocumentBackground(doc: jsPDF, company: DeedPdfCompany) {
  if (normalizeDocumentBackground(company.printBackground) !== 'demo_logo' || !company.name) return
  const primary = hexRgb(company.printPrimaryColor, '#1B2762')
  const pale = primary.map(channel => Math.round(channel + (255 - channel) * .92)) as [number, number, number]
  doc.setFont(pdfFont(company.printFont), 'bold').setFontSize(58).setTextColor(...pale)
  doc.text(company.name, pageW(doc) / 2, pageH(doc) / 2, { align: 'center', angle: 32 })
}

const money = (value: number) =>
  Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (value?: string) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric' })
}

const cleanWebsite = (value?: string) =>
  (value || '').replace(/^https?:\/\//i, '').replace(/\/$/, '')

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

function drawLogo(doc: jsPDF, company: DeedPdfCompany, inverse = false) {
  const maxW = 154
  const maxH = 56
  if (company.logoDataUrl && company.logoWidth && company.logoHeight) {
    const scale = Math.min(maxW / company.logoWidth, maxH / company.logoHeight)
    try {
      doc.addImage(
        company.logoDataUrl,
        company.logoFormat || 'PNG',
        MARGIN,
        15,
        company.logoWidth * scale,
        company.logoHeight * scale,
      )
      return
    } catch {
      // Fall through to the clean text mark only if the configured image is unreadable.
    }
  }
  doc.setFont('helvetica', 'bold').setFontSize(26).setTextColor(...(inverse ? [255, 255, 255] as [number, number, number] : NAVY))
  doc.text('deed', MARGIN, 50)
  doc.setFontSize(6.5).setTextColor(...(inverse ? [255, 255, 255] as [number, number, number] : CYAN))
  doc.text('TECHNOLOGIES', MARGIN + 8, 61)
}

function drawLetterhead(doc: jsPDF, company: DeedPdfCompany, continuation?: string) {
  const layout = normalizeDocumentLayout(company.printTemplate)
  const primary = layoutAccent(layout, company)
  const secondary = layoutSecondary(company)
  const inverse = layout === 'bold' || layout === 'folder'

  if (layout === 'bold') {
    doc.setFillColor(...primary).rect(0, 0, pageW(doc), 84, 'F')
    doc.setFillColor(...secondary).rect(0, 80, pageW(doc), 4, 'F')
  } else if (layout === 'boxed') {
    doc.setDrawColor(...primary).setLineWidth(1.1).roundedRect(MARGIN - 8, 14, contentW(doc) + 16, 62, 3, 3, 'S')
  } else if (layout === 'striped') {
    doc.setFillColor(...primary).rect(0, 0, pageW(doc), 5, 'F')
    doc.setFillColor(...secondary).rect(0, 8, pageW(doc) * .68, 2, 'F')
  } else if (layout === 'bubble') {
    doc.setFillColor(...primary).circle(pageW(doc) + 8, -5, 58, 'F')
    doc.setFillColor(...secondary).circle(pageW(doc) - 68, -15, 23, 'F')
  } else if (layout === 'wave') {
    doc.setFillColor(...primary).ellipse(pageW(doc) - 70, -28, 150, 72, 'F')
    doc.setFillColor(...secondary).ellipse(pageW(doc) - 18, -22, 112, 52, 'F')
  } else if (layout === 'folder') {
    doc.setFillColor(...primary).rect(0, 0, pageW(doc) * .43, 84, 'F')
    doc.setFillColor(...secondary).rect(pageW(doc) * .43, 0, pageW(doc) * .57, 84, 'F')
    doc.setFillColor(...primary).lines([[28, 0], [-20, 84], [-28, 0]], pageW(doc) * .4, 0, [1, 1], 'F', true)
  }

  drawLogo(doc, company, inverse)
  const details = [
    [company.address, company.city].filter(Boolean).join(', '),
    company.phone,
    company.email,
    cleanWebsite(company.website),
    company.kraPin ? `KRA PIN: ${company.kraPin}` : '',
  ].filter(Boolean) as string[]

  const headerText = inverse ? ([255, 255, 255] as [number, number, number]) : INK
  doc.setFont(pdfFont(company.printFont), 'normal').setFontSize(7.4).setTextColor(...headerText)
  details.slice(0, 5).forEach((item, index) => doc.text(item, right(doc), 25 + index * 11, { align: 'right' }))

  if (company.printTagline) {
    doc.setFont(pdfFont(company.printFont), 'italic').setFontSize(7).setTextColor(...(inverse ? [255, 255, 255] as [number, number, number] : secondary))
    doc.text(company.printTagline, MARGIN, 70, { maxWidth: 240 })
  }

  if (layout === 'standard') {
    line(doc, MARGIN, 76, right(doc), primary, 1.15)
  } else if (layout === 'striped') {
    line(doc, MARGIN, 76, right(doc), primary, 2.8)
    line(doc, MARGIN, 81, right(doc), secondary, .9)
  } else if (!inverse && layout !== 'boxed') {
    line(doc, MARGIN, 78, right(doc), primary, 1)
  }

  if (continuation) {
    doc.setFont(pdfFont(company.printFont), 'bold').setFontSize(8).setTextColor(...primary)
    doc.text(continuation, MARGIN, 96)
  }
}
function drawFooter(doc: jsPDF, company: DeedPdfCompany, input: DeedPdfInput, page: number, pages: number) {
  const layout = normalizeDocumentLayout(company.printTemplate)
  const primary = layoutAccent(layout, company)
  const secondary = layoutSecondary(company)
  if (layout === 'wave') {
    doc.setFillColor(...primary).ellipse(70, pageH(doc) + 24, 155, 55, 'F')
    doc.setFillColor(...secondary).ellipse(12, pageH(doc) + 18, 105, 38, 'F')
  }
  line(doc, MARGIN, pageH(doc) - 38, right(doc), layout === 'bold' ? secondary : primary, layout === 'bold' ? 2 : .8)
  doc.setFont(pdfFont(company.printFont), 'normal').setFontSize(7).setTextColor(...MUTED)
  doc.text(company.invoiceFooter || '', MARGIN, pageH(doc) - 22, { maxWidth: contentW(doc) * .58 })
  doc.text(`Page ${page} of ${pages}`, pageW(doc) / 2, pageH(doc) - 22, { align: 'center' })
  doc.setFont(pdfFont(company.printFont), 'bold').setFontSize(6.5).setTextColor(...primary)
  doc.text([input.ref, cleanWebsite(company.website)].filter(Boolean).join(' · '), right(doc), pageH(doc) - 22, { align: 'right' })
}
function pageBreak(doc: jsPDF, company: DeedPdfCompany, input: DeedPdfInput) {
  doc.addPage()
  drawDocumentBackground(doc, company)
  drawLetterhead(doc, company, `${input.title.toUpperCase()} · ${input.ref}`)
  return 108
}

function ensureRoom(doc: jsPDF, company: DeedPdfCompany, input: DeedPdfInput, y: number, needed: number) {
  return y + needed > bodyBottom(doc) ? pageBreak(doc, company, input) : y
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
  bankAccountsInput: DeedPdfBank[] = [],
): jsPDF {
  // A saved bank list that is missing or not a list (an empty settings
  // value) crashed every PDF at "banks.find" — the customer portal's invoice
  // download returned nothing.
  const bankAccounts: DeedPdfBank[] = Array.isArray(bankAccountsInput) ? bankAccountsInput.filter(Boolean) : []
  const doc = new jsPDF({ unit: 'pt', format: normalizePaperFormat(company.printPaperFormat) })
  const selectedFont = pdfFont(company.printFont)
  const originalSetFont = doc.setFont.bind(doc)
  doc.setFont = ((_: string, style?: string) => originalSetFont(selectedFont, style)) as typeof doc.setFont
  const kind = titleKind(input.title)
  const delivery = Boolean(input.deliveryNoteLayout) || kind === 'delivery'
  const showAmounts = !input.hideAmounts
  const currency = company.currency || 'KES'
  const customerLabel = partyLabelFor(input)
  const layout = normalizeDocumentLayout(company.printTemplate)
  const accent = layoutAccent(layout, company)
  const stripeFill = accent.map(channel => Math.round(channel + (255 - channel) * .95)) as [number, number, number]

  drawDocumentBackground(doc, company)
  drawLetterhead(doc, company)

  let y = 112
  if (layout === 'bold') {
    doc.setFillColor(...accent).roundedRect(MARGIN, y - 22, contentW(doc), 34, 3, 3, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(19).setTextColor(255, 255, 255)
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(21).setTextColor(...accent)
  }
  doc.text(input.title.toUpperCase(), MARGIN + (layout === 'bold' ? 10 : 0), y)

  y += 24
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...NAVY)
  doc.text(input.ref, MARGIN, y)
  // Dates are presented once in the document metadata block below. The former
  // top-right date repeated Due Date / Valid Until and created conflicting facts.
  y += 28
  const leftX = MARGIN + 10
  const splitX = MARGIN + 232
  const rightX = splitX + 18
  if (layout === 'boxed' || layout === 'bubble' || layout === 'folder') {
    doc.setFillColor(...(layout === 'bubble' ? [242, 249, 249] as [number, number, number] : SOFT))
    doc.setDrawColor(...accent).setLineWidth(.55).roundedRect(MARGIN, y - 10, contentW(doc), 112, layout === 'bubble' ? 12 : 3, layout === 'bubble' ? 12 : 3, 'FD')
  }
  writeLabel(doc, customerLabel, leftX, y)
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK)
  doc.text(input.customerName || '—', leftX, y + 17, { maxWidth: 195 })
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
    ...(input.customerPoNumber ? [['Customer PO', input.customerPoNumber] as [string, string]] : []),
    ...(input.dueDate ? [[input.dueLabel || (kind === 'sales-order' ? 'Delivery date' : 'Valid until'), fmtDate(input.dueDate)] as [string, string]] : []),
    ...(input.salesperson ? [['Salesperson', input.salesperson] as [string, string]] : []),
    ...(showAmounts ? [['Currency', currency] as [string, string]] : []),
  ]
  meta.forEach((entry, index) => drawMetaRow(doc, entry[0], entry[1], rightX, y + index * 18, 92))
  y = Math.max(partyY + 14, y + Math.max(94, meta.length * 18 + 14))

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
    theme: layout === 'standard' ? 'plain' : 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 7.8,
      textColor: INK,
      lineColor: layout === 'boxed' ? accent : BORDER,
      lineWidth: layout === 'boxed' ? .65 : .45,
      cellPadding: { top: 7, right: 6, bottom: 7, left: 6 },
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: layout === 'standard' ? [255, 255, 255] : accent,
      textColor: layout === 'standard' ? accent : [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 6.8,
      minCellHeight: 24,
      halign: 'center',
    },
    alternateRowStyles: { fillColor: layout === 'striped' ? stripeFill : [252, 253, 255] },
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

    const totalsX = right(doc) - 220
    totalRows.forEach((item, index) => {
      const rowY = y + 14 + index * 19
      if (item[2]) {
        doc.setFillColor(...SOFT)
        doc.rect(totalsX - 8, rowY - 13, 228, 19, 'F')
      }
      if (item[2] && index > 0) line(doc, totalsX - 8, rowY - 13, right(doc), BORDER, .55)
      doc.setFont('helvetica', item[2] ? 'bold' : 'normal').setFontSize(item[2] ? 9.5 : 8).setTextColor(...INK)
      doc.text(item[0], totalsX, rowY)
      doc.text(item[1], right(doc) - 6, rowY, { align: 'right' })
    })
    y += Math.max(totalH, notesH) + 12
  } else if (notes) {
    const wrapped = doc.splitTextToSize(notes, contentW(doc) - 10) as string[]
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
      // Keep payment instructions visually separate from invoice totals. Short
      // invoices place this block lower on the page; longer invoices still flow
      // naturally or move to a continuation page through ensureRoom().
      y = Math.max(y, 540)
      y = ensureRoom(doc, company, input, y, paymentH + 12)
      line(doc, MARGIN, y, right(doc), BORDER, .55)
      writeLabel(doc, 'Payment instructions', MARGIN, y + 18)
      const midpoint = Math.ceil(payment.length / 2)
      payment.forEach((entry, index) => {
        const isRight = index >= midpoint
        const itemIndex = isRight ? index - midpoint : index
        const x = isRight ? MARGIN + contentW(doc) / 2 + 12 : MARGIN
        doc.setFont('helvetica', /BANK|M-PESA|PAYMENT/i.test(entry) ? 'bold' : 'normal')
          .setFontSize(7.5)
          .setTextColor(...INK)
        doc.text(entry, x, y + 36 + itemIndex * 13, { maxWidth: contentW(doc) / 2 - 24 })
      })
      y += paymentH
    }
  }

  const showSignature = input.showSignature ?? true
  const showAck = input.showReceiptAcknowledgement ?? delivery
  if (showAck) {
    y = ensureRoom(doc, company, input, y, 108)
    line(doc, MARGIN, y, right(doc), BORDER, .55)
    writeLabel(doc, 'Receipt acknowledgement', MARGIN, y + 18)
    const half = contentW(doc) / 2 - 16
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
    line(doc, MARGIN, y, right(doc), BORDER, .55)
    writeLabel(doc, 'Authorised by', MARGIN, y + 18)
    writeLabel(doc, 'Received by', MARGIN + contentW(doc) / 2 + 14, y + 18)
    const leftWidth = contentW(doc) / 2 - 14
    const signatureFields = ['Signature', 'Name', 'Date']
    signatureFields.forEach((label, index) => {
      const rowY = y + 42 + index * 18
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED)
      doc.text(`${label}:`, MARGIN, rowY)
      line(doc, MARGIN + 48, rowY + 2, MARGIN + leftWidth, BORDER, .55)
      const rx = MARGIN + contentW(doc) / 2 + 14
      doc.text(`${label}:`, rx, rowY)
      line(doc, rx + 48, rowY + 2, right(doc), BORDER, .55)
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

export type DeedPdfCompanyInput = DeedPdfCompany

export interface DeedStatementInput {
  side: 'customer' | 'supplier'
  /** Shown in the footer and used as the payment reference. */
  ref: string
  statementDate: string
  periodLabel: string
  partyName: string
  partyPhone?: string
  partyEmail?: string
  partyTaxId?: string
  partyAddress?: string
  /** Balance before the period; null for "all time". */
  opening: number | null
  periodCharges: number
  periodPayments: number
  closing: number
  overdue: number
  aging: Array<[string, number]>
  lines: Array<{ date: string; type: string; ref: string; details: string; charge: number; payment: number; balance: number }>
  openItems: Array<{ ref: string; date: string; dueDate: string; daysOverdue: number; total: number; paid: number; balance: number }>
  /** Credit in the party's favour not yet used (store credit, credit notes). */
  creditAvailable?: number
}

/** A statement of account on the company letterhead: summary, aging, every movement, and what is still open. */
export function buildDeedStatementPdf(
  input: DeedStatementInput,
  company: DeedPdfCompany,
  bankAccountsInput: DeedPdfBank[] = [],
): jsPDF {
  const banks: DeedPdfBank[] = Array.isArray(bankAccountsInput) ? bankAccountsInput.filter(Boolean) : []
  const doc = new jsPDF({ unit: 'pt', format: normalizePaperFormat(company.printPaperFormat) })
  const selectedFont = pdfFont(company.printFont)
  const originalSetFont = doc.setFont.bind(doc)
  doc.setFont = ((_: string, style?: string) => originalSetFont(selectedFont, style)) as typeof doc.setFont
  const currency = company.currency || 'KES'
  const layout = normalizeDocumentLayout(company.printTemplate)
  const accent = layoutAccent(layout, company)
  const customer = input.side === 'customer'
  const title = customer ? 'Statement of account' : 'Supplier statement'
  const pseudo = { title, ref: input.ref } as DeedPdfInput
  const words = customer
    ? { charge: 'INVOICED', payment: 'RECEIVED', closing: 'BALANCE DUE', party: 'Statement for' }
    : { charge: 'BILLED', payment: 'PAID', closing: 'WE OWE', party: 'Supplier' }

  drawDocumentBackground(doc, company)
  drawLetterhead(doc, company)

  let y = 112
  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...accent)
  doc.text(title.toUpperCase(), MARGIN, y)
  y += 26

  // Party (left) and statement details (right)
  const leftX = MARGIN
  const rightX = MARGIN + contentW(doc) * 0.58
  writeLabel(doc, words.party, leftX, y)
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK)
  doc.text(input.partyName || '—', leftX, y + 16, { maxWidth: rightX - leftX - 20 })
  let partyY = y + 31
  ;[input.partyAddress, input.partyPhone ? `Phone: ${input.partyPhone}` : '', input.partyEmail ? `Email: ${input.partyEmail}` : '', input.partyTaxId ? `PIN: ${input.partyTaxId}` : '']
    .filter(Boolean)
    .forEach(v => { writeValue(doc, String(v), leftX, partyY, { maxWidth: rightX - leftX - 20 }); partyY += 12 })
  drawMetaRow(doc, 'Statement date', fmtDate(input.statementDate), rightX, y, 84)
  drawMetaRow(doc, 'Period', input.periodLabel, rightX, y + 17, 84)
  drawMetaRow(doc, 'Currency', currency, rightX, y + 34, 84)
  y = Math.max(partyY, y + 48) + 12

  // Summary boxes
  const boxes: Array<[string, number, boolean?]> = [
    ...(input.opening != null ? [['BROUGHT FORWARD', input.opening] as [string, number]] : []),
    [words.charge, input.periodCharges],
    [words.payment, input.periodPayments],
    [words.closing, input.closing, true],
  ]
  const gap = 8
  const boxW = (contentW(doc) - gap * (boxes.length - 1)) / boxes.length
  boxes.forEach(([label, value, strong], i) => {
    const x = MARGIN + i * (boxW + gap)
    if (strong) doc.setFillColor(...accent)
    else doc.setFillColor(...SOFT)
    doc.setDrawColor(...(strong ? accent : BORDER)).setLineWidth(.5).roundedRect(x, y, boxW, 44, 4, 4, 'FD')
    doc.setFont('helvetica', 'bold').setFontSize(6.6).setTextColor(...(strong ? [255, 255, 255] as [number, number, number] : MUTED))
    doc.text(label, x + 9, y + 14)
    doc.setFont('helvetica', 'bold').setFontSize(strong ? 12 : 10.5).setTextColor(...(strong ? [255, 255, 255] as [number, number, number] : INK))
    doc.text(`${currency} ${money(value)}`, x + 9, y + 33, { maxWidth: boxW - 14 })
  })
  y += 58

  if (input.overdue > 0.005 || input.aging.some(([, v]) => v > 0.005)) {
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: 108, bottom: 62 },
      head: [input.aging.map(([label]) => label.toUpperCase())],
      body: [input.aging.map(([, v]) => money(v))],
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, textColor: INK, lineColor: BORDER, lineWidth: .45, halign: 'center', cellPadding: 5 },
      headStyles: { fillColor: SOFT, textColor: MUTED, fontStyle: 'bold', fontSize: 6.5 },
    })
    y = (doc as any).lastAutoTable.finalY + 16
  }

  // Movements
  writeLabel(doc, 'Transactions', MARGIN, y)
  y += 6
  const body: any[] = []
  if (input.opening != null) {
    body.push([{ content: 'Balance brought forward', colSpan: 6, styles: { fontStyle: 'bold', fillColor: SOFT } }, { content: money(input.opening), styles: { fontStyle: 'bold', fillColor: SOFT } }])
  }
  input.lines.forEach(l => body.push([
    fmtDate(l.date), l.type, l.ref, l.details,
    l.charge ? money(l.charge) : '', l.payment ? money(l.payment) : '', money(l.balance),
  ]))
  if (!input.lines.length) body.push([{ content: 'No transactions in this period.', colSpan: 7, styles: { textColor: MUTED, halign: 'center' } }])
  body.push([
    { content: 'Totals for the period', colSpan: 4, styles: { fontStyle: 'bold' } },
    { content: money(input.periodCharges), styles: { fontStyle: 'bold' } },
    { content: money(input.periodPayments), styles: { fontStyle: 'bold' } },
    { content: money(input.closing), styles: { fontStyle: 'bold' } },
  ])
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: 108, bottom: 62 },
    head: [['DATE', 'TYPE', 'DOCUMENT', 'DETAILS', words.charge, words.payment, 'BALANCE']],
    body,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 7.6, textColor: INK, lineColor: BORDER, lineWidth: { bottom: .4 } as any, cellPadding: { top: 5, right: 5, bottom: 5, left: 5 }, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: accent, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.6 },
    columnStyles: {
      0: { cellWidth: 56 },
      1: { cellWidth: 56 },
      2: { cellWidth: 74 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 66, halign: 'right' },
      5: { cellWidth: 66, halign: 'right' },
      6: { cellWidth: 72, halign: 'right' },
    },
    didParseCell: data => { if (data.section === 'head' && data.column.index >= 4) data.cell.styles.halign = 'right' },
    didDrawPage: data => { if (data.pageNumber > 1) drawLetterhead(doc, company, `${title.toUpperCase()} · ${input.partyName}`) },
  })
  y = (doc as any).lastAutoTable.finalY + 18

  if (input.openItems.length) {
    y = ensureRoom(doc, company, pseudo, y, 60)
    writeLabel(doc, customer ? 'Unpaid invoices' : 'Unpaid bills', MARGIN, y)
    y += 6
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: 108, bottom: 62 },
      head: [['DOCUMENT', 'DATE', 'DUE', 'OVERDUE BY', 'TOTAL', words.payment, 'STILL OWED']],
      body: [
        ...input.openItems.map(o => [o.ref, fmtDate(o.date), fmtDate(o.dueDate), o.daysOverdue > 0 ? `${o.daysOverdue} days` : 'Not yet due', money(o.total), o.paid ? money(o.paid) : '', money(o.balance)]),
        [{ content: 'Total still owed', colSpan: 6, styles: { fontStyle: 'bold' } }, { content: money(input.openItems.reduce((s, o) => s + o.balance, 0)), styles: { fontStyle: 'bold' } }],
      ] as any,
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 7.6, textColor: INK, lineColor: BORDER, lineWidth: { bottom: .4 } as any, cellPadding: 5 },
      headStyles: { fillColor: SOFT, textColor: MUTED, fontStyle: 'bold', fontSize: 6.6 },
      columnStyles: { 3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      didParseCell: data => { if (data.section === 'head' && data.column.index >= 3) data.cell.styles.halign = data.column.index === 3 ? 'center' : 'right' },
      didDrawPage: data => { if (data.pageNumber > 1) drawLetterhead(doc, company, `${title.toUpperCase()} · ${input.partyName}`) },
    })
    y = (doc as any).lastAutoTable.finalY + 16
  }

  if ((input.creditAvailable ?? 0) > 0.005) {
    y = ensureRoom(doc, company, pseudo, y, 30)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...INK)
    doc.text(customer
      ? `Credit available to you: ${currency} ${money(input.creditAvailable!)} (can be used on your next invoice).`
      : `Credit owed to us by ${input.partyName}: ${currency} ${money(input.creditAvailable!)}.`, MARGIN, y + 8)
    y += 22
  }

  if (customer && input.closing > 0.005) {
    const payment = defaultPaymentLines({ ...pseudo, paymentCommunication: true } as DeedPdfInput, company, banks)
    if (payment.length) {
      const paymentH = Math.max(56, Math.ceil(payment.length / 2) * 14 + 30)
      y = ensureRoom(doc, company, pseudo, y, paymentH + 12)
      line(doc, MARGIN, y, right(doc), BORDER, .55)
      writeLabel(doc, 'How to pay', MARGIN, y + 18)
      const midpoint = Math.ceil(payment.length / 2)
      payment.forEach((entry, index) => {
        const isRight = index >= midpoint
        const x = isRight ? MARGIN + contentW(doc) / 2 + 12 : MARGIN
        doc.setFont('helvetica', /BANK|M-PESA|PAYMENT/i.test(entry) ? 'bold' : 'normal').setFontSize(7.5).setTextColor(...INK)
        doc.text(entry, x, y + 36 + (isRight ? index - midpoint : index) * 13, { maxWidth: contentW(doc) / 2 - 24 })
      })
      y += paymentH
    }
  }

  y = ensureRoom(doc, company, pseudo, y, 30)
  doc.setFont('helvetica', 'italic').setFontSize(7.2).setTextColor(...MUTED)
  doc.text(customer
    ? 'If your records differ from this statement, please contact our accounts team within 14 days.'
    : 'Please let us know if your records differ from this statement.', MARGIN, y + 10, { maxWidth: contentW(doc) })

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    drawFooter(doc, company, pseudo, page, pages)
  }
  return doc
}
