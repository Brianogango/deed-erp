import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { longDate } from '@/lib/hr/recruitment-mail'

export interface OfferLetterInput {
  candidateName: string
  jobTitle: string
  department?: string
  location?: string
  employmentType?: string
  startDate: string
  monthlyBasicSalary: number
  probationMonths?: number
  reportsTo?: string
  /** Last day the offer can be accepted. */
  validUntil?: string
  additionalTerms?: string
  issuedOn: string
}
export interface OfferCompany { name: string; address?: string; city?: string; phone?: string; email?: string; kraPin?: string }

const NAVY: [number, number, number] = [18, 52, 86]
const INK: [number, number, number] = [30, 41, 59]
const MUTED: [number, number, number] = [100, 116, 139]
const SOFT: [number, number, number] = [241, 245, 249]
const kes = (n: number) => `KSh ${(Number(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const TYPE_LABEL: Record<string, string> = { full_time: 'Full time', part_time: 'Part time', contract: 'Contract' }

/** One-page offer letter with an acceptance block. HR should read it before it is sent. */
export function buildOfferLetterPdf(o: OfferLetterInput, company: OfferCompany): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 48

  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...NAVY).text(company.name, M, 56)
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
  const sub = [[company.address, company.city].filter(Boolean).join(', '), company.phone, company.email, company.kraPin ? `KRA PIN: ${company.kraPin}` : ''].filter(Boolean)
  sub.forEach((t, i) => doc.text(String(t), M, 70 + i * 11))
  doc.setDrawColor(...NAVY).setLineWidth(1.2).line(M, 70 + sub.length * 11 + 6, W - M, 70 + sub.length * 11 + 6)

  let y = 70 + sub.length * 11 + 34
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...INK).text(longDate(o.issuedOn), M, y)
  y += 22
  doc.setFont('helvetica', 'bold').text('PRIVATE AND CONFIDENTIAL', M, y)
  y += 16
  doc.setFont('helvetica', 'normal').text(o.candidateName, M, y)
  y += 26
  doc.setFont('helvetica', 'bold').setFontSize(11).text(`OFFER OF EMPLOYMENT: ${o.jobTitle.toUpperCase()}`, M, y)
  y += 20

  doc.setFont('helvetica', 'normal').setFontSize(10)
  const intro = doc.splitTextToSize(`Dear ${o.candidateName.split(/\s+/)[0]},\n\nFurther to your interview, we are pleased to offer you the position of ${o.jobTitle} at ${company.name} on the terms below.`, W - M * 2) as string[]
  doc.text(intro, M, y)
  y += intro.length * 13 + 8

  const rows: Array<[string, string]> = [
    ['Position', o.jobTitle],
    ...(o.department ? [['Department', o.department] as [string, string]] : []),
    ...(o.location ? [['Place of work', o.location] as [string, string]] : []),
    ['Type of employment', TYPE_LABEL[o.employmentType ?? ''] ?? 'Full time'],
    ['Start date', longDate(o.startDate)],
    ['Monthly basic salary', kes(o.monthlyBasicSalary)],
    ...(o.probationMonths ? [['Probation', `${o.probationMonths} month${o.probationMonths === 1 ? '' : 's'} from the start date`] as [string, string]] : []),
    ...(o.reportsTo ? [['Reporting to', o.reportsTo] as [string, string]] : []),
  ]
  autoTable(doc, {
    startY: y, margin: { left: M, right: M }, theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 5, textColor: INK, lineColor: [226, 232, 240] },
    columnStyles: { 0: { fillColor: SOFT, fontStyle: 'bold', cellWidth: 150 } },
    body: rows,
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16

  const terms = [
    'Your salary is subject to statutory deductions: PAYE, NSSF, SHIF and the Affordable Housing Levy.',
    'Annual leave, notice and the other terms of your employment will be set out in your contract of employment and are governed by the Employment Act, 2007.',
    'This offer is subject to satisfactory references and verification of your identity, KRA PIN and qualifications.',
    ...(o.additionalTerms?.trim() ? [o.additionalTerms.trim()] : []),
  ]
  doc.setFont('helvetica', 'normal').setFontSize(9.5)
  terms.forEach(t => {
    const lines = doc.splitTextToSize(`•  ${t}`, W - M * 2 - 8) as string[]
    doc.text(lines, M + 4, y)
    y += lines.length * 12.5 + 3
  })
  y += 8
  const accept = doc.splitTextToSize(`To accept, please sign below and return a copy${o.validUntil ? ` by ${longDate(o.validUntil)}` : ''}. We look forward to welcoming you.`, W - M * 2) as string[]
  doc.text(accept, M, y)
  y += accept.length * 13 + 30

  doc.setDrawColor(...MUTED).setLineWidth(0.6)
  doc.line(M, y, M + 200, y).line(W - M - 200, y, W - M, y)
  doc.setFontSize(8.5).setTextColor(...MUTED)
  doc.text(`For ${company.name}`, M, y + 12)
  doc.text(`Accepted: ${o.candidateName}`, W - M - 200, y + 12)
  doc.text('Date:', W - M - 200, y + 28)
  return doc
}
