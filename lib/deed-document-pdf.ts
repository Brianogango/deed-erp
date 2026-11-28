/**
 * Deed Technologies commercial document family.
 * One clean A4 system for quotation, sales order, proforma invoice,
 * tax invoice, bill, receipt and delivery note.
 */

import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
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
import { layoutSpec, layoutDensity } from '@/lib/document-layout-spec'

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
  /** Machines sold under warranty: a line each with a QR to the live check. */
  warranties?: DeedPdfWarranty[]
  /** An exchange: the machines handed back and given, drawn above the items. */
  exchange?: DeedPdfExchange
}

export interface DeedPdfExchangeMachine {
  productName: string
  specs?: string
  serial?: string
  qty: number
  amount: number
}

export interface DeedPdfExchange {
  ref: string
  returned: DeedPdfExchangeMachine[]
  given: DeedPdfExchangeMachine[]
}

export interface DeedPdfWarranty {
  ref: string
  productName: string
  serialNumber: string
  endDate: string
  months?: number
  /** Opened by the QR: the warranty check page. */
  url: string
  /** Given on an exchange in place of this serial. */
  exchangeRef?: string
  replacesSerialNumber?: string
}

export const MARGIN = 34
const pageW = (doc: jsPDF) => doc.internal.pageSize.getWidth()
const pageH = (doc: jsPDF) => doc.internal.pageSize.getHeight()
export const right = (doc: jsPDF) => pageW(doc) - MARGIN
export const contentW = (doc: jsPDF) => pageW(doc) - MARGIN * 2
const bodyBottom = (doc: jsPDF) => pageH(doc) - 54

const NAVY: [number, number, number] = [32, 22, 77]
export const INK: [number, number, number] = [7, 22, 76]
const CYAN: [number, number, number] = [0, 174, 239]
const BLUE: [number, number, number] = [7, 139, 212]
export const MUTED: [number, number, number] = [91, 107, 128]
export const BORDER: [number, number, number] = [205, 219, 232]
export const SOFT: [number, number, number] = [246, 250, 253]
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

export const money = (value: number) =>
  Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtDate = (value?: string) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric' })
}

const cleanWebsite = (value?: string) =>
  (value || '').replace(/^https?:\/\//i, '').replace(/\/$/, '')

const titleKind = (title: string) => {
  const value = title.toLowerCase().replace(/-/g, '')
  if (value.includes('exchange note')) return 'exchange'
  if (value.includes('proforma')) return 'proforma'
  if (value.includes('quotation') || value.includes('quote')) return 'quotation'
  if (value.includes('sales order') || value.includes('sale order')) return 'sales-order'
  if (value.includes('delivery')) return 'delivery'
  if (value.includes('receipt')) return 'receipt'
  if (value.includes('bill')) return 'bill'
  return 'invoice'
}

/**
 * The one figure a document closes on, if it has one.
 *
 * An invoice closes on what is still owed; a receipt closes on what was
 * received, which is the whole reason the reader keeps it. A quotation is not
 * a demand for money and an invoice settled in full has nothing outstanding,
 * so neither gets a band — it would be a claim on the reader that is not true.
 */
export function closingFigure(
  kind: ReturnType<typeof titleKind>,
  balance: number,
  paid: number,
  partlyPaid: boolean,
): { label: string; when: string; amount: number } | null {
  if (kind === 'receipt') {
    return paid > 0 ? { label: 'Amount received', when: '', amount: paid } : null
  }
  // An exchange note records a swap; any balance is settled on its invoice or as store credit.
  if (kind === 'quotation' || kind === 'proforma' || kind === 'delivery' || kind === 'exchange') return null
  if (!(balance > 0)) return null
  return { label: partlyPaid ? 'Balance due' : 'Amount due', when: '', amount: balance }
}

/** Height still owed to the page after payment instructions: an acknowledgement, a signature, or nothing. */
function closingBlockHeight(input: DeedPdfInput, kind: ReturnType<typeof titleKind>, delivery: boolean): number {
  if (input.showReceiptAcknowledgement ?? delivery) return 108
  const signed = (input.showSignature ?? true)
    && kind !== 'quotation' && kind !== 'proforma' && kind !== 'invoice' && kind !== 'bill' && kind !== 'receipt'
  return signed ? 102 : 0
}

const partyLabelFor = (input: DeedPdfInput) => {
  if (input.partyLabel) return input.partyLabel
  const kind = titleKind(input.title)
  if (kind === 'delivery') return 'DELIVER TO'
  if (kind === 'receipt') return 'RECEIPT TO'
  if (kind === 'bill') return 'BILL FROM'
  return 'BILL TO'
}

export const line = (doc: jsPDF, x1: number, y: number, x2: number, color = BORDER, width = .55) => {
  doc.setDrawColor(...color).setLineWidth(width)
  doc.line(x1, y, x2, y)
}

export const writeLabel = (doc: jsPDF, text: string, x: number, y: number) => {
  doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...BLUE)
  doc.text(text.toUpperCase(), x, y)
}

