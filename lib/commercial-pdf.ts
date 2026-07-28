'use client'

// Branded commercial document PDFs (quotations, sales orders, pro-forma
// invoices, invoices, bills) generated client-side with jsPDF. Documents
// download as real .pdf files — never HTML. The visual shell intentionally
// matches the delivery note: tri-colour brand bar, light letterhead, rounded
// metadata/party cards, navy line-table header and compact document footer.

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { BankAccount, CompanySettings } from '@/lib/store'

export interface CommercialPdfLine {
  lineType?: 'item' | 'section'
  description: string
  qty: number
  unitPrice: number
  taxRate?: number
  subtotal: number
}

export interface CommercialPdfInput {
  /** e.g. "Quotation", "Sale Order", "Pro-forma Invoice", "Invoice", "Bill" */
  title: string
  ref: string
  date?: string
  /** Label for the second date column, e.g. "Expiration" or "Due Date". */
  dueLabel?: string
  dueDate?: string
  salesperson?: string
  sourceRef?: string
  customerName: string
  customerAddress?: string
  customerTaxId?: string
  lines: CommercialPdfLine[]
  subtotal: number
  taxTotal: number
  total: number
  amountPaid?: number
  notes?: string
  /** Invoices: "Please use the following communication for your payment". */
  paymentCommunication?: boolean
}

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 40
const NAVY: [number, number, number] = [27, 39, 98]
const GRAY: [number, number, number] = [100, 116, 139]
const TEXT: [number, number, number] = [15, 23, 42]

const money = (n: number) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (value?: string) => {
  if (!value) return ''
  try {
    return new Date(value).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return value }
}

/** Load the company logo (uploaded data URL or same-origin URL) for jsPDF. */
async function loadLogo(logoUrl?: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (!logoUrl || typeof window === 'undefined') return null
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.crossOrigin = 'anonymous'
      const timer = window.setTimeout(() => reject(new Error('logo timeout')), 4000)
      el.onload = () => { window.clearTimeout(timer); resolve(el) }
      el.onerror = () => { window.clearTimeout(timer); reject(new Error('logo failed')) }
      el.src = logoUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || 1
    canvas.height = img.naturalHeight || 1
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  } catch {
    return null
  }
}

