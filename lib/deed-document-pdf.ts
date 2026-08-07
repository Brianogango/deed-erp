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
  /** Delivery notes: serial / IMEI for the shipped unit. */
  serial?: string
  /** Delivery notes: unit specs (RAM, storage, CPU, accessories, …). */
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
  /**
   * A header-level discount applied AFTER tax (subtotal + tax - discount =
   * total) — e.g. a Sales Order's discountAmount or an Invoice's prorated
   * header discount. Distinct from discountTotal above, which is a pre-tax
   * sum of per-line discountPct amounts already netted into `subtotal`.
   * Shown as its own "Discount" row between VAT and TOTAL so the math the
   * customer sees matches how the total was actually computed.
   */
  postTaxDiscountTotal?: number
  taxTotal?: number
  total?: number
  amountPaid?: number
  notes?: string
  paymentCommunication?: boolean
  hideAmounts?: boolean
  showPaymentDetails?: boolean
  showSignature?: boolean
  /**
   * Delivery notes: show Serial / Specs / Cond. columns instead of the
   * simple qty-only hideAmounts table.
   */
  deliveryNoteLayout?: boolean
  /** Delivery notes: ID / passport for receipt acknowledgement. */
  recipientIdNumber?: string
  /** Delivery notes: receipt acknowledgement block (default when deliveryNoteLayout). */
  showReceiptAcknowledgement?: boolean
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

/**
 * Full-page faded logo watermark, inset from the edges (not edge-flush).
 * Drawn first on each page so letterhead/content paint above it.
 */
