import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  startLetterheadDocument,
  finishLetterheadDocument,
  drawDocumentIntro,
  money,
  MARGIN,
  contentW,
  right,
  INK,
  MUTED,
  SOFT,
  BORDER,
  type DeedPdfCompanyInput,
} from '@/lib/deed-document-pdf'
import type { PayslipDetail } from '@/lib/hr/payroll-report-types'

/**
 * Payslips and the P9 tax card, on the same letterhead as every other document
 * the company issues — logo, accent colour, print template and font come from
 * Settings via lib/deed-document-pdf.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const mask = (v: string) => (v && v.length > 4 ? `${'*'.repeat(v.length - 4)}${v.slice(-4)}` : v)

export function payslipFileName(d: PayslipDetail) {
  return `Payslip-${d.reference.replace(/[/\\]/g, '-')}.pdf`
}

/** A4 payslip with the full earnings and deduction breakdown, employer cost, and year-to-date. */
export function buildPayslipPdf(d: PayslipDetail, company: DeedPdfCompanyInput): jsPDF {
  const { doc, accent, shell } = startLetterheadDocument(company, 'Payslip', d.reference)
  const currency = company.currency || 'KES'
  const width = contentW(doc)
  const monthName = MONTHS[(Number(d.period.month) || 1) - 1] ?? d.period.month
  const amount = (n: number) => money(n)
  const e = d.employee

  let y = drawDocumentIntro(doc, accent, {
    title: 'Payslip',
    partyLabel: 'Employee',
    partyName: e.name || '—',
    meta: [
      ['Pay period', `${monthName} ${d.period.year}`],
      ['Reference', d.reference],
      ['Paid by', e.paymentMode === 'mpesa' ? `M-Pesa ${e.mpesaNumber || ''}`.trim() : `${e.bankName || 'Bank'} ${mask(e.bankAccount)}`.trim()],
    ],
  })

  const facts: Array<[string, string]> = [
    ['Employee No.', e.number],
    ['Job title', e.jobTitle || '—'],
    ['Department', e.department || '—'],
    ['KRA PIN', e.kraPin || '—'],
    ['NSSF No.', e.nssfNumber || '—'],
    ['SHA No.', e.shaNumber || '—'],
  ]
  const factW = width / 3
  facts.forEach(([label, value], index) => {
    const x = MARGIN + (index % 3) * factW
    const rowY = y + Math.floor(index / 3) * 26
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED)
    doc.text(label, x, rowY)
    doc.setFont('helvetica', 'bold').setFontSize(8.3).setTextColor(...INK)
    doc.text(value, x, rowY + 11, { maxWidth: factW - 12 })
  })
  y += 26 * Math.ceil(facts.length / 3) + 10

  const table = {
    theme: 'plain' as const,
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 5, textColor: INK, lineColor: BORDER, lineWidth: { bottom: .4 } as never },
    headStyles: { fillColor: accent, textColor: [255, 255, 255] as [number, number, number], fontStyle: 'bold' as const, fontSize: 6.6 },
    footStyles: { fillColor: SOFT, textColor: INK, fontStyle: 'bold' as const },
    columnStyles: { 1: { halign: 'right' as const, cellWidth: 92 } },
    showFoot: 'lastPage' as const,
  }
  const half = (width - 16) / 2
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  autoTable(doc, {
    ...table,
    startY: y,
    margin: { left: MARGIN, right: MARGIN + half + 16 },
    head: [['EARNINGS', { content: `AMOUNT (${currency})`, styles: { halign: 'right' as const } }]],
    body: d.earnings.map(r => [r.label, amount(r.amount)]),
    foot: [['Gross pay', amount(d.gross)]],
  })
  const leftEnd = finalY()

  autoTable(doc, {
    ...table,
    startY: y,
    margin: { left: MARGIN + half + 16, right: MARGIN },
    head: [['DEDUCTIONS', { content: `AMOUNT (${currency})`, styles: { halign: 'right' as const } }]],
    body: d.deductions.length ? d.deductions.map(r => [r.label, amount(r.amount)]) : [['None', amount(0)]],
    foot: [['Total deductions', amount(d.totalDeductions)]],
  })
  y = Math.max(leftEnd, finalY()) + 18

  // What actually reaches the employee, in the accent colour.
  doc.setFillColor(...accent).roundedRect(MARGIN, y, width, 34, 4, 4, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(255, 255, 255)
  doc.text('NET PAY', MARGIN + 14, y + 21)
  doc.setFontSize(14).text(`${currency} ${amount(d.net)}`, right(doc) - 14, y + 22, { align: 'right' })
  y += 52

  if (d.advances.length) {
    autoTable(doc, {
      ...table,
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      head: [['SALARY ADVANCE', { content: 'RECOVERED THIS MONTH', styles: { halign: 'right' as const } }, { content: 'BALANCE AFTER', styles: { halign: 'right' as const } }]],
      body: d.advances.map(a => [a.ref, amount(a.amount), amount(a.remainingAfter)]),
    })
    y = finalY() + 14
  }

  const sideBySide = y
  autoTable(doc, {
    ...table,
    startY: sideBySide,
    margin: { left: MARGIN, right: MARGIN + half + 16 },
    head: [['EMPLOYER CONTRIBUTIONS', { content: `AMOUNT (${currency})`, styles: { halign: 'right' as const } }]],
    body: d.employer.length ? d.employer.map(r => [r.label, amount(r.amount)]) : [['None', amount(0)]],
  })
  const employerEnd = finalY()
  autoTable(doc, {
    ...table,
    startY: sideBySide,
    margin: { left: MARGIN + half + 16, right: MARGIN },
    head: [[`YEAR TO DATE (${d.period.year})`, { content: `AMOUNT (${currency})`, styles: { halign: 'right' as const } }]],
    body: [
      ['Gross pay', amount(d.ytd.gross)],
      ['PAYE', amount(d.ytd.paye)],
      ['NSSF', amount(d.ytd.nssf)],
      ['Net pay', amount(d.ytd.net)],
    ],
  })
  y = Math.max(employerEnd, finalY())

  if (d.taxNotes?.length) {
    autoTable(doc, {
      ...table,
      startY: y + 12,
      margin: { left: MARGIN, right: MARGIN },
      head: [['TAX NOTES', { content: `AMOUNT (${currency})`, styles: { halign: 'right' as const } }]],
      body: d.taxNotes.map(r => [r.label, amount(r.amount)]),
    })
    y = finalY()
  }

  doc.setFont('helvetica', 'italic').setFontSize(7.2).setTextColor(...MUTED)
  doc.text('This is a computer-generated payslip and does not require a signature.', MARGIN, y + 22, { maxWidth: width * .7 })
  doc.text(`Run ${d.period.runReference}${d.paymentStatus === 'paid' ? ' · Paid' : ''}`, right(doc), y + 22, { align: 'right' })

  return finishLetterheadDocument(doc, company, shell)
}