export async function buildCommercialPdf(
  input: CommercialPdfInput,
  company: CompanySettings,
  bankAccounts: BankAccount[] = [],
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const currency = company.currency || 'KES'
  const rightX = PAGE_W - MARGIN
  const contentW = PAGE_W - MARGIN * 2
  const contentBottom = PAGE_H - 70
  const DARK_NAVY: [number, number, number] = [16, 32, 74]
  const CYAN: [number, number, number] = [0, 174, 239]
  const GREEN: [number, number, number] = [16, 185, 129]
  const BORDER: [number, number, number] = [226, 232, 240]
  const SURFACE: [number, number, number] = [248, 250, 252]

  const ensureRoom = (y: number, needed: number): number => {
    if (y + needed <= contentBottom) return y
    doc.addPage()
    return 60
  }

  const box = (x: number, y: number, width: number, height: number, fill: [number, number, number] = [255, 255, 255]) => {
    doc.setFillColor(...fill).setDrawColor(...BORDER).setLineWidth(0.8)
    doc.roundedRect(x, y, width, height, 12, 12, 'FD')
  }

  // ── Delivery-note visual shell ──────────────────────────────────────────
  // Three-segment brand bar approximates the delivery-note gradient while
  // retaining a true vector PDF.
  doc.setFillColor(...NAVY).rect(MARGIN, 28, contentW * 0.44, 7, 'F')
  doc.setFillColor(...CYAN).rect(MARGIN + contentW * 0.44, 28, contentW * 0.36, 7, 'F')
  doc.setFillColor(...GREEN).rect(MARGIN + contentW * 0.8, 28, contentW * 0.2, 7, 'F')
  doc.setFillColor(244, 248, 252).rect(MARGIN, 35, contentW, 110, 'F')
  doc.setDrawColor(...BORDER).setLineWidth(0.8).line(MARGIN, 145, rightX, 145)

  const logo = await loadLogo(company.logoUrl)
  if (logo) {
    const maxH = 48
    const maxW = 135
    const scale = Math.min(maxH / logo.height, maxW / logo.width)
    const w = logo.width * scale
    const h = logo.height * scale
    try {
      doc.addImage(logo.dataUrl, 'PNG', MARGIN + 26, 66, w, h)
    } catch {
      doc.setFillColor(...NAVY).roundedRect(MARGIN + 26, 62, 128, 52, 12, 12, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(255, 255, 255)
      doc.text(company.name, MARGIN + 90, 92, { align: 'center', maxWidth: 112 })
    }
  } else {
    doc.setFillColor(...NAVY).roundedRect(MARGIN + 26, 62, 128, 52, 12, 12, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(255, 255, 255)
    doc.text(company.name, MARGIN + 90, 92, { align: 'center', maxWidth: 112 })
  }

  // Company identity block (right).
  let companyY = 58
  const companyLines = [
    company.kraPin ? `PIN: ${company.kraPin}` : '',
    company.name,
    company.address,
    [company.city, 'Kenya'].filter(Boolean).join(', '),
    company.phone,
    company.email,
  ].filter(Boolean)
  companyLines.forEach((line, index) => {
    const isIdentity = index <= 1
    doc.setFont('helvetica', isIdentity ? 'bold' : 'normal')
      .setFontSize(index === 0 ? 8 : index === 1 ? 9.5 : 8)
      .setTextColor(isIdentity ? NAVY[0] : GRAY[0], isIdentity ? NAVY[1] : GRAY[1], isIdentity ? NAVY[2] : GRAY[2])
    doc.text(line, rightX - 26, companyY, { align: 'right' })
    companyY += 13
  })

  // ── Title and rounded document meta ─────────────────────────────────────
  const titleY = 183
  doc.setFont('helvetica', 'bold').setFontSize(23).setTextColor(...TEXT)
  doc.text(input.title.toUpperCase(), MARGIN + 26, titleY)

  const metaX = rightX - 178
  const metaY = 165
  const metaW = 178
  const metaRows = [
    { label: 'NO.', value: input.ref },
    ...(input.date ? [{ label: 'DATE', value: fmtDate(input.date) }] : []),
    ...(input.dueDate ? [{ label: (input.dueLabel ?? 'DUE DATE').toUpperCase(), value: fmtDate(input.dueDate) }] : []),
    ...(input.sourceRef ? [{ label: 'SOURCE', value: input.sourceRef }] : []),
  ]
  const metaH = Math.max(58, 18 + metaRows.length * 14)
  box(metaX, metaY, metaW, metaH)
  let metaTextY = metaY + 17
  metaRows.forEach(row => {
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...GRAY)
    doc.text(`${row.label}:`, metaX + 12, metaTextY)
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...TEXT)
    doc.text(row.value, metaX + metaW - 12, metaTextY, { align: 'right', maxWidth: 104 })
    metaTextY += 14
  })

  // ── Customer and prepared-by cards ──────────────────────────────────────
  const partiesY = Math.max(228, metaY + metaH + 16)
  const partyGap = 14
  const partyW = (contentW - 52 - partyGap) / 2
  const leftPartyX = MARGIN + 26
  const rightPartyX = leftPartyX + partyW + partyGap
  const partyH = 76
  box(leftPartyX, partiesY, partyW, partyH)
  box(rightPartyX, partiesY, partyW, partyH)

  doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...GRAY)
  doc.text('CUSTOMER / BILL TO', leftPartyX + 13, partiesY + 17)
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...TEXT)
  doc.text(input.customerName, leftPartyX + 13, partiesY + 35, { maxWidth: partyW - 26 })
  let customerY = partiesY + 49
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRAY)
  if (input.customerAddress) {
    const lines = doc.splitTextToSize(input.customerAddress, partyW - 26) as string[]
    doc.text(lines.slice(0, 2), leftPartyX + 13, customerY)
    customerY += Math.min(2, lines.length) * 10
  }
  if (input.customerTaxId && customerY <= partiesY + partyH - 7) {
    doc.text(`Tax ID: ${input.customerTaxId}`, leftPartyX + 13, customerY)
  }

  doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...GRAY)
  doc.text('DOCUMENT DETAILS', rightPartyX + 13, partiesY + 17)
  let detailY = partiesY + 35
  const detailRows = [
    input.salesperson ? `Prepared by: ${input.salesperson}` : '',
    input.sourceRef ? `Reference: ${input.sourceRef}` : '',
    input.dueDate ? `${input.dueLabel ?? 'Due Date'}: ${fmtDate(input.dueDate)}` : '',
  ].filter(Boolean)
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...TEXT)
  if (detailRows.length) {
    detailRows.slice(0, 3).forEach(row => { doc.text(row, rightPartyX + 13, detailY, { maxWidth: partyW - 26 }); detailY += 13 })
  } else {
    doc.text(`${input.title} ${input.ref}`, rightPartyX + 13, detailY, { maxWidth: partyW - 26 })
  }

  let y = partiesY + partyH + 18

  // ── Line table ──────────────────────────────────────────────────────────
  const bodyRows = input.lines.map(line => {
    if (line.lineType === 'section') {
      return [{
        content: line.description,
        colSpan: 5,
        styles: { fontStyle: 'bold' as const, textColor: NAVY, fillColor: [244, 247, 252] as [number, number, number] },
      }]
    }
    return [
      line.description,
      Number.isInteger(line.qty) ? String(line.qty) : money(line.qty),
      `${currency} ${money(line.unitPrice)}`,
      line.taxRate ? `VAT (${line.taxRate}%)` : '',
      `${currency} ${money(line.subtotal)}`,
    ]
  })

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN + 26, right: MARGIN + 26, top: 58, bottom: 80 },
    head: [['PRODUCT / DESCRIPTION', 'QTY', 'UNIT PRICE', 'TAX', 'AMOUNT']],
    body: bodyRows as any,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      textColor: TEXT,
      cellPadding: { top: 7, bottom: 7, left: 8, right: 8 },
      lineColor: BORDER,
      lineWidth: 0.5,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: DARK_NAVY,
      fontSize: 7,
      fontStyle: 'bold',
      textColor: [255, 255, 255],
      lineColor: DARK_NAVY,
      minCellHeight: 26,
    },
    alternateRowStyles: { fillColor: SURFACE },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 42, halign: 'center' },
      2: { cellWidth: 86, halign: 'right' },
      3: { cellWidth: 55, halign: 'center' },
      4: { cellWidth: 91, halign: 'right' },
    },
  })

  y = (doc as any).lastAutoTable.finalY + 16

  // ── Rounded totals panel ────────────────────────────────────────────────
  const taxRates = Array.from(new Set(input.lines.filter(l => l.lineType !== 'section' && (l.taxRate ?? 0) > 0).map(l => l.taxRate)))
  const vatLabel = taxRates.length === 1 ? `VAT ${taxRates[0]}%` : 'VAT'
  const totals: Array<{ label: string; value: string; bold?: boolean; rule?: boolean }> = [
    { label: 'Untaxed Amount', value: `${currency} ${money(input.subtotal)}` },
  ]
  if (input.taxTotal) totals.push({ label: vatLabel, value: `${currency} ${money(input.taxTotal)}` })
  totals.push({ label: 'Total', value: `${currency} ${money(input.total)}`, bold: true, rule: true })
  if (input.amountPaid && input.amountPaid > 0) {
    totals.push({ label: 'Amount Paid', value: `- ${currency} ${money(input.amountPaid)}` })
    totals.push({ label: 'Amount Due', value: `${currency} ${money(Math.max(0, input.total - input.amountPaid))}`, bold: true })
  }
  const totalsH = totals.length * 18 + 24
  y = ensureRoom(y, totalsH + 8)
  const totalsX = rightX - 238
  box(totalsX, y, 238, totalsH, [248, 250, 252])
  let totalsY = y + 19
  for (const row of totals) {
    if (row.rule) {
      doc.setDrawColor(...BORDER).setLineWidth(0.8)
      doc.line(totalsX + 13, totalsY - 10, rightX - 13, totalsY - 10)
    }
    doc.setFont('helvetica', row.bold ? 'bold' : 'normal').setFontSize(row.bold ? 10 : 8.5)
    doc.setTextColor(...TEXT)
    doc.text(row.label, totalsX + 13, totalsY)
    doc.text(row.value, rightX - 13, totalsY, { align: 'right' })
    totalsY += 18
  }
  y += totalsH + 12

  // ── Payment communication ───────────────────────────────────────────────
  if (input.paymentCommunication) {
    y = ensureRoom(y, 40)
    box(MARGIN + 26, y, contentW - 52, 34, [239, 246, 255])
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...NAVY)
    doc.text(`PAYMENT REFERENCE: ${input.ref}`, MARGIN + 39, y + 21)
    y += 44
  }

  // ── Payment details ─────────────────────────────────────────────────────
  const primaryBank = bankAccounts.find(a => a.active && a.id !== 'cash' && a.id !== 'mpesa')
  const paymentLines: string[] = []
  if (primaryBank) {
    paymentLines.push(`Account Name: ${company.name}`)
    paymentLines.push(`Account number: ${primaryBank.accountNo} (${primaryBank.currency || currency})`)
    paymentLines.push(`Bank: ${primaryBank.bankName}`)
  }
  if (company.mpesaPaybill) {
    paymentLines.push('MPESA')
    paymentLines.push(`Pay Bill No: ${company.mpesaPaybill}`)
    if (company.mpesaAccount) paymentLines.push(`Account number: ${company.mpesaAccount} (${currency})`)
  }
  if (paymentLines.length) {
    const paymentH = paymentLines.length * 11 + 35
    y = ensureRoom(y, paymentH + 8)
    box(MARGIN + 26, y, contentW - 52, paymentH)
    doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...NAVY)
    doc.text('PAYMENT DETAILS', MARGIN + 39, y + 18)
    let paymentY = y + 34
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...TEXT)
    for (const line of paymentLines) {
      doc.text(line, MARGIN + 39, paymentY)
      paymentY += 11
    }
    y += paymentH + 10
  }

  // ── Notes / terms ───────────────────────────────────────────────────────
  if (input.notes?.trim()) {
    const wrapped = doc.splitTextToSize(input.notes.trim(), contentW - 78) as string[]
    const notesH = wrapped.length * 10 + 35
    y = ensureRoom(y, notesH)
    box(MARGIN + 26, y, contentW - 52, notesH, SURFACE)
    doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...NAVY)
    doc.text('TERMS & CONDITIONS', MARGIN + 39, y + 18)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRAY)
    doc.text(wrapped, MARGIN + 39, y + 34)
  }

  // ── Footer on every page ────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages()
  const footerLine1 = [company.name, company.address, company.phone ? `Tel: ${company.phone}` : ''].filter(Boolean).join('  ·  ')
  const footerLine2 = [
    company.city,
    company.kraPin,
    company.email,
  ].filter(Boolean).join('  ·  ')
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page)
    if (page > 1) {
      doc.setFillColor(...NAVY).rect(MARGIN, 20, contentW * 0.44, 5, 'F')
      doc.setFillColor(...CYAN).rect(MARGIN + contentW * 0.44, 20, contentW * 0.36, 5, 'F')
      doc.setFillColor(...GREEN).rect(MARGIN + contentW * 0.8, 20, contentW * 0.2, 5, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...NAVY)
      doc.text(`${input.title.toUpperCase()} · ${input.ref}`, MARGIN, 41)
    }
    doc.setDrawColor(226, 232, 240).setLineWidth(0.6)
    doc.line(MARGIN, PAGE_H - 52, rightX, PAGE_H - 52)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRAY)
    doc.text(footerLine1, PAGE_W / 2, PAGE_H - 40, { align: 'center' })
    doc.text(footerLine2, PAGE_W / 2, PAGE_H - 30, { align: 'center' })
    doc.text(company.invoiceFooter || 'Please retain a copy for your records.', PAGE_W / 2, PAGE_H - 20, { align: 'center', maxWidth: contentW - 90 })
    doc.text(`${page} / ${pageCount}`, rightX, PAGE_H - 20, { align: 'right' })
  }

  return doc
}

const safeFileName = (name: string) => name.replace(/[/\\]/g, '-')

export async function downloadCommercialPdf(
  input: CommercialPdfInput,
  company: CompanySettings,
  bankAccounts: BankAccount[] = [],
  fileName?: string,
) {
  const doc = await buildCommercialPdf(input, company, bankAccounts)
  doc.save(safeFileName(fileName ?? `${input.title} - ${input.ref}.pdf`))
}

/** Open the PDF in a new tab (customer preview / print). */
export async function openCommercialPdf(
  input: CommercialPdfInput,
  company: CompanySettings,
  bankAccounts: BankAccount[] = [],
): Promise<boolean> {
  const doc = await buildCommercialPdf(input, company, bankAccounts)
  const url = doc.output('bloburl')
  const win = window.open(url, '_blank')
  return Boolean(win)
}
