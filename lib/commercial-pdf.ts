'use client'

// Odoo-style commercial document PDFs (quotations, sales orders, pro-forma
// invoices, invoices, bills) generated client-side with jsPDF. Documents
// download as real .pdf files — never HTML.
//
// Layout mirrors the standard Odoo report: letterhead, customer block on the
// right, "Title # REF" heading, date/salesperson meta, a plain line table,
// right-aligned totals, an optional payment-communication line, the PAYMENT
// DETAILS block, and a centered company footer with page numbers.

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
  const contentBottom = PAGE_H - 70

  const ensureRoom = (y: number, needed: number): number => {
    if (y + needed <= contentBottom) return y
    doc.addPage()
    return MARGIN
  }

  // ── Letterhead ──────────────────────────────────────────────────────────
  let headerBottom = MARGIN
  const logo = await loadLogo(company.logoUrl)
  if (logo) {
    const maxH = 42
    const maxW = 160
    const scale = Math.min(maxH / logo.height, maxW / logo.width)
    const w = logo.width * scale
    const h = logo.height * scale
    try {
      doc.addImage(logo.dataUrl, 'PNG', MARGIN, MARGIN, w, h)
      headerBottom = MARGIN + h
    } catch {
      doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...NAVY)
      doc.text(company.name, MARGIN, MARGIN + 12)
      headerBottom = MARGIN + 16
    }
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...NAVY)
    doc.text(company.name, MARGIN, MARGIN + 12)
    headerBottom = MARGIN + 16
  }

  // ── Customer block (right) ──────────────────────────────────────────────
  let custY = MARGIN + 8
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...TEXT)
  doc.text(input.customerName, rightX, custY, { align: 'right' })
  custY += 13
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...GRAY)
  if (input.customerAddress) {
    for (const line of doc.splitTextToSize(input.customerAddress, 230) as string[]) {
      doc.text(line, rightX, custY, { align: 'right' })
      custY += 11
    }
  }
  if (input.customerTaxId) {
    doc.text(`Tax ID: ${input.customerTaxId}`, rightX, custY, { align: 'right' })
    custY += 11
  }

  // ── Title ───────────────────────────────────────────────────────────────
  let y = Math.max(headerBottom, custY) + 26
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...TEXT)
  doc.text(`${input.title} # ${input.ref}`, MARGIN, y)
  y += 22

  // ── Meta row ────────────────────────────────────────────────────────────
  const meta: Array<{ label: string; value: string }> = []
  if (input.date) meta.push({ label: `${input.title === 'Quotation' ? 'Quotation' : input.title === 'Invoice' || input.title === 'Bill' ? 'Invoice' : 'Order'} Date:`, value: fmtDate(input.date) })
  if (input.dueDate) meta.push({ label: `${input.dueLabel ?? 'Due Date'}:`, value: fmtDate(input.dueDate) })
  if (input.salesperson) meta.push({ label: 'Salesperson:', value: input.salesperson })
  if (input.sourceRef) meta.push({ label: 'Source:', value: input.sourceRef })
  if (meta.length) {
    let x = MARGIN
    for (const item of meta) {
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...GRAY)
      doc.text(item.label, x, y)
      doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...TEXT)
      doc.text(item.value, x, y + 12)
      x += Math.max(110, doc.getTextWidth(item.value) + 40)
    }
    y += 30
  }

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
      `${money(line.qty)} Units`,
      money(line.unitPrice),
      line.taxRate ? `VAT (${line.taxRate}%)` : '',
      `${money(line.subtotal)} ${currency}`,
    ]
  })

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, bottom: 80 },
    head: [['DESCRIPTION', 'QUANTITY', 'UNIT PRICE', 'TAXES', 'AMOUNT']],
    body: bodyRows as any,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, textColor: TEXT, cellPadding: { top: 5, bottom: 5, left: 2, right: 2 } },
    headStyles: {
      fontSize: 7.5,
      fontStyle: 'bold',
      textColor: GRAY,
      lineWidth: { bottom: 1 },
      lineColor: TEXT,
    },
    bodyStyles: { lineWidth: { bottom: 0.4 }, lineColor: [226, 232, 240] },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 70, halign: 'right' },
      2: { cellWidth: 75, halign: 'right' },
      3: { cellWidth: 65, halign: 'right' },
      4: { cellWidth: 85, halign: 'right' },
    },
  })

  y = (doc as any).lastAutoTable.finalY + 14

  // ── Totals (right-aligned) ──────────────────────────────────────────────
  const taxRates = Array.from(new Set(input.lines.filter(l => l.lineType !== 'section' && (l.taxRate ?? 0) > 0).map(l => l.taxRate)))
  const vatLabel = taxRates.length === 1 ? `VAT ${taxRates[0]}%` : 'VAT'
  const totals: Array<{ label: string; value: string; bold?: boolean; rule?: boolean }> = [
    { label: 'Untaxed Amount', value: `${money(input.subtotal)} ${currency}` },
  ]
  if (input.taxTotal) totals.push({ label: vatLabel, value: `${money(input.taxTotal)} ${currency}` })
  totals.push({ label: 'Total', value: `${money(input.total)} ${currency}`, bold: true, rule: true })
  if (input.amountPaid && input.amountPaid > 0) {
    totals.push({ label: 'Amount Paid', value: `- ${money(input.amountPaid)} ${currency}` })
    totals.push({ label: 'Amount Due', value: `${money(Math.max(0, input.total - input.amountPaid))} ${currency}`, bold: true })
  }
  y = ensureRoom(y, totals.length * 16 + 10)
  const totalsLabelX = PAGE_W - MARGIN - 220
  for (const row of totals) {
    if (row.rule) {
      doc.setDrawColor(...TEXT).setLineWidth(0.8)
      doc.line(totalsLabelX, y - 10, rightX, y - 10)
    }
    doc.setFont('helvetica', row.bold ? 'bold' : 'normal').setFontSize(row.bold ? 10.5 : 9.5)
    doc.setTextColor(...TEXT)
    doc.text(row.label, totalsLabelX, y)
    doc.text(row.value, rightX, y, { align: 'right' })
    y += 16
  }
  y += 6

  // ── Payment communication ───────────────────────────────────────────────
  if (input.paymentCommunication) {
    y = ensureRoom(y, 16)
    doc.setFont('helvetica', 'italic').setFontSize(8.5).setTextColor(...GRAY)
    doc.text(`Please use the following communication for your payment : ${input.ref}`, MARGIN, y)
    y += 18
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
    y = ensureRoom(y, paymentLines.length * 11 + 20)
    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...NAVY)
    doc.text('PAYMENT DETAILS', MARGIN, y)
    y += 12
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...TEXT)
    for (const line of paymentLines) {
      doc.text(line, MARGIN, y)
      y += 11
    }
    y += 8
  }

  // ── Notes / terms ───────────────────────────────────────────────────────
  if (input.notes?.trim()) {
    const wrapped = doc.splitTextToSize(input.notes.trim(), PAGE_W - MARGIN * 2) as string[]
    y = ensureRoom(y, wrapped.length * 10 + 16)
    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...NAVY)
    doc.text('TERMS & CONDITIONS', MARGIN, y)
    y += 12
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...GRAY)
    doc.text(wrapped, MARGIN, y)
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
    doc.setDrawColor(226, 232, 240).setLineWidth(0.6)
    doc.line(MARGIN, PAGE_H - 52, rightX, PAGE_H - 52)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRAY)
    doc.text(footerLine1, PAGE_W / 2, PAGE_H - 40, { align: 'center' })
    doc.text(footerLine2, PAGE_W / 2, PAGE_H - 30, { align: 'center' })
    doc.text(`Page: ${page} / ${pageCount}`, PAGE_W / 2, PAGE_H - 20, { align: 'center' })
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