export function downloadPayslipPdfFile(d: PayslipDetail, company: DeedPdfCompanyInput) {
  buildPayslipPdf(d, company).save(payslipFileName(d))
}

export function openPayslipPdfForPrint(d: PayslipDetail, company: DeedPdfCompanyInput): boolean {
  const url = buildPayslipPdf(d, company).output('bloburl')
  return Boolean(window.open(url, '_blank'))
}

/** KRA P9 tax deduction card (annual, one employee). Landscape: twelve months across ten columns. */
export function buildP9Pdf(
  emp: { employeeNo: string; employeeName: string; kraPin: string; months: Array<{ month: number; basic: number; benefits: number; gross: number; nssf: number; shif: number; housingLevy: number; pension: number; taxablePay: number; taxCharged: number; personalRelief: number; insuranceRelief: number; paye: number }> },
  year: number,
  company: DeedPdfCompanyInput,
): jsPDF {
  const { doc, accent, shell } = startLetterheadDocument(company, 'Tax deduction card (P9)', `P9/${year}/${emp.employeeNo}`, 'landscape')
  const y = drawDocumentIntro(doc, accent, {
    title: 'Tax deduction card (P9)',
    partyLabel: 'Employee',
    partyName: `${emp.employeeName} (${emp.employeeNo})`,
    partyLines: [`Employee PIN: ${emp.kraPin || '—'}`],
    meta: [['Year of income', String(year)], ['Employer PIN', company.kraPin || '—']],
    metaRatio: .66,
  })

  const n = (v: number) => money(v)
  const sum = (f: (x: typeof emp.months[number]) => number) => emp.months.reduce((s, x) => s + f(x), 0)
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: 108, bottom: 62 },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 4, textColor: INK, lineColor: BORDER, lineWidth: .45 },
    headStyles: { fillColor: accent, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.6 },
    footStyles: { fillColor: SOFT, textColor: INK, fontStyle: 'bold' },
    columnStyles: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => [i, { halign: 'right' }])),
    head: [['MONTH', 'BASIC SALARY', 'BENEFITS', 'GROSS PAY', 'NSSF + PENSION', 'SHIF + HOUSING LEVY', 'TAXABLE PAY', 'TAX CHARGED', 'PERSONAL + INSURANCE RELIEF', 'PAYE']],
    body: emp.months.map(x => [MONTHS[x.month - 1], n(x.basic), n(x.benefits), n(x.gross), n(x.nssf + x.pension), n(x.shif + x.housingLevy), n(x.taxablePay), n(x.taxCharged), n(x.personalRelief + x.insuranceRelief), n(x.paye)]),
    foot: [['TOTAL', ...[
      sum(x => x.basic), sum(x => x.benefits), sum(x => x.gross), sum(x => x.nssf + x.pension), sum(x => x.shif + x.housingLevy),
      sum(x => x.taxablePay), sum(x => x.taxCharged), sum(x => x.personalRelief + x.insuranceRelief), sum(x => x.paye),
    ].map(v => ({ content: n(v), styles: { halign: 'right' as const } }))]],
  })

  return finishLetterheadDocument(doc, company, shell)
}
