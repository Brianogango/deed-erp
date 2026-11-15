import type { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { longDate } from '@/lib/hr/recruitment-mail'
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
  BORDER,
  type DeedPdfCompanyInput,
} from '@/lib/deed-document-pdf'

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

const TYPE_LABEL: Record<string, string> = { full_time: 'Full time', part_time: 'Part time', contract: 'Contract' }

/**
 * One-page offer letter with an acceptance block, on the same letterhead as every
 * other document the company issues. HR should read it before it is sent.
 */
export function buildOfferLetterPdf(o: OfferLetterInput, company: DeedPdfCompanyInput): jsPDF {
  const ref = `OFFER/${o.issuedOn.slice(0, 10).replace(/-/g, '')}`
  const { doc, accent, shell } = startLetterheadDocument(company, 'Offer of employment', ref)
  const currency = company.currency || 'KES'
  const width = contentW(doc)
  let y = drawDocumentIntro(doc, accent, {
    title: 'Offer of employment',
    partyLabel: 'Offered to',
    partyName: o.candidateName,
    partyLines: ['Private and confidential'],
    meta: [
      ['Date of issue', longDate(o.issuedOn)],
      ['Position', o.jobTitle],
      ...(o.validUntil ? [['Accept by', longDate(o.validUntil)] as [string, string]] : []),
    ],
  })

  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...INK)
  const intro = doc.splitTextToSize(
    `Dear ${o.candidateName.split(/\s+/)[0]},\n\nFurther to your interview, we are pleased to offer you the position of ${o.jobTitle} at ${company.name} on the terms below.`,
    width * .86,
  ) as string[]
  doc.text(intro, MARGIN, y)
  y += intro.length * 13 + 10

  const rows: Array<[string, string]> = [
    ['Position', o.jobTitle],
    ...(o.department ? [['Department', o.department] as [string, string]] : []),
    ...(o.location ? [['Place of work', o.location] as [string, string]] : []),
    ['Type of employment', TYPE_LABEL[o.employmentType ?? ''] ?? 'Full time'],
    ['Start date', longDate(o.startDate)],
    ['Monthly basic salary', `${currency} ${money(o.monthlyBasicSalary)}`],
    ...(o.probationMonths ? [['Probation', `${o.probationMonths} month${o.probationMonths === 1 ? '' : 's'} from the start date`] as [string, string]] : []),
    ...(o.reportsTo ? [['Reporting to', o.reportsTo] as [string, string]] : []),
  ]
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: INK, lineColor: BORDER, lineWidth: { bottom: .4 } as never },
    headStyles: { fillColor: accent, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.6 },
    columnStyles: { 0: { cellWidth: 150, textColor: MUTED }, 1: { fontStyle: 'bold' } },
    head: [['TERMS OF THE OFFER', '']],
    body: rows,
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18

  const terms = [
    'Your salary is subject to statutory deductions: PAYE, NSSF, SHIF and the Affordable Housing Levy.',
    'Annual leave, notice and the other terms of your employment will be set out in your contract of employment and are governed by the Employment Act, 2007.',
    'This offer is subject to satisfactory references and verification of your identity, KRA PIN and qualifications.',
    ...(o.additionalTerms?.trim() ? [o.additionalTerms.trim()] : []),
  ]
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...INK)
  terms.forEach(t => {
    const lines = doc.splitTextToSize(`•  ${t}`, width - 8) as string[]
    doc.text(lines, MARGIN + 4, y)
    y += lines.length * 12 + 3
  })
  y += 8

  const accept = doc.splitTextToSize(
    `To accept, please sign below and return a copy${o.validUntil ? ` by ${longDate(o.validUntil)}` : ''}. We look forward to welcoming you.`,
    width * .86,
  ) as string[]
  doc.text(accept, MARGIN, y)
  y += accept.length * 13 + 30

  doc.setDrawColor(...MUTED).setLineWidth(.6)
  doc.line(MARGIN, y + 24, MARGIN + 200, y + 24)
  doc.line(right(doc) - 200, y + 24, right(doc), y + 24)
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
  doc.text(`For ${company.name}`, MARGIN, y + 36)
  doc.text(`Accepted: ${o.candidateName}`, right(doc) - 200, y + 36)
  doc.text('Date:', right(doc) - 200, y + 52)

  return finishLetterheadDocument(doc, company, shell)
}