export const writeValue = (doc: jsPDF, text: string, x: number, y: number, options: Record<string, unknown> = {}) => {
  doc.setFont('helvetica', 'normal').setFontSize(8.3).setTextColor(...INK)
  doc.text(text || '—', x, y, options as any)
}

/** The band the letterhead occupies, and where the logo sits inside it. */
export const LETTERHEAD_H = 96
const LOGO_TOP = 14
const LOGO_MAX_W = 190
const LOGO_MAX_H = 68

/**
 * The company mark, as large as the letterhead allows.
 *
 * A square logo is the common case (the default file is 595x595) and used to
 * come out at 56pt, barely a third of the width it was given, because the box
 * was far wider than it was tall. The box is squarer now and the band taller.
 *
 * On a letterhead that fills with the accent colour, a dark logo on a dark
 * band is close to invisible, so it is laid on a white plate. That works for
 * any logo a tenant uploads, which a second inverted file would not.
 *
 * Returns the height drawn, so the tagline can follow it instead of landing on it.
 */
function drawLogo(doc: jsPDF, company: DeedPdfCompany, inverse = false, radius = 3): number {
  // A tagline needs a line under the mark, so the mark gives some height back.
  const maxH = company.printTagline ? LOGO_MAX_H - 18 : LOGO_MAX_H
  if (company.logoDataUrl && company.logoWidth && company.logoHeight) {
    const scale = Math.min(LOGO_MAX_W / company.logoWidth, maxH / company.logoHeight)
    const w = company.logoWidth * scale
    const h = company.logoHeight * scale
    try {
      if (inverse) {
        doc.setFillColor(255, 255, 255)
        doc.roundedRect(MARGIN - 5, LOGO_TOP - 4, w + 10, h + 8, radius, radius, 'F')
      }
      doc.addImage(company.logoDataUrl, company.logoFormat || 'PNG', MARGIN, LOGO_TOP, w, h)
      return h
    } catch {
      // Fall through to the clean text mark only if the configured image is unreadable.
    }
  }
  doc.setFont('helvetica', 'bold').setFontSize(26).setTextColor(...(inverse ? [255, 255, 255] as [number, number, number] : NAVY))
  doc.text('deed', MARGIN, 50)
  doc.setFontSize(6.5).setTextColor(...(inverse ? [255, 255, 255] as [number, number, number] : CYAN))
  doc.text('TECHNOLOGIES', MARGIN + 8, 61)
  return 47
}

function drawLetterhead(doc: jsPDF, company: DeedPdfCompany, continuation?: string) {
  const layout = normalizeDocumentLayout(company.printTemplate)
  const primary = layoutAccent(layout, company)
  const secondary = layoutSecondary(company)
  const inverse = layout === 'bold' || layout === 'folder'

  if (layout === 'bold') {
    doc.setFillColor(...primary).rect(0, 0, pageW(doc), LETTERHEAD_H, 'F')
    doc.setFillColor(...secondary).rect(0, LETTERHEAD_H - 4, pageW(doc), 4, 'F')
  } else if (layout === 'boxed') {
    doc.setDrawColor(...primary).setLineWidth(1.1).roundedRect(MARGIN - 8, 9, contentW(doc) + 16, LETTERHEAD_H - 20, 3, 3, 'S')
  } else if (layout === 'striped') {
    doc.setFillColor(...primary).rect(0, 0, pageW(doc), 5, 'F')
    doc.setFillColor(...secondary).rect(0, 8, pageW(doc) * .68, 2, 'F')
  } else if (layout === 'bubble') {
    // Kept in the top corner, clear of the company details under it.
    doc.setFillColor(...primary).circle(pageW(doc) + 20, -30, 48, 'F')
    doc.setFillColor(...secondary).circle(pageW(doc) - 75, -12, 18, 'F')
  } else if (layout === 'wave') {
    doc.setFillColor(...primary).ellipse(pageW(doc) - 70, -40, 150, 54, 'F')
    doc.setFillColor(...secondary).ellipse(pageW(doc) - 18, -30, 112, 42, 'F')
  } else if (layout === 'folder') {
    doc.setFillColor(...primary).rect(0, 0, pageW(doc) * .43, LETTERHEAD_H, 'F')
    doc.setFillColor(...secondary).rect(pageW(doc) * .43, 0, pageW(doc) * .57, LETTERHEAD_H, 'F')
    doc.setFillColor(...primary).lines([[28, 0], [-20, LETTERHEAD_H], [-28, 0]], pageW(doc) * .4, 0, [1, 1], 'F', true)
  }

  const logoH = drawLogo(doc, company, inverse, normalizeDocumentLayout(company.printTemplate) === 'bubble' ? 10 : 3)
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

  // Under the mark, wherever the mark ended: a fixed baseline landed on top
  // of a tall logo.
  if (company.printTagline) {
    doc.setFont(pdfFont(company.printFont), 'italic').setFontSize(7).setTextColor(...(inverse ? [255, 255, 255] as [number, number, number] : secondary))
    doc.text(company.printTagline, MARGIN, Math.min(LOGO_TOP + logoH + 12, LETTERHEAD_H - 8), { maxWidth: 240 })
  }

  if (layout === 'standard') {
    line(doc, MARGIN, LETTERHEAD_H - 8, right(doc), primary, 1.15)
  } else if (layout === 'striped') {
    line(doc, MARGIN, LETTERHEAD_H - 8, right(doc), primary, 2.8)
    line(doc, MARGIN, LETTERHEAD_H - 3, right(doc), secondary, .9)
  } else if (!inverse && layout !== 'boxed') {
    line(doc, MARGIN, 78, right(doc), primary, 1)
  }

  if (continuation) {
    doc.setFont(pdfFont(company.printFont), 'bold').setFontSize(8).setTextColor(...primary)
    doc.text(continuation, MARGIN, LETTERHEAD_H + 12)
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

export function ensureRoom(doc: jsPDF, company: DeedPdfCompany, input: DeedPdfInput, y: number, needed: number) {
  return y + needed > bodyBottom(doc) ? pageBreak(doc, company, input) : y
}

export function drawMetaRow(doc: jsPDF, label: string, value: string, x: number, y: number, labelW = 82) {
  doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...MUTED)
  doc.text(label, x, y)
  doc.setFont('helvetica', 'normal').setFontSize(8.3).setTextColor(...INK)
  doc.text(value || '—', x + labelW, y, { maxWidth: 175 })
}

/** A QR code drawn as squares (no image, works the same in the browser and on the server). */
function drawQr(doc: jsPDF, text: string, x: number, y: number, size: number) {
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
    const n = qr.modules.size
    const cell = size / n
    doc.setFillColor(255, 255, 255).rect(x, y, size, size, 'F')
    doc.setFillColor(0, 0, 0)
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) doc.rect(x + c * cell, y + r * cell, cell + 0.05, cell + 0.05, 'F')
    }
  } catch {
    // No QR rather than no document.
  }
}

