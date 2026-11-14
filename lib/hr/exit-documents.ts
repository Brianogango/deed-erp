import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { FinalDuesStatement } from '@/lib/hr/final-dues'

export interface ExitCompany { name: string; address?: string; city?: string; phone?: string; email?: string; kraPin?: string }
export interface ExitEmployee { name: string; employeeNo: string; jobTitle: string; department: string; idNumber: string; startDate: string; exitDate: string; exitReason?: string }

const NAVY: [number, number, number] = [18, 52, 86]
const INK: [number, number, number] = [30, 41, 59]
const MUTED: [number, number, number] = [100, 116, 139]
const LINE: [number, number, number] = [226, 232, 240]
const SOFT: [number, number, number] = [241, 245, 249]
const kes = (n: number) => `${n < 0 ? '-' : ''}KSh ${Math.abs(Number(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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

function header(doc: jsPDF, company: ExitCompany, title: string) {
  const W = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...NAVY).text(company.name, 40, 52)
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
  const sub = [[company.address, company.city].filter(Boolean).join(', '), company.phone, company.email, company.kraPin ? `KRA PIN: ${company.kraPin}` : ''].filter(Boolean)
  sub.forEach((t, i) => doc.text(String(t), 40, 66 + i * 11))
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...INK).text(title, W - 40, 52, { align: 'right' })
  doc.setDrawColor(...NAVY).setLineWidth(1.2).line(40, 112, W - 40, 112)
}

/** Certificate of service (Employment Act, s.51). States the facts of employment only. */
export function buildCertificateOfService(emp: ExitEmployee, company: ExitCompany, issuedOn: string): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const L = 56
  const R = W - 56

  // Letterhead: name on the left, contact details on the right, one rule.
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...NAVY).text(company.name, L, 62)
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED)
  const contact = [[company.address, company.city].filter(Boolean).join(', '), [company.phone, company.email].filter(Boolean).join('  ·  '), company.kraPin ? `KRA PIN ${company.kraPin}` : ''].filter(Boolean)
  contact.forEach((t, i) => doc.text(t, R, 48 + i * 12, { align: 'right' }))
  doc.setDrawColor(...NAVY).setLineWidth(1.2).line(L, 84, R, 84)

  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...MUTED)
  if (emp.employeeNo) doc.text(`Ref: ${emp.employeeNo}/COS`, L, 116)
  doc.text(longDate(issuedOn), R, 116, { align: 'right' })

  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...INK).text('CERTIFICATE OF SERVICE', W / 2, 168, { align: 'center' })
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...MUTED).text('To whom it may concern', W / 2, 186, { align: 'center' })

  doc.setFontSize(11).setTextColor(...INK)
  const intro = doc.splitTextToSize(`This is to certify that the person named below was employed by ${company.name}. The particulars of the employment are as follows.`, R - L) as string[]
  doc.text(intro, L, 228, { lineHeightFactor: 1.5 })

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
    startY: 228 + intro.length * 17 + 8,
    margin: { left: L, right: 56 },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 11, cellPadding: { top: 8, bottom: 8, left: 0, right: 8 }, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.6 } as never },
    columnStyles: { 0: { cellWidth: 150, textColor: MUTED }, 1: { fontStyle: 'bold' } },
    body: rows,
  })
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 32

  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(...INK)
  doc.text('This certificate is issued in accordance with Section 51 of the Employment Act, 2007.', L, y)
  y += 78

  // Signature on the left, room for the company stamp on the right.
  doc.setDrawColor(...MUTED).setLineWidth(0.6).line(L, y, L + 200, y)
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK).text('Authorised signatory', L, y + 15)
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...MUTED)
  doc.text(`For ${company.name}`, L, y + 29)
  doc.text('Name and designation:', L, y + 52)
  doc.setDrawColor(...LINE).line(L + 108, y + 54, L + 260, y + 54)
  doc.setLineDashPattern([3, 3], 0).setDrawColor(...MUTED).roundedRect(R - 130, y - 62, 130, 92, 6, 6)
  doc.setLineDashPattern([], 0)
  doc.setFontSize(8).text('Company stamp', R - 65, y - 12, { align: 'center' })

  doc.setDrawColor(...LINE).setLineWidth(0.6).line(L, H - 54, R, H - 54)
  doc.setFontSize(8).setTextColor(...MUTED).text(`${company.name} — this certificate states the facts of employment only.`, W / 2, H - 40, { align: 'center' })
  return doc
}

/** Final dues statement for the exit file and for the employee to sign. */
export function buildFinalDuesPdf(emp: ExitEmployee, company: ExitCompany, s: FinalDuesStatement): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  header(doc, company, 'FINAL DUES STATEMENT')
  const pairs: Array<[string, string]> = [
    ['Employee', `${emp.name} (${emp.employeeNo})`],
    ['Position', emp.jobTitle || '—'],
    ['Service', `${longDate(emp.startDate)} to ${longDate(emp.exitDate)}`],
    ['Reason for exit', emp.exitReason || '—'],
  ]
  pairs.forEach(([k, v], i) => {
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED).text(k, 40, 134 + i * 14)
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK).text(v, 130, 134 + i * 14)
  })
  const right = { halign: 'right' as const }
  const amt = (n: number) => kes(n)
  const rows: Array<Array<string | { content: string; styles: Record<string, unknown> }>> = []
  const section = (title: string) => rows.push([{ content: title, styles: { fontStyle: 'bold', fillColor: SOFT, textColor: NAVY } }, { content: '', styles: { fillColor: SOFT } }])
  section('Earnings')
  s.earnings.forEach(e => rows.push([e.label, { content: amt(e.amount), styles: right }]))
  if (!s.earnings.length) rows.push(['No amounts due', { content: amt(0), styles: right }])
  rows.push([{ content: 'Gross terminal pay', styles: { fontStyle: 'bold' } }, { content: amt(s.gross), styles: { ...right, fontStyle: 'bold' } }])
  if (s.statutory.length) { section('Statutory deductions (estimate)'); s.statutory.forEach(r => rows.push([r.label, { content: amt(-r.amount), styles: right }])) }
  if (s.recoveries.length) { section('Recoveries'); s.recoveries.forEach(r => rows.push([r.label, { content: amt(-r.amount), styles: right }])) }
  rows.push([{ content: s.net >= 0 ? 'NET PAYABLE TO EMPLOYEE' : 'BALANCE OWED BY EMPLOYEE', styles: { fontStyle: 'bold', fillColor: NAVY, textColor: [255, 255, 255] } }, { content: amt(Math.abs(s.net)), styles: { ...right, fontStyle: 'bold', fillColor: NAVY, textColor: [255, 255, 255] } }])
  autoTable(doc, {
    startY: 206, margin: { left: 40, right: 40 }, theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 5, textColor: INK, lineColor: LINE },
    body: rows as never,
  })
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18
  doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(...MUTED)
  const note = doc.splitTextToSize('Statutory deductions are an estimate; the final PAYE position is confirmed on the payroll run that pays this statement. Daily rate for leave and notice = basic salary / 30.', W - 80) as string[]
  doc.text(note, 40, y)
  const sy = y + note.length * 10 + 50
  doc.setDrawColor(...MUTED).setLineWidth(0.6).line(40, sy, 230, sy).line(W - 230, sy, W - 40, sy)
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...INK)
  doc.text('Prepared by (HR)', 40, sy + 12)
  doc.text('Received by (employee)', W - 230, sy + 12)
  return doc
}
