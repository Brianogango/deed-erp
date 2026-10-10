import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { PayslipDetail } from '@/lib/hr/payroll-report-types'

export interface PayslipCompany {
  name: string
  address?: string
  city?: string
  phone?: string
  email?: string
  kraPin?: string
}

const NAVY: [number, number, number] = [18, 52, 86]
const INK: [number, number, number] = [30, 41, 59]
const MUTED: [number, number, number] = [100, 116, 139]
const LINE: [number, number, number] = [226, 232, 240]
const SOFT: [number, number, number] = [241, 245, 249]

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const kes = (n: number) => `KSh ${(Number(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const mask = (v: string) => (v && v.length > 4 ? `${'*'.repeat(v.length - 4)}${v.slice(-4)}` : v)

export function payslipFileName(d: PayslipDetail) {
  return `Payslip-${d.reference.replace(/[/\\]/g, '-')}.pdf`
}

/** A4 payslip with the full earnings and deduction breakdown, employer cost, and year-to-date. */
export function buildPayslipPdf(d: PayslipDetail, company: PayslipCompany): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 40
  const monthName = MONTHS[(Number(d.period.month) || 1) - 1] ?? d.period.month

  // Header: company on the left, document title on the right.
  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...NAVY)
  doc.text(company.name || 'Company', M, 52)
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
  const sub = [[company.address, company.city].filter(Boolean).join(', '), company.phone, company.email].filter(Boolean)
  sub.forEach((t, i) => doc.text(String(t), M, 66 + i * 11))
  if (company.kraPin) doc.text(`KRA PIN: ${company.kraPin}`, M, 66 + sub.length * 11)

  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...INK)
  doc.text('PAYSLIP', W - M, 52, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED)
  doc.text(`${monthName} ${d.period.year}`, W - M, 66, { align: 'right' })
  doc.text(`Ref: ${d.reference}`, W - M, 78, { align: 'right' })

  doc.setDrawColor(...NAVY).setLineWidth(1.2).line(M, 104, W - M, 104)

  // Employee block (two columns of label / value pairs).
  const e = d.employee
  const left: Array<[string, string]> = [
    ['Employee', e.name],
    ['Employee No.', e.number],
    ['Job title', e.jobTitle || '—'],
    ['Department', e.department || '—'],
    ['Pay period', `${d.period.start} to ${d.period.end}`],
  ]
  const right: Array<[string, string]> = [
    ['KRA PIN', e.kraPin || '—'],
    ['NSSF No.', e.nssfNumber || '—'],
    ['SHA No.', e.shaNumber || '—'],
    ['ID No.', e.idNumber || '—'],
    ['Paid by', e.paymentMode === 'mpesa' ? `M-Pesa ${e.mpesaNumber || ''}`.trim() : `${e.bankName || 'Bank'} ${mask(e.bankAccount)}`.trim()],
  ]
  const drawPairs = (pairs: Array<[string, string]>, x: number) => {
    pairs.forEach(([k, v], i) => {
      const y = 124 + i * 14
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED).text(k, x, y)
      doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...INK).text(v, x + 72, y, { maxWidth: 160 })
    })
  }
  drawPairs(left, M)
  drawPairs(right, W / 2 + 10)

  const tableOpts = {
    theme: 'plain' as const,
    styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 4, bottom: 4, left: 6, right: 6 }, textColor: INK },
    headStyles: { fillColor: SOFT, textColor: NAVY, fontStyle: 'bold' as const, lineColor: LINE, lineWidth: { bottom: 0.7 } },
    footStyles: { fillColor: SOFT, textColor: INK, fontStyle: 'bold' as const },
    columnStyles: { 1: { halign: 'right' as const, cellWidth: 100 } },
    showFoot: 'lastPage' as const,
  }
  const half = (W - M * 2 - 16) / 2

  const startY = 124 + 5 * 14 + 14
  autoTable(doc, {
    ...tableOpts,
    startY,
    margin: { left: M, right: W - M - half },
    head: [['Earnings', { content: 'Amount', styles: { halign: 'right' as const } }]],
    body: d.earnings.map(r => [r.label, kes(r.amount)]),
    foot: [['Gross pay', kes(d.gross)]],
  })
  const leftEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  autoTable(doc, {
    ...tableOpts,
    startY,
    margin: { left: M + half + 16, right: M },
    head: [['Deductions', { content: 'Amount', styles: { halign: 'right' as const } }]],
    body: d.deductions.length ? d.deductions.map(r => [r.label, kes(r.amount)]) : [['None', kes(0)]],
    foot: [['Total deductions', kes(d.totalDeductions)]],
  })
  const rightEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  // Net pay band.
  let y = Math.max(leftEnd, rightEnd) + 18
  doc.setFillColor(...NAVY).roundedRect(M, y, W - M * 2, 34, 4, 4, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(255, 255, 255)
  doc.text('NET PAY', M + 14, y + 21)
  doc.setFontSize(14).text(kes(d.net), W - M - 14, y + 22, { align: 'right' })
  y += 52

  // Salary advance recovery detail, when present.
  if (d.advances.length) {
    autoTable(doc, {
      ...tableOpts,
      startY: y,
      margin: { left: M, right: M },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      head: [['Salary advance', { content: 'Recovered this month', styles: { halign: 'right' as const } }, { content: 'Balance after', styles: { halign: 'right' as const } }]],
      body: d.advances.map(a => [a.ref, kes(a.amount), kes(a.remainingAfter)]),
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14
  }

  // Employer contributions and year-to-date side by side.
  const boxY = y
  autoTable(doc, {
    ...tableOpts,
    startY: boxY,
    margin: { left: M, right: W - M - half },
    head: [['Employer contributions', { content: 'Amount', styles: { halign: 'right' as const } }]],
    body: d.employer.length ? d.employer.map(r => [r.label, kes(r.amount)]) : [['None', kes(0)]],
  })
  const erEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  autoTable(doc, {
    ...tableOpts,
    startY: boxY,
    margin: { left: M + half + 16, right: M },
    head: [[`Year to date (${d.period.year})`, { content: 'Amount', styles: { halign: 'right' as const } }]],
    body: [
      ['Gross pay', kes(d.ytd.gross)],
      ['PAYE', kes(d.ytd.paye)],
      ['NSSF', kes(d.ytd.nssf)],
      ['Net pay', kes(d.ytd.net)],
    ],
  })
  const ytdEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  let notesEnd = Math.max(erEnd, ytdEnd)
  if (d.taxNotes?.length) {
    autoTable(doc, {
      ...tableOpts,
      startY: notesEnd + 12,
      margin: { left: M, right: M },
      columnStyles: { 1: { halign: 'right' } },
      head: [['Tax notes', { content: 'Amount', styles: { halign: 'right' as const } }]],
      body: d.taxNotes.map(r => [r.label, kes(r.amount)]),
    })
    notesEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  }
  const footY = notesEnd + 28
  doc.setFont('helvetica', 'italic').setFontSize(7.5).setTextColor(...MUTED)
  doc.text('This is a computer-generated payslip and does not require a signature.', M, Math.min(footY, 790))
  doc.text(`Run ${d.period.runReference}${d.paymentStatus === 'paid' ? ' · Paid' : ''}`, W - M, Math.min(footY, 790), { align: 'right' })
  return doc
}

export function downloadPayslipPdfFile(d: PayslipDetail, company: PayslipCompany) {
  buildPayslipPdf(d, company).save(payslipFileName(d))
}

export function openPayslipPdfForPrint(d: PayslipDetail, company: PayslipCompany): boolean {
  const url = buildPayslipPdf(d, company).output('bloburl')
  return Boolean(window.open(url, '_blank'))
}

/** KRA P9 tax deduction card (annual, one employee). */
export function buildP9Pdf(
  emp: { employeeNo: string; employeeName: string; kraPin: string; months: Array<{ month: number; basic: number; benefits: number; gross: number; nssf: number; shif: number; housingLevy: number; pension: number; taxablePay: number; taxCharged: number; personalRelief: number; insuranceRelief: number; paye: number }> },
  year: number,
  company: PayslipCompany,
): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const W = doc.internal.pageSize.getWidth()
  const M = 36
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...NAVY)
  doc.text('TAX DEDUCTION CARD (P9)', M, 42)
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...INK)
  doc.text(`Year: ${year}`, W - M, 42, { align: 'right' })
  doc.setFontSize(9)
  doc.text(`Employer: ${company.name}${company.kraPin ? `   PIN: ${company.kraPin}` : ''}`, M, 62)
  doc.text(`Employee: ${emp.employeeName} (${emp.employeeNo})   PIN: ${emp.kraPin || '—'}`, M, 76)

  const n = (v: number) => (Number(v) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const body = emp.months.map(x => [MONTHS[x.month - 1], n(x.basic), n(x.benefits), n(x.gross), n(x.nssf + x.pension), n(x.shif + x.housingLevy), n(x.taxablePay), n(x.taxCharged), n(x.personalRelief + x.insuranceRelief), n(x.paye)])
  const sum = (f: (x: typeof emp.months[number]) => number) => emp.months.reduce((s, x) => s + f(x), 0)
  autoTable(doc, {
    startY: 92,
    margin: { left: M, right: M },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 4, textColor: INK, lineColor: LINE },
    headStyles: { fillColor: SOFT, textColor: NAVY, fontStyle: 'bold' },
    columnStyles: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => [i, { halign: 'right' }])),
    head: [['Month', 'Basic salary', 'Benefits', 'Gross pay', 'NSSF + pension', 'SHIF + housing levy', 'Taxable pay', 'Tax charged', 'Personal + insurance relief', 'PAYE']],
    body,
    foot: [['TOTAL', n(sum(x => x.basic)), n(sum(x => x.benefits)), n(sum(x => x.gross)), n(sum(x => x.nssf + x.pension)), n(sum(x => x.shif + x.housingLevy)), n(sum(x => x.taxablePay)), n(sum(x => x.taxCharged)), n(sum(x => x.personalRelief + x.insuranceRelief)), n(sum(x => x.paye))]],
    footStyles: { fillColor: SOFT, textColor: INK, fontStyle: 'bold' },
  })
  return doc
}
