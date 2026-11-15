import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  startLetterheadDocument,
  finishLetterheadDocument,
  ensureRoom,
  writeLabel,
  writeValue,
  drawMetaRow,
  line,
  money,
  MARGIN,
  contentW,
  right,
  BODY_TOP,
  INK,
  MUTED,
  SOFT,
  BORDER,
  type DeedPdfCompanyInput,
} from '@/lib/deed-document-pdf'
import type { FinalDuesStatement } from '@/lib/hr/final-dues'

/**
 * The documents an employee leaves with, on the same letterhead as every other
 * document the company issues: logo, accent colour, print template, font and
 * paper size all come from Settings via lib/deed-document-pdf.
 */

export interface ExitEmployee { name: string; employeeNo: string; jobTitle: string; department: string; idNumber: string; startDate: string; exitDate: string; exitReason?: string }

/** Dates are written out in full on these documents: "4 November 2026", not "04 Nov 2026". */
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Length of service as "X years, Y months, Z days". */
export function lengthOfService(startIso: string, endIso: string): string {
  const s = new Date(`${startIso}T00:00:00Z`)
  const last = new Date(`${endIso}T00:00:00Z`)
  if (Number.isNaN(s.getTime()) || Number.isNaN(last.getTime()) || last < s) return '—'
  // Count both the first and last day: measure to the day after the last working day.
  const e = new Date(last.getTime() + 86400000)
  let years = e.getUTCFullYear() - s.getUTCFullYear()
  let months = e.getUTCMonth() - s.getUTCMonth()
  let days = e.getUTCDate() - s.getUTCDate()
  if (days < 0) { months -= 1; days += new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 0)).getUTCDate() }
  if (months < 0) { years -= 1; months += 12 }
  const parts = [
    years ? `${years} year${years === 1 ? '' : 's'}` : '',
    months ? `${months} month${months === 1 ? '' : 's'}` : '',
    days > 0 ? `${days} day${days === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'less than a day'
}

/** Signature rule, who signs, and room for the company stamp. */
function signOff(doc: jsPDF, company: DeedPdfCompanyInput, y: number) {
  line(doc, MARGIN, y, right(doc), BORDER, .55)
  writeLabel(doc, 'Authorised by', MARGIN, y + 18)

  line(doc, MARGIN, y + 74, MARGIN + 210, MUTED, .6)
  doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...INK)
  doc.text('Authorised signatory', MARGIN, y + 88)
  doc.setFont('helvetica', 'normal').setFontSize(7.7).setTextColor(...MUTED)
  doc.text(`For ${company.name}`, MARGIN, y + 100)
  doc.text('Name and designation:', MARGIN, y + 120)
  line(doc, MARGIN + 102, y + 122, MARGIN + 290, BORDER, .55)

  // Dashed, so it reads as a space to stamp rather than a drawn box. The pattern
  // must be cleared again or every later rule — the page footer included — is dashed.
  doc.setLineDashPattern([3, 3], 0).setDrawColor(...BORDER).setLineWidth(.55)
  doc.roundedRect(right(doc) - 140, y + 14, 140, 100, 4, 4)
  doc.setLineDashPattern([], 0)
  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED)
  doc.text('Company stamp', right(doc) - 70, y + 68, { align: 'center' })
}

/** Certificate of service (Employment Act, s.51). States the facts of employment only. */
export function buildCertificateOfService(emp: ExitEmployee, company: DeedPdfCompanyInput, issuedOn: string): jsPDF {
  const reference = emp.employeeNo ? `${emp.employeeNo}/COS` : 'Certificate of service'
  const { doc, accent, shell } = startLetterheadDocument(company, 'Certificate of service', reference)
  const width = contentW(doc)
  const metaX = MARGIN + width * .58
  let y = BODY_TOP

  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...accent)
  doc.text('CERTIFICATE OF SERVICE', MARGIN, y)
  y += 26

  writeLabel(doc, 'To whom it may concern', MARGIN, y)
  if (emp.employeeNo) drawMetaRow(doc, 'Reference', reference, metaX, y, 84)
  drawMetaRow(doc, 'Date issued', longDate(issuedOn), metaX, emp.employeeNo ? y + 17 : y, 84)
  y += 38

  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...INK)
  const intro = doc.splitTextToSize(
    `This is to certify that the person named below was employed by ${company.name}. The particulars of the employment are as follows.`,
    width,
  ) as string[]
  doc.text(intro, MARGIN, y)
  y += intro.length * 14 + 18

  writeLabel(doc, 'Particulars of employment', MARGIN, y)
  y += 8

  const rows: Array<[string, string]> = ([
    ['Name', emp.name],
    ['National ID No.', emp.idNumber],
    ['Employee No.', emp.employeeNo],
    ['Position held', emp.jobTitle],
    ['Department', emp.department],
    ['Date of joining', longDate(emp.startDate)],
    ['Last day of service', longDate(emp.exitDate)],
    ['Length of service', lengthOfService(emp.startDate, emp.exitDate)],
  ] as Array<[string, string]>).filter(([, value]) => Boolean(value))

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: 108, bottom: 62 },
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      textColor: INK,
      lineColor: BORDER,
      lineWidth: { bottom: .4 } as never,
      cellPadding: { top: 7, right: 6, bottom: 7, left: 0 },
    },
    columnStyles: {
      0: { cellWidth: 150, fontSize: 7.5, fontStyle: 'bold', textColor: MUTED },
      1: { fontStyle: 'bold' },
    },
    body: rows,
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24

  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...INK)
  doc.text('This certificate is issued in accordance with Section 51 of the Employment Act, 2007.', MARGIN, y, { maxWidth: width })
  // Sits low on the page, like the payment block on an invoice, so a short
  // certificate does not leave the signature stranded under the text.
  y = ensureRoom(doc, company, shell, Math.max(y + 34, 560), 150)

  signOff(doc, company, y)

  doc.setFont('helvetica', 'italic').setFontSize(7.2).setTextColor(...MUTED)
  doc.text('This certificate states the facts of employment only.', MARGIN, y + 150, { maxWidth: width })

  return finishLetterheadDocument(doc, company, shell)
}

/** Final dues statement for the exit file and for the employee to sign. */
export function buildFinalDuesPdf(emp: ExitEmployee, company: DeedPdfCompanyInput, s: FinalDuesStatement): jsPDF {
  const reference = emp.employeeNo ? `${emp.employeeNo}/FDS` : 'Final dues statement'
  const { doc, accent, shell } = startLetterheadDocument(company, 'Final dues statement', reference)
  const currency = company.currency || 'KES'
  const width = contentW(doc)
  const metaX = MARGIN + width * .58
  let y = BODY_TOP

  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...accent)
  doc.text('FINAL DUES STATEMENT', MARGIN, y)
  y += 26

  writeLabel(doc, 'Employee', MARGIN, y)
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK)
  doc.text(emp.name || '—', MARGIN, y + 16, { maxWidth: metaX - MARGIN - 20 })
  let partyY = y + 31
  ;[emp.employeeNo ? `Employee No. ${emp.employeeNo}` : '', emp.jobTitle, emp.department]
    .filter(Boolean)
    .forEach(value => { writeValue(doc, String(value), MARGIN, partyY, { maxWidth: metaX - MARGIN - 20 }); partyY += 12 })

  // Joined and the last day are separate rows: drawMetaRow caps a value at 175pt,
  // which a whole date range would overrun at this column.
  drawMetaRow(doc, 'Joined', longDate(emp.startDate), metaX, y, 84)
  drawMetaRow(doc, 'Last working day', longDate(emp.exitDate), metaX, y + 17, 84)
  drawMetaRow(doc, 'Reason for exit', emp.exitReason || '—', metaX, y + 34, 84)
  y = Math.max(partyY, y + 48) + 12

  const boxes: Array<[string, number, boolean?]> = [
    ['GROSS TERMINAL PAY', s.gross],
    ['TOTAL DEDUCTIONS', s.totalDeductions],
    [s.net >= 0 ? 'NET PAYABLE' : 'OWED BY EMPLOYEE', Math.abs(s.net), true],
  ]
  const gap = 8
  const boxW = (width - gap * (boxes.length - 1)) / boxes.length
  boxes.forEach(([label, value, strong], index) => {
    const x = MARGIN + index * (boxW + gap)
    doc.setFillColor(...(strong ? accent : SOFT))
    doc.setDrawColor(...(strong ? accent : BORDER)).setLineWidth(.5).roundedRect(x, y, boxW, 44, 4, 4, 'FD')
    doc.setFont('helvetica', 'bold').setFontSize(6.6).setTextColor(...(strong ? [255, 255, 255] as [number, number, number] : MUTED))
    doc.text(label, x + 9, y + 14)
    doc.setFont('helvetica', 'bold').setFontSize(strong ? 12 : 10.5).setTextColor(...(strong ? [255, 255, 255] as [number, number, number] : INK))
    doc.text(`${currency} ${money(value)}`, x + 9, y + 33, { maxWidth: boxW - 14 })
  })
  y += 58

  const rows: Array<Array<string | { content: string; styles: Record<string, unknown> }>> = []
  const section = (title: string) => rows.push(
    [{ content: title, styles: { fontStyle: 'bold', fontSize: 7, fillColor: SOFT, textColor: accent } },
     { content: '', styles: { fillColor: SOFT } }],
  )
  const right_ = { halign: 'right' as const }

  section('Earnings')
  s.earnings.forEach(e => rows.push([e.label, { content: money(e.amount), styles: right_ }]))
  if (!s.earnings.length) rows.push(['No amounts due', { content: money(0), styles: right_ }])
  rows.push([
    { content: 'Gross terminal pay', styles: { fontStyle: 'bold' } },
    { content: money(s.gross), styles: { ...right_, fontStyle: 'bold' } },
  ])
  if (s.statutory.length) {
    section('Statutory deductions (estimate)')
    s.statutory.forEach(r => rows.push([r.label, { content: `- ${money(r.amount)}`, styles: right_ }]))
  }
  if (s.recoveries.length) {
    section('Recoveries')
    s.recoveries.forEach(r => rows.push([r.label, { content: `- ${money(r.amount)}`, styles: right_ }]))
  }
  rows.push([
    { content: s.net >= 0 ? 'NET PAYABLE TO EMPLOYEE' : 'BALANCE OWED BY EMPLOYEE', styles: { fontStyle: 'bold', fontSize: 9, fillColor: SOFT } },
    { content: money(Math.abs(s.net)), styles: { ...right_, fontStyle: 'bold', fontSize: 9, fillColor: SOFT } },
  ])

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: 108, bottom: 62 },
    theme: 'plain',
    head: [['DESCRIPTION', `AMOUNT (${currency})`]],
    headStyles: { fillColor: accent, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.6 },
    styles: { font: 'helvetica', fontSize: 8, textColor: INK, lineColor: BORDER, lineWidth: { bottom: .4 } as never, cellPadding: 5 },
    columnStyles: { 1: { cellWidth: 110, halign: 'right' } },
    didParseCell: data => { if (data.section === 'head' && data.column.index === 1) data.cell.styles.halign = 'right' },
    body: rows as never,
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18

  doc.setFont('helvetica', 'italic').setFontSize(7.2).setTextColor(...MUTED)
  const note = doc.splitTextToSize(
    'Statutory deductions are an estimate; the final PAYE position is confirmed on the payroll run that pays this statement. Daily rate for leave and notice = basic salary / 30.',
    width,
  ) as string[]
  doc.text(note, MARGIN, y)
  y = ensureRoom(doc, company, shell, Math.max(y + note.length * 10 + 24, 600), 108)

  // Both sides sign: HR prepared it, the employee acknowledges the amount.
  line(doc, MARGIN, y, right(doc), BORDER, .55)
  const columnX = [MARGIN, MARGIN + width / 2 + 14]
  writeLabel(doc, 'Prepared by (HR)', columnX[0], y + 18)
  writeLabel(doc, 'Received by (employee)', columnX[1], y + 18)
  ;['Signature', 'Name', 'Date'].forEach((field, index) => {
    const rowY = y + 42 + index * 18
    columnX.forEach(x => {
      doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED)
      doc.text(field, x, rowY)
      line(doc, x + 46, rowY + 2, x + width / 2 - 20, BORDER, .5)
    })
  })

  return finishLetterheadDocument(doc, company, shell)
}
