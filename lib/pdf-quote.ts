'use client'

import { createPdfBlob, type PdfLine } from './pdf'
import { getStoredCompanyData } from './company'
import type { Quote } from './store'

const money = (value: number) => `KES ${value.toLocaleString()}`

export const buildQuotePdfLines = (quote: Quote) => {
  const co = getStoredCompanyData()
  const lines: PdfLine[] = []

  // Header
  lines.push({ text: co.name.toUpperCase(), x: 40, y: 810, size: 16, bold: true })
  lines.push({ text: `${co.address}, ${co.city}  ·  ${co.phone}  ·  ${co.email}`, x: 40, y: 792, size: 9 })
  lines.push({ text: `KRA PIN: ${co.kraPin}`, x: 40, y: 778, size: 9 })

  lines.push({ text: 'QUOTATION', x: 430, y: 810, size: 14, bold: true })
  lines.push({ text: quote.ref, x: 430, y: 792, size: 11, bold: true })
  lines.push({ text: `Date: ${quote.issueDate}`, x: 430, y: 778, size: 9 })
  lines.push({ text: `Valid Until: ${quote.validUntil}`, x: 430, y: 764, size: 9 })

  // Customer block
  lines.push({ text: 'BILL TO', x: 40, y: 735, size: 10, bold: true })
  lines.push({ text: quote.companyName, x: 40, y: 720, size: 11, bold: true })
  lines.push({ text: `Attention: ${quote.contactPersonName}`, x: 40, y: 706, size: 9 })

  lines.push({ text: 'QUOTE DETAILS', x: 320, y: 735, size: 10, bold: true })
  lines.push({ text: `Opportunity: ${quote.opportunityName}`, x: 320, y: 720, size: 9 })
  lines.push({ text: `Sales Rep: ${quote.ownerName}`, x: 320, y: 706, size: 9 })

  // Table header
  let y = 675
  lines.push({ text: '#', x: 40, y, size: 9, bold: true })
  lines.push({ text: 'Description', x: 60, y, size: 9, bold: true })
  lines.push({ text: 'Qty', x: 320, y, size: 9, bold: true })
  lines.push({ text: 'Unit Price', x: 360, y, size: 9, bold: true })
  lines.push({ text: 'Disc%', x: 430, y, size: 9, bold: true })
  lines.push({ text: 'Tax%', x: 470, y, size: 9, bold: true })
  lines.push({ text: 'Total', x: 510, y, size: 9, bold: true })

  y -= 14
  quote.lines.forEach((line, idx) => {
    lines.push({ text: String(idx + 1), x: 40, y, size: 8 })
    lines.push({ text: `${line.productName} (${line.sku})`, x: 60, y, size: 8 })
    lines.push({ text: String(line.qty), x: 320, y, size: 8 })
    lines.push({ text: money(line.unitPrice), x: 360, y, size: 8 })
    lines.push({ text: `${line.discount}%`, x: 430, y, size: 8 })
    lines.push({ text: `${line.taxRate}%`, x: 470, y, size: 8 })
    lines.push({ text: money(line.lineTotal), x: 510, y, size: 8 })
    y -= 12
  })

  // Totals
  y -= 18
  lines.push({ text: `Subtotal: ${money(quote.subtotal)}`, x: 380, y, size: 10 })
  y -= 14
  lines.push({ text: `Discount: ${money(quote.discountAmount)}`, x: 380, y, size: 10 })
  y -= 14
  lines.push({ text: `Tax: ${money(quote.taxTotal)}`, x: 380, y, size: 10 })
  y -= 16
  lines.push({ text: `TOTAL: ${money(quote.total)}`, x: 380, y, size: 12, bold: true })

  // Terms
  y -= 28
  lines.push({ text: 'Terms & Conditions', x: 40, y, size: 10, bold: true })
  y -= 14
  lines.push({ text: `Payment Terms: ${quote.paymentTerms}`, x: 40, y, size: 8 })
  if (quote.deliveryTerms) {
    y -= 12
    lines.push({ text: `Delivery Terms: ${quote.deliveryTerms}`, x: 40, y, size: 8 })
  }
  if (quote.warranty) {
    y -= 12
    lines.push({ text: `Warranty: ${quote.warranty}`, x: 40, y, size: 8 })
  }

  if (quote.notes) {
    y -= 16
    lines.push({ text: `Notes: ${quote.notes}`, x: 40, y, size: 8 })
  }

  return lines
}

export const createQuotePdfBlob = (quote: Quote) => createPdfBlob(buildQuotePdfLines(quote))

export const downloadQuotePdf = (quote: Quote) => {
  const blob = createQuotePdfBlob(quote)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${quote.ref}.pdf`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
