import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { sendEmail } from '@/lib/integrations/email'
import { companyForPdf } from '@/lib/hr/company-server'
import { buildCandidateEmail, type CandidateMailKind } from '@/lib/hr/recruitment-mail'
import { buildOfferLetterPdf } from '@/lib/hr/offer-letter'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'admin_officer']
const KINDS: CandidateMailKind[] = ['interview_invite', 'rejection', 'offer']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const isoDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : '')

/** Send a candidate an interview invitation, a rejection, or an offer letter (PDF attached). */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const body = await request.json().catch(() => ({}))
    const kind = str(body.kind, 30) as CandidateMailKind
    if (!KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown email type' }, { status: 400 })
    const to = str(body.to, 200)
    if (!EMAIL_RE.test(to)) return NextResponse.json({ error: 'The candidate has no valid email address' }, { status: 400 })
    const candidateName = str(body.candidateName, 160)
    const jobTitle = str(body.jobTitle, 160)
    if (!candidateName || !jobTitle) return NextResponse.json({ error: 'Candidate name and job title are required' }, { status: 400 })

    const company = await companyForPdf()
    const hrEmail = process.env.HR_EMAIL || undefined
    let interview: Parameters<typeof buildCandidateEmail>[0]['interview']
    let offer: Parameters<typeof buildCandidateEmail>[0]['offer']
    let attachments: Array<{ filename: string; content: Buffer; contentType: string }> | undefined

    if (kind === 'interview_invite') {
      const i = body.interview ?? {}
      const scheduledAt = str(i.scheduledAt, 20)
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(scheduledAt)) return NextResponse.json({ error: 'The interview needs a date and time' }, { status: 400 })
      const mode = ['in_person', 'video', 'phone'].includes(str(i.mode, 12)) ? (str(i.mode, 12) as 'in_person' | 'video' | 'phone') : 'in_person'
      interview = { scheduledAt, mode, interviewer: str(i.interviewer, 120), location: str(i.location, 300) || undefined }
    }

    if (kind === 'offer') {
      const o = body.offer ?? {}
      const startDate = isoDate(o.startDate)
      const salary = Number(o.monthlyBasicSalary)
      if (!startDate) return NextResponse.json({ error: 'The offer needs a start date' }, { status: 400 })
      if (!(salary > 0) || salary > 10_000_000) return NextResponse.json({ error: 'The offer needs a monthly basic salary' }, { status: 400 })
      const validUntil = isoDate(o.validUntil) || undefined
      offer = { startDate, validUntil }
      const pdf = Buffer.from(buildOfferLetterPdf({
        candidateName, jobTitle, department: str(o.department, 120) || undefined, location: str(o.location, 120) || undefined,
        employmentType: str(o.employmentType, 20) || undefined, startDate, monthlyBasicSalary: salary,
        probationMonths: Math.min(12, Math.max(0, Math.floor(Number(o.probationMonths) || 0))) || undefined,
        reportsTo: str(o.reportsTo, 120) || undefined, validUntil, additionalTerms: str(o.additionalTerms, 1500) || undefined,
        issuedOn: new Date().toISOString().slice(0, 10),
      }, company).output('arraybuffer'))
      attachments = [{ filename: `Offer letter - ${candidateName}.pdf`, content: pdf, contentType: 'application/pdf' }]
    }

    const mail = buildCandidateEmail({ kind, companyName: company.name, candidateName, jobTitle, hrEmail, interview, offer })
    const sent = await sendEmail({ to, mailbox: 'hr', subject: mail.subject, html: mail.html, text: mail.text, attachments })
    if (!sent.success) return NextResponse.json({ error: sent.error || 'The email could not be sent' }, { status: 502 })

    await writeFinancialAudit({
      userId: actor.id, action: `email_candidate_${kind}`, entityType: 'candidate', entityId: str(body.candidateId, 64) || null,
      newValues: { to, jobTitle },
    })
    return NextResponse.json({ ok: true, to })
  })
}