const WARRANTY_SUPPORT_LINE = 'Warranty support: 0113 704 451'

/** A serial as a CODE128 image (browser only; elsewhere the serial is printed as text). */
function serialBarcode(value: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !value.trim()) return ''
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const JsBarcode = require('jsbarcode')
    const canvas = document.createElement('canvas')
    JsBarcode(canvas, value, { format: 'CODE128', width: 2, height: 44, displayValue: false, margin: 0, background: '#FFFFFF', lineColor: '#000000' })
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

/**
 * The exchange boxes: machines handed back (left) and given (right), each with
 * its specs, serial barcode and value. Drawn above the items.
 */
function drawExchange(doc: jsPDF, company: DeedPdfCompany, input: DeedPdfInput, startY: number, showAmounts: boolean): number {
  const exc = input.exchange
  if (!exc || (!exc.returned.length && !exc.given.length)) return startY
  const gap = 22
  const boxW = (contentW(doc) - gap) / 2
  const ITEM_H = 50
  const rows = Math.max(exc.returned.length, exc.given.length, 1)
  const boxH = 22 + rows * ITEM_H
  let y = ensureRoom(doc, company, input, startY, boxH + 22)
  writeLabel(doc, `Exchange ${exc.ref}`, MARGIN, y + 4)
  y += 12
  const sides: Array<{ title: string; items: DeedPdfExchangeMachine[]; fill: [number, number, number]; edge: [number, number, number]; ink: [number, number, number] }> = [
    { title: 'RETURNED BY CUSTOMER', items: exc.returned, fill: [255, 247, 237], edge: [253, 186, 116], ink: [194, 65, 12] },
    { title: 'GIVEN TO CUSTOMER', items: exc.given, fill: [236, 253, 245], edge: [110, 231, 183], ink: [4, 120, 87] },
  ]
  sides.forEach((side, si) => {
    const x = MARGIN + si * (boxW + gap)
    doc.setFillColor(...side.fill).setDrawColor(...side.edge).setLineWidth(.6)
    doc.roundedRect(x, y, boxW, boxH, 4, 4, 'FD')
    doc.setFont('helvetica', 'bold').setFontSize(6.8).setTextColor(...side.ink)
    doc.text(side.title, x + 9, y + 13)
    side.items.forEach((m, i) => {
      const iy = y + 22 + i * ITEM_H
      doc.setFont('helvetica', 'bold').setFontSize(8.4).setTextColor(...INK)
      const name = `${m.productName}${m.qty > 1 ? ` x${m.qty}` : ''}`
      doc.text((doc.splitTextToSize(name, boxW - 18) as string[])[0] ?? '', x + 9, iy + 6)
      if (m.specs && !m.productName.includes(m.specs)) {
        doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED)
        doc.text((doc.splitTextToSize(m.specs, boxW - 18) as string[])[0] ?? '', x + 9, iy + 15)
      }
      if (m.serial) {
        const img = serialBarcode(m.serial)
        if (img) doc.addImage(img, 'PNG', x + 9, iy + 19, Math.min(110, boxW - 90), 14, undefined, 'FAST')
        doc.setFont('courier', 'bold').setFontSize(7).setTextColor(...INK)
        doc.text(m.serial, x + 9, iy + (img ? 41 : 28))
      }
      if (showAmounts) {
        doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK)
        doc.text(money(m.amount), x + boxW - 9, iy + 38, { align: 'right' })
      }
    })
  })
  doc.setDrawColor(...MUTED).setLineWidth(.8)
  const ax = MARGIN + boxW + gap / 2
  const ay = y + boxH / 2
  doc.line(ax - 6, ay, ax + 5, ay)
  doc.line(ax + 1, ay - 3.5, ax + 5, ay)
  doc.line(ax + 1, ay + 3.5, ax + 5, ay)
  return y + boxH + 14
}