function drawPageWatermark(doc: jsPDF, company: DeedPdfCompany) {
  const insetX = MARGIN + 28
  const insetY = 120
  const maxW = PAGE_W - insetX * 2
  const maxH = PAGE_H - insetY - 140

  try {
    const GState = (doc as any).GState
    if (typeof GState === 'function') {
      doc.saveGraphicsState()
      doc.setGState(new GState({ opacity: 0.07 }))
    }

    if (company.logoDataUrl && company.logoWidth && company.logoHeight) {
      const scale = Math.min(maxW / company.logoWidth, maxH / company.logoHeight)
      const w = company.logoWidth * scale
      const h = company.logoHeight * scale
      const x = (PAGE_W - w) / 2
      const y = insetY + (maxH - h) / 2
      doc.addImage(company.logoDataUrl, 'PNG', x, y, w, h)
    } else {
      // Fallback wordmark — large, centered, same inset band as the logo.
      doc.setFont('helvetica', 'bold').setFontSize(120).setTextColor(230, 238, 248)
      doc.text('deed', PAGE_W / 2, insetY + maxH / 2 + 30, { align: 'center' })
    }

    if (typeof GState === 'function') {
      doc.restoreGraphicsState()
    }
  } catch {
    doc.setFont('helvetica', 'bold').setFontSize(96).setTextColor(230, 238, 248)
    doc.text('deed', PAGE_W / 2, PAGE_H / 2, { align: 'center' })
  }
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
  // Leave clear air above the fixed contact footer so body text never stacks on it.
  const contentBottom = PAGE_H - 100
  const showAmounts = !input.hideAmounts
  const deliveryLayout = Boolean(input.deliveryNoteLayout) || (!showAmounts && /delivery/i.test(input.title))
  const showPayment = input.showPaymentDetails ?? showAmounts
  const showSignature = input.showSignature ?? true
  const showAck = input.showReceiptAcknowledgement ?? deliveryLayout
  const partyLabel = partyLabelFor(input.title, input.partyLabel)
  const website = displayWebsite(company.website)
  const colCount = showAmounts ? 6 : deliveryLayout ? 6 : 3

  const ensureRoom = (y: number, needed: number): number => {
    if (y + needed <= contentBottom) return y
    doc.addPage()
    drawPageWatermark(doc, company)
    return 56
  }

  // Watermark first so letterhead + body paint above it.
  drawPageWatermark(doc, company)

  // Letterhead — logo is the brand signal; document title stays secondary below it.
  const LOGO_TOP = 20
  const LOGO_MAX_H = 72
  const LOGO_MAX_W = 200
  const TITLE_GAP = 38
  let letterheadBottom = LOGO_TOP + 28

  if (company.logoDataUrl && company.logoWidth && company.logoHeight) {
    const scale = Math.min(LOGO_MAX_H / company.logoHeight, LOGO_MAX_W / company.logoWidth)
    const logoW = company.logoWidth * scale
    const logoH = company.logoHeight * scale
    try {
      doc.addImage(company.logoDataUrl, 'PNG', MARGIN, LOGO_TOP, logoW, logoH)
      letterheadBottom = LOGO_TOP + logoH
    } catch {
      doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...NAVY)
      doc.text('deed', MARGIN, LOGO_TOP + 28)
      letterheadBottom = LOGO_TOP + 32
    }
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...NAVY)
    doc.text('deed', MARGIN, LOGO_TOP + 28)
    doc.setFillColor(...CYAN)
    doc.circle(MARGIN + 46, LOGO_TOP + 20, 2.4, 'F')
    letterheadBottom = LOGO_TOP + 32
  }

  // Website stays top-right in the logo band (does not sit under the mark).
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...FOOTER_GRAY)
  doc.text(website, rightX, LOGO_TOP + 18, { align: 'right' })

  // Title sits clearly below the logo — smaller than the mark so it does not compete.
  let y = letterheadBottom + TITLE_GAP
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...NAVY)
  doc.text(input.title.toUpperCase(), MARGIN, y)

  y += 18
  const metaRows = [
    { label: docNoLabel(input.title), value: input.ref },
    ...(input.date ? [{ label: 'Date', value: fmtDate(input.date) }] : []),
    ...(input.dueDate ? [{ label: input.dueLabel ?? 'Due Date', value: fmtDate(input.dueDate) }] : []),
    // Doc meta stays on the left — never mixed into the Quote/Bill To party block.
    ...(input.sourceRef ? [{ label: 'Reference', value: input.sourceRef }] : []),
    ...(input.salesperson ? [{ label: 'Prepared by', value: input.salesperson }] : []),
  ]
  metaRows.forEach(row => {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...TEXT)
    doc.text(`${row.label}:`, MARGIN, y)
    doc.setFont('helvetica', 'normal')
    doc.text(row.value, MARGIN + 78, y)
    y += 14
  })

  let partyY = letterheadBottom + TITLE_GAP
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
  if (input.customerAddress) {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...LIGHT_BLUE)
    const addrLines = doc.splitTextToSize(input.customerAddress, 240) as string[]
    for (const line of addrLines.slice(0, 3)) {
      doc.text(line, rightX, partyY, { align: 'right' })
      partyY += 12
    }
  }
  if (input.customerCountry || (!input.customerAddress && !deliveryLayout)) {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...LIGHT_BLUE)
    doc.text(input.customerCountry || 'Kenya', rightX, partyY, { align: 'right' })
    partyY += 14
  }
  if (input.customerPhone) {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...LIGHT_BLUE)
    doc.text(input.customerPhone, rightX, partyY, { align: 'right' })
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
    : deliveryLayout
      ? [['SL.', 'ITEM DESCRIPTION', 'QTY', 'SERIAL / IMEI', 'SPECS', 'COND. ✓']]
      : [['SL.', 'ITEM DESCRIPTION', 'QUANTITY']]

  let sl = 0
  const bodyRows = input.lines.map(line => {
    if (line.lineType === 'section') {
      return [{
        content: line.description,
        colSpan: colCount,
        styles: { fontStyle: 'bold' as const, textColor: NAVY, fillColor: [239, 246, 255] as [number, number, number] },
      }]
    }
    sl += 1
    if (!showAmounts && deliveryLayout) {
      return [
        String(sl),
        line.description,
        Number.isInteger(line.qty) ? String(line.qty) : money(line.qty),
        line.serial?.trim() || '—',
        line.specs?.trim() || '—',
        '',
      ]
    }
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
    margin: { left: MARGIN, right: MARGIN, top: 56, bottom: 100 },
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
      : deliveryLayout
        ? {
            0: { cellWidth: 26,halign: 'center' },
            1: { cellWidth: 'auto',halign: 'left' },
            2: { cellWidth: 36,halign: 'center' },
            3: { cellWidth: 92,halign: 'left', font: 'courier', fontSize: 7.5 },
            4: { cellWidth: 110,halign: 'left', fontSize: 7.5 },
            5: { cellWidth: 42,halign: 'center' },
          }
        : {
            0: { cellWidth: 28,halign: 'center' },
            1: { cellWidth: 'auto',halign: 'left' },
            2: { cellWidth: 70,halign: 'center' },
          },
    // New pages created by the table: stamp watermark before cells so content sits above it.
    didDrawPage: data => {
      if (data.pageNumber > 1) drawPageWatermark(doc, company)
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
    const postTaxDisc = Number(input.postTaxDiscountTotal) || 0
    // Distinct label from the pre-tax "Discount" row above (line discounts)
    // in the rare case both are present on the same document at once.
    if (postTaxDisc > 0) totals.push({ label: disc > 0 ? 'Order Discount' : 'Discount', value: `- ${currency} ${money(postTaxDisc)}` })
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
  const rightW = contentW * 0.40
  const colGap = contentW - leftW - rightW
  const totalsX = MARGIN + leftW + colGap
  const totalsH = Math.max(36, totals.length * 16 + 8)
  const notesWrapped = notesText ? (doc.splitTextToSize(notesText, leftW - 18) as string[]) : []
  const notesH = notesText ? Math.max(36, notesWrapped.length * 11 + 28) : 0
  const notesTotalsH = Math.max(notesH, totalsH, showAmounts ? 36 : 0)

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

  // Measure payment block with real wraps so height matches drawn text.
  let paymentDrawH = 0
  if (paymentLines.length) {
    paymentDrawH = 22
    for (const line of paymentLines) {
      const wrapped = doc.splitTextToSize(line, leftW - 12) as string[]
      paymentDrawH += Math.max(1, wrapped.length) * 11
    }
    paymentDrawH += 6
  }
  const sigH = showSignature ? 68 : 0
  const bottomBlockH = Math.max(paymentDrawH, sigH)

  // Natural flow under the table — do not shove totals into the footer zone.
  y = ensureRoom(y, notesTotalsH + 14)

  const blockTop = y

  if (notesText) {
    doc.setFillColor(...CYAN)
    doc.roundedRect(MARGIN, blockTop, 3.5, 14, 1, 1, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...NAVY)
    doc.text('Notes', MARGIN + 10, blockTop + 11)
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...GRAY)
    doc.text(notesWrapped, MARGIN + 10, blockTop + 26)
  }

  if (showAmounts && totals.length) {
    let totalsY = blockTop + 12
    for (const row of totals) {
      doc.setFont('helvetica', row.bold ? 'bold' : 'normal').setFontSize(row.bold ? 12 : 9)
      doc.setTextColor(...(row.accent ? NAVY : TEXT))
      doc.text(row.label, totalsX, totalsY)
      doc.text(row.value, rightX, totalsY, { align: 'right' })
      totalsY += row.bold ? 18 : 15
    }
  }

  y = blockTop + notesTotalsH + 18

  if (bottomBlockH > 0) {
    y = ensureRoom(y, bottomBlockH + 8)
    const paySigTop = y

    if (paymentLines.length) {
      doc.setFillColor(...NAVY)
      doc.roundedRect(MARGIN, paySigTop, 3.5, 14, 1, 1, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...NAVY)
      doc.text('Payment Details', MARGIN + 10, paySigTop + 11)
      let payY = paySigTop + 28
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...TEXT)
      for (const line of paymentLines) {
        const isHeading = line.endsWith(':') && !line.includes('Reference')
        doc.setFont('helvetica', isHeading ? 'bold' : 'normal')
        const wrapped = doc.splitTextToSize(line, leftW - 12) as string[]
        doc.text(wrapped, MARGIN + 10, payY)
        payY += Math.max(1, wrapped.length) * 11
      }
    }

    if (showSignature) {
      const sigX = totalsX
      // Prefer the lower content band (just above the fixed footer) so the
      // signature does not sit flush under totals when the page has free space.
      const sigTop = Math.max(paySigTop, contentBottom - sigH)

      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...GRAY)
      doc.text('AUTHORISED SIGNATURE', sigX, sigTop + 11)
      doc.setDrawColor(...BORDER).setLineWidth(0.8)
      doc.line(sigX, sigTop + 46, rightX, sigTop + 46)
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRAY)
      doc.text('Authorised Signature', sigX + rightW / 2, sigTop + 60, { align: 'center' })
      y = Math.max(y, sigTop + sigH)
    } else {
      y = Math.max(y, paySigTop + bottomBlockH)
    }
  }

  if (showAck) {
    const ackH = 118
    y = ensureRoom(y + 10, ackH)
    doc.setDrawColor(...BORDER).setLineWidth(0.6)
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(MARGIN, y, contentW, ackH - 8, 3, 3, 'S')
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...NAVY)
    doc.text('Receipt Acknowledgement', MARGIN + 12, y + 16)

    const colW = (contentW - 36) / 2
    const leftAck = MARGIN + 12
    const rightAck = MARGIN + 18 + colW
    const row1 = y + 34
    const row2 = y + 72

    const drawAckField = (x: number, top: number, label: string, value?: string, lineH = 28) => {
      doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...GRAY)
      doc.text(label.toUpperCase(), x, top)
      if (value?.trim()) {
        doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...TEXT)
        doc.text(value.trim(), x, top + 16, { maxWidth: colW - 8 })
      } else {
        doc.setDrawColor(...TEXT).setLineWidth(0.5)
        doc.line(x, top + lineH, x + colW - 8, top + lineH)
      }
    }

    drawAckField(leftAck, row1, 'Received By (Full Name)', input.attention)
    drawAckField(rightAck, row1, 'ID / Passport No.', input.recipientIdNumber)
    drawAckField(leftAck, row2, 'Signature', undefined, 34)
    drawAckField(rightAck, row2, 'Date Received', undefined, 34)
    y += ackH
  }

  const pageCount = doc.getNumberOfPages()
  const phone = company.phone || ''
  const email = company.email || ''
  const address = [company.address, company.city].filter(Boolean).join(', ')
  const pin = company.kraPin || ''

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page)
    if (page > 1) {
      // Continuation header only — watermark already drawn when the page was created.
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...NAVY)
      doc.text(`${input.title.toUpperCase()} · ${input.ref}`, MARGIN, 28)
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...FOOTER_GRAY)
      doc.text(website, rightX, 28, { align: 'right' })
    }

    // Page chrome is always absolute to A4 — never follows mid-page content.
    drawFooterTriangles(doc)

    const footerY = PAGE_H - 52
    doc.setDrawColor(...BORDER).setLineWidth(0.5)
    doc.line(MARGIN, footerY - 14, rightX, footerY - 14)

    const col1 = MARGIN + 12
    const col2 = MARGIN + contentW * 0.32
    const col3 = MARGIN + contentW * 0.58
    drawContactIcon(doc, 'phone', col1, footerY)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRAY)
    doc.text(phone, col1 + 12, footerY + 2)

    drawContactIcon(doc, 'email', col2, footerY)
    doc.text(email, col2 + 12, footerY + 2)

    drawContactIcon(doc, 'pin', col3, footerY)
    const addrLines = doc.splitTextToSize(address || 'Kenya', 118) as string[]
    doc.text(addrLines.slice(0, 2), col3 + 12, footerY - 2)

    if (pin) {
      doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...NAVY)
      doc.text(`PIN: ${pin}`, rightX, footerY + 2, { align: 'right' })
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