/**
 * Warranty codes under the totals: one QR per machine, in a row. The items
 * above already name the machines; the code opens the live check (number,
 * cover, claim). With several machines each code has its serial under it.
 */
function drawWarranties(doc: jsPDF, company: DeedPdfCompany, input: DeedPdfInput, startY: number): number {
  const list = (input.warranties ?? []).filter(w => w && w.url)
  if (!list.length) return startY
  const qr = 58
  const gap = 22
  const caption = list.length > 1 ? 11 : 0
  const perRow = Math.max(1, Math.floor((contentW(doc) + gap) / (qr + gap)))
  const rows = Math.ceil(list.length / perRow)
  let y = ensureRoom(doc, company, input, startY, 28 + qr + caption)
  line(doc, MARGIN, y, right(doc), BORDER, .55)
  writeLabel(doc, list.length > 1 ? 'Warranties' : 'Warranty', MARGIN, y + 16)
  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED)
  doc.text(`Scan to check cover or make a claim. ${WARRANTY_SUPPORT_LINE}`, MARGIN + 70, y + 16)
  y += 24
  for (let r = 0; r < rows; r++) {
    if (r > 0) y = ensureRoom(doc, company, input, y, qr + caption + 8)
    list.slice(r * perRow, (r + 1) * perRow).forEach((w, i) => {
      const x = MARGIN + i * (qr + gap)
      drawQr(doc, w.url, x, y, qr)
      if (caption) {
        doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(...INK)
        doc.text((doc.splitTextToSize(w.serialNumber, qr + gap - 4) as string[])[0] ?? '', x + qr / 2, y + qr + 8, { align: 'center' })
      }
    })
    y += qr + caption + 8
  }
  // Machines swapped after the sale: the codes above are the machines the customer has now.
  const swaps = list.filter(w => w.exchangeRef)
  if (swaps.length) {
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED)
    for (const w of swaps) {
      y = ensureRoom(doc, company, input, y, 12)
      const text = w.replacesSerialNumber
        ? `Exchanged on ${w.exchangeRef}: serial ${w.replacesSerialNumber} replaced by ${w.serialNumber}`
        : `Exchanged on ${w.exchangeRef}: serial ${w.serialNumber} given`
      doc.text((doc.splitTextToSize(text, contentW(doc)) as string[])[0] ?? '', MARGIN, y + 6)
      y += 10
    }
  }
  return y + 4
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

  let y = BODY_TOP
  if (layout === 'bold') {
    doc.setFillColor(...accent).roundedRect(MARGIN, y - 22, contentW(doc), 34, 3, 3, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(19).setTextColor(255, 255, 255)
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(21).setTextColor(...accent)
  }
  doc.text(input.title.toUpperCase(), MARGIN + (layout === 'bold' ? 10 : 0), y)

  y += layout === 'bold' ? 32 : 24
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...NAVY)
  doc.text(input.ref, MARGIN, y)
  // Dates are presented once in the document metadata block below. The former
  // top-right date repeated Due Date / Valid Until and created conflicting facts.
  y += 28
  const spec = layoutSpec(layout)
  const density = layoutDensity(layout)
  const boxed = spec.party === 'card'
  const stacked = spec.party === 'stacked'
  const mirrored = spec.party === 'mirrored'
  // Party block starts on the page margin (in line with the title and the
  // table); inside a panel it is padded.
  const pad = boxed ? 10 : 0
  const columnW = (contentW(doc) - 32) / 2
  // Mirrored puts the references down the left edge, which is what a filed
  // copy is found by; stacked gives the customer the full width.
  const partyX = stacked ? MARGIN + pad : mirrored ? MARGIN + columnW + 32 + pad : MARGIN + pad
  const metaX = stacked ? MARGIN + pad : mirrored ? MARGIN + pad : MARGIN + columnW + 32 + pad
  const leftX = partyX
  const splitX = MARGIN + columnW + 16
  const rightX = metaX
  const partyW = stacked ? contentW(doc) - pad * 2 - 12 : columnW - pad - 14
  const meta: Array<[string, string]> = [
    ['Issue date', fmtDate(input.date)],
    ...(input.sourceRef ? [['Source document', input.sourceRef] as [string, string]] : []),
    ...(input.customerPoNumber ? [['Customer PO', input.customerPoNumber] as [string, string]] : []),
    ...(input.dueDate ? [[input.dueLabel || (kind === 'sales-order' ? 'Delivery date' : 'Valid until'), fmtDate(input.dueDate)] as [string, string]] : []),
    ...(input.salesperson ? [['Salesperson', input.salesperson] as [string, string]] : []),
    ...(showAmounts ? [['Currency', currency] as [string, string]] : []),
  ]

  // Measure everything first: a long name or address wraps, and the lines
  // under it move down instead of printing on top of it.
  const NAME_LH = 12
  const VALUE_LH = 10.5
  doc.setFont('helvetica', 'bold').setFontSize(10)
  const nameLines = (doc.splitTextToSize(input.customerName || '—', partyW) as string[]).slice(0, 3)
  doc.setFont('helvetica', 'normal').setFontSize(8.3)
  const partyBlocks = [
    input.attention ? `Attention: ${input.attention}` : '',
    input.customerAddress || '',
    input.customerCountry || '',
    input.customerPhone ? `Phone: ${input.customerPhone}` : '',
    input.customerEmail ? `Email: ${input.customerEmail}` : '',
    input.customerTaxId ? `PIN: ${input.customerTaxId}` : '',
  ].filter(Boolean).map(value => (doc.splitTextToSize(value, partyW) as string[]).slice(0, 3))
  const metaValueW = (stacked ? columnW : right(doc) - rightX - pad) - 92
  const metaBlocks = meta.map(([label, value]) => ({ label, lines: (doc.splitTextToSize(value || '—', metaValueW) as string[]).slice(0, 2) }))
  const partyH = 17 + nameLines.length * NAME_LH + 3 + partyBlocks.reduce((h, lines) => h + lines.length * VALUE_LH + 2, 0)
  const metaRowH = (m: { lines: string[] }) => Math.max(18, m.lines.length * VALUE_LH + 8)
  // Stacked runs the references in two columns beneath the customer, so it is
  // half as tall and the two blocks add up instead of sitting side by side.
  const metaColumns = stacked ? 2 : 1
  const metaSplit = Math.ceil(metaBlocks.length / metaColumns)
  const metaH = metaBlocks.slice(0, metaSplit).reduce((h, m) => h + metaRowH(m), 0)
  const blockH = stacked ? partyH + metaH + 14 : Math.max(partyH, metaH, 60)

  if (boxed) {
    doc.setFillColor(...(layout === 'bubble' ? [242, 249, 249] as [number, number, number] : SOFT))
    doc.setDrawColor(...accent).setLineWidth(.55).roundedRect(MARGIN, y - 12, contentW(doc), blockH + 18, spec.radius, spec.radius, 'FD')
  }
  writeLabel(doc, customerLabel, leftX, y)
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK)
  nameLines.forEach((text, i) => doc.text(text, leftX, y + 17 + i * NAME_LH))
  let partyY = y + 17 + nameLines.length * NAME_LH + 3
  partyBlocks.forEach(lines => {
    doc.setFont('helvetica', 'normal').setFontSize(8.3).setTextColor(...INK)
    lines.forEach((text, i) => doc.text(text, leftX, partyY + i * VALUE_LH))
    partyY += lines.length * VALUE_LH + 2
  })

  if (stacked) {
    // A rule separates the customer from the references rather than a column.
    line(doc, MARGIN, y + partyH + 2, right(doc), BORDER, .5)
  } else {
    doc.setDrawColor(...BORDER).setLineWidth(.5)
    doc.line(splitX, y - 6, splitX, y + blockH - 6)
  }
  const metaTop = stacked ? y + partyH + 20 : y
  metaBlocks.forEach((m, index) => {
    const column = Math.floor(index / metaSplit)
    const x = stacked ? MARGIN + pad + column * (columnW + 32) : rightX
    const rowsAbove = metaBlocks.slice(column * metaSplit, index)
    const rowY = metaTop + rowsAbove.reduce((h, prev) => h + metaRowH(prev), 0)
    doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...MUTED)
    doc.text(m.label, x, rowY)
    doc.setFont('helvetica', 'normal').setFontSize(8.3).setTextColor(...INK)
    m.lines.forEach((text, i) => doc.text(text, x + 92, rowY + i * VALUE_LH))
  })
  y += blockH + (boxed ? 14 : 8)
  y = drawExchange(doc, company, input, y, showAmounts)

  // No "UNIT" column: every row said "Unit(s)", so it cost width and told the
  // reader nothing. The width goes to the description, which carries the serial
  // and any discount instead.
  const commercialHead = [['#', 'DESCRIPTION', 'QTY', `UNIT PRICE (${currency})`, 'VAT', `AMOUNT (${currency})`]]
  const deliveryHead = [['#', 'ITEM DESCRIPTION', 'QTY', 'SERIAL / IMEI', 'SPECS', 'CONDITION']]
  let rowNo = 0
  const body = input.lines.map(item => {
    if (item.lineType === 'section') {
      return [{
        content: item.description,
        colSpan: 6,
        // Spans from the '#' column, which is centred; a heading reads as a
        // heading only when it starts where the descriptions do.
        styles: { fontStyle: 'bold' as const, textColor: NAVY, fillColor: SOFT, halign: 'left' as const },
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
    // A customer could not check the arithmetic on a discounted line: the
    // amount was already net of the discount but nothing on the page said so.
    // The serial matters too — it is what a warranty claim is made against.
    const discount = Number(item.discountPct) || 0
    const detail = [
      item.serial ? `Serial ${item.serial}` : '',
      discount > 0 ? `Less ${discount}% discount` : '',
    ].filter(Boolean).join('  ·  ')
    return [
      String(rowNo),
      detail ? `${item.description}\n${detail}` : item.description,
      String(item.qty),
      money(item.unitPrice || 0),
      item.taxRate ? `${item.taxRate}%` : '0%',
      money(item.subtotal || 0),
    ]
  })

  const unruledHead = spec.table === 'hairline' || spec.table === 'open'
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: BODY_TOP, bottom: 62 },
    head: delivery ? deliveryHead : commercialHead,
    body: body as any,
    // One rule under every row, fully ruled cells, banded rows, a filled
    // heading, or nothing but a rule under the heading — the table is most of
    // what a reader sees, so it is where the layouts differ most.
    theme: spec.table === 'grid' || spec.table === 'solid' ? 'grid' : 'plain',
    styles: {
      font: 'helvetica',
      fontSize: density.fontSize,
      textColor: INK,
      lineColor: spec.table === 'grid' ? accent : BORDER,
      lineWidth: spec.table === 'open' ? 0 : spec.table === 'grid' ? .65 : .45,
      cellPadding: { top: density.cellPadding, right: 6, bottom: density.cellPadding, left: 6 },
      valign: 'middle',
      overflow: 'linebreak',
    },
    // Only the keys this style needs: handing autoTable an undefined lineWidth
    // overwrote its own default and the heading row stopped drawing.
    headStyles: {
      fillColor: unruledHead ? [255, 255, 255] : accent,
      textColor: unruledHead ? accent : [255, 255, 255],
      ...(spec.table === 'open' ? { lineWidth: { bottom: 1 } as never, lineColor: accent } : {}),
      fontStyle: 'bold',
      fontSize: 6.8,
      minCellHeight: 24,
      halign: 'center',
    },
    alternateRowStyles: {
      fillColor: spec.table === 'zebra' ? stripeFill : spec.table === 'open' ? [255, 255, 255] : [252, 253, 255],
    },
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
          3: { cellWidth: 86, halign: 'right' },
          4: { cellWidth: 38, halign: 'center' },
          5: { cellWidth: 92, halign: 'right' },
        },
    // Headings line up with their column: text left, numbers right, short codes centred.
    didParseCell: data => {
      if (data.section !== 'head') return
      const col = data.column.index
      data.cell.styles.halign = delivery
        ? (col === 0 || col === 2 || col === 5 ? 'center' : 'left')
        : (col === 1 ? 'left' : col === 3 || col === 5 ? 'right' : 'center')
    },
    didDrawPage: data => {
      if (data.pageNumber > 1) drawLetterhead(doc, company, `${input.title.toUpperCase()} · ${input.ref}`)
    },
  })

  y = (doc as any).lastAutoTable.finalY + 14
  const notes = customerFacingNotes(input.notes) || ''

  if (showAmounts) {
    // The currency belongs on the figures a reader acts on, not on every row:
    // repeating it six times made none of them stand out.
    type TotalWeight = 'normal' | 'total' | 'due'
    const totalRows: Array<[string, string, TotalWeight]> = []
    const lineDiscount = Number(input.discountTotal) || 0
    const subtotal = Number(input.subtotal) || 0
    totalRows.push(['Subtotal', money(lineDiscount > 0 ? subtotal + lineDiscount : subtotal), 'normal'])
    if (lineDiscount > 0) totalRows.push(['Discount', `- ${money(lineDiscount)}`, 'normal'])
    totalRows.push(['VAT', money(input.taxTotal || 0), 'normal'])
    if (Number(input.postTaxDiscountTotal) > 0) totalRows.push(['Order discount', `- ${money(input.postTaxDiscountTotal || 0)}`, 'normal'])
    const balance = Math.max(0, Number(input.total || 0) - Number(input.amountPaid || 0))
    const partlyPaid = Number(input.amountPaid) > 0

    const band = spec.totals === 'band'

    // What to pay, and by when, in one band. Both used to read at the weight of
    // "Customer PO" halfway down the page.
    const dueBand = closingFigure(kind, balance, Number(input.amountPaid) || 0, partlyPaid)
    if (dueBand && input.dueDate && kind !== 'receipt') dueBand.when = `${input.dueLabel || 'Due'} ${fmtDate(input.dueDate)}`

    // With nothing paid the band already carries the figure, so the total stays
    // a plain rung of the ladder rather than printing the same number twice.
    totalRows.push(['Total', `${currency} ${money(input.total || 0)}`, dueBand ? 'normal' : 'total'])
    if (partlyPaid) totalRows.push(['Paid', `- ${money(input.amountPaid || 0)}`, 'normal'])
    const ROW = density.totalsRow
    const totalH = totalRows.length * ROW + 6 + (dueBand ? 44 : 0) + (spec.totals === 'card' ? 16 : 0)
    const notesLines = notes ? doc.splitTextToSize(notes, band ? contentW(doc) - 10 : 250) as string[] : []
    const notesH = notesLines.length ? Math.max(46, notesLines.length * 10 + 26) : 0
    y = ensureRoom(doc, company, input, y, Math.max(totalH, notesH) + 12)

    // Totals that run the full width leave no room beside them, so the notes
    // go above rather than underneath them.
    if (notesLines.length) {
      writeLabel(doc, kind === 'sales-order' ? 'Fulfilment notes' : 'Notes', MARGIN, y + 10)
      doc.setFont('helvetica', 'normal').setFontSize(7.7).setTextColor(...INK)
      doc.text(notesLines, MARGIN, y + 27)
      if (band) y += notesH
    }

    // A column on the right, a framed card, or the full width of the page.
    const panelW = band ? contentW(doc) : 228
    const panelX = band ? MARGIN : right(doc) - 220 - 8
    const totalsX = panelX + 8
    const padTop = spec.totals === 'card' ? 8 : 0
    if (spec.totals === 'card') {
      doc.setFillColor(255, 255, 255).setDrawColor(...BORDER).setLineWidth(.55)
      doc.roundedRect(panelX, y - 2, panelW, totalRows.length * ROW + 16 + (dueBand ? 42 : 0), spec.radius, spec.radius, 'FD')
    }
    totalRows.forEach((item, index) => {
      const rowY = y + 14 + padTop + index * ROW
      const strong = item[2] !== 'normal'
      if (strong) {
        doc.setFillColor(...SOFT)
        doc.rect(panelX, rowY - 13, panelW, ROW, 'F')
        if (index > 0) line(doc, panelX, rowY - 13, panelX + panelW, BORDER, .55)
      }
      doc.setFont('helvetica', strong ? 'bold' : 'normal').setFontSize(strong ? 9.5 : 8).setTextColor(...INK)
      doc.text(item[0], totalsX, rowY)
      doc.text(item[1], panelX + panelW - 14, rowY, { align: 'right' })
    })

    if (dueBand) {
      const bandY = y + 14 + padTop + totalRows.length * ROW - 9
      doc.setFillColor(...accent).roundedRect(panelX, bandY, panelW, 38, spec.radius || 4, spec.radius || 4, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(255, 255, 255)
      doc.text(dueBand.label.toUpperCase(), totalsX + 4, bandY + 14)
      if (dueBand.when) {
        doc.setFont('helvetica', 'normal').setFontSize(7)
        doc.text(dueBand.when, totalsX + 4, bandY + 29)
      }
      doc.setFont('helvetica', 'bold').setFontSize(13)
      doc.text(`${currency} ${money(dueBand.amount)}`, panelX + panelW - 14, bandY + 25, { align: 'right' })
    }
    y += (band ? totalH : Math.max(totalH, notesH)) + 12
  } else if (notes) {
    const wrapped = doc.splitTextToSize(notes, contentW(doc) - 10) as string[]
    y = ensureRoom(doc, company, input, y, wrapped.length * 10 + 34)
    writeLabel(doc, 'Delivery notes', MARGIN, y + 10)
    doc.setFont('helvetica', 'normal').setFontSize(7.8).setTextColor(...INK)
    doc.text(wrapped, MARGIN, y + 27)
    y += wrapped.length * 10 + 38
  }

  y = drawWarranties(doc, company, input, y)

  if (input.showPaymentDetails ?? (showAmounts && kind !== 'quotation' && kind !== 'sales-order')) {
    const payment = defaultPaymentLines(input, company, bankAccounts)
    if (payment.length) {
      const paymentH = Math.max(56, Math.ceil(payment.length / 2) * 14 + 30)
      // Sit the block on the foot of the page when the document is short, so a
      // four-line invoice closes as deliberately as a forty-line one. It used
      // to be pushed to a fixed y, which left it stranded mid-page with a band
      // of nothing beneath it. A long document keeps its natural flow and
      // ensureRoom() carries it to a continuation page as before.
      // Reserve whatever still has to follow, or anchoring the payment block
      // pushes the acknowledgement or signature onto a second page.
      const footOfPage = bodyBottom(doc) - paymentH - 12 - closingBlockHeight(input, kind, delivery)
      if (footOfPage > y) y = footOfPage
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

/** Where body content starts on the first page, below the letterhead. */
export const BODY_TOP = LETTERHEAD_H + 28

/**
 * A blank page on the company letterhead — paper size, font, watermark and header, all
 * from the company's print settings. Body content starts at BODY_TOP.
 *
 * `shell` stands in for the document the flow helpers expect: ensureRoom, pageBreak and
 * the footer only ever read its title and ref.
 */
export function startLetterheadDocument(
  company: DeedPdfCompany,
  title: string,
  ref: string,
  orientation: 'portrait' | 'landscape' = 'portrait',
): {
  doc: jsPDF
  accent: [number, number, number]
  shell: DeedPdfInput
} {
  const doc = new jsPDF({ unit: 'pt', format: normalizePaperFormat(company.printPaperFormat), orientation })
  // Every later setFont('helvetica', style) draws in the company's chosen family.
  const selectedFont = pdfFont(company.printFont)
  const originalSetFont = doc.setFont.bind(doc)
  doc.setFont = ((_: string, style?: string) => originalSetFont(selectedFont, style)) as typeof doc.setFont
  drawDocumentBackground(doc, company)
  drawLetterhead(doc, company)
  return {
    doc,
    accent: layoutAccent(normalizeDocumentLayout(company.printTemplate), company),
    shell: { title, ref } as DeedPdfInput,
  }
}

/**
 * The opening band every letterhead document shares: the title in the accent colour,
 * who the document is about on the left, and the reference rows on the right.
 * Returns the y to carry on from.
 */
export function drawDocumentIntro(
  doc: jsPDF,
  accent: [number, number, number],
  opts: {
    title: string
    /** Small blue label above the party, e.g. "Employee" or "To whom it may concern". */
    partyLabel: string
    partyName?: string
    /** Smaller lines under the name, e.g. "Employee No. EMP-001". */
    partyLines?: string[]
    meta?: Array<[string, string]>
    /** Where the meta column starts, as a share of the content width. */
    metaRatio?: number
  },
): number {
  const width = contentW(doc)
  const metaX = MARGIN + width * (opts.metaRatio ?? .58)
  const top = BODY_TOP

  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...accent)
  doc.text(opts.title.toUpperCase(), MARGIN, top)

  const y = top + 26
  writeLabel(doc, opts.partyLabel, MARGIN, y)
  let partyY = y + 16
  if (opts.partyName) {
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK)
    doc.text(opts.partyName, MARGIN, partyY, { maxWidth: metaX - MARGIN - 20 })
    partyY += 15
  }
  doc.setFont('helvetica', 'normal').setFontSize(8.3).setTextColor(...INK)
  for (const text of (opts.partyLines ?? []).filter(Boolean)) {
    doc.text(text, MARGIN, partyY, { maxWidth: metaX - MARGIN - 20 })
    partyY += 13
  }

  const meta = opts.meta ?? []
  meta.forEach(([label, value], index) => drawMetaRow(doc, label, value, metaX, y + index * 17, 84))

  return Math.max(partyY, y + Math.max(meta.length - 1, 0) * 17 + 16) + 10
}

/** Close a letterhead document: the standard footer on every page. */
export function finishLetterheadDocument(doc: jsPDF, company: DeedPdfCompany, shell: DeedPdfInput): jsPDF {
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    drawFooter(doc, company, shell, page, pages)
  }
  return doc
}

/** A statement of account on the company letterhead: summary, aging, every movement, and what is still open. */
export function buildDeedStatementPdf(
  input: DeedStatementInput,
  company: DeedPdfCompany,
  bankAccountsInput: DeedPdfBank[] = [],
): jsPDF {
  const banks: DeedPdfBank[] = Array.isArray(bankAccountsInput) ? bankAccountsInput.filter(Boolean) : []
  const currency = company.currency || 'KES'
  const customer = input.side === 'customer'
  const title = customer ? 'Statement of account' : 'Supplier statement'
  const { doc, accent, shell: pseudo } = startLetterheadDocument(company, title, input.ref)
  const words = customer
    ? { charge: 'INVOICED', payment: 'RECEIVED', closing: 'BALANCE DUE', party: 'Statement for' }
    : { charge: 'BILLED', payment: 'PAID', closing: 'WE OWE', party: 'Supplier' }

  let y = BODY_TOP
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
      margin: { left: MARGIN, right: MARGIN, top: BODY_TOP, bottom: 62 },
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
    margin: { left: MARGIN, right: MARGIN, top: BODY_TOP, bottom: 62 },
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
      margin: { left: MARGIN, right: MARGIN, top: BODY_TOP, bottom: 62 },
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

  return finishLetterheadDocument(doc, company, pseudo)
}
