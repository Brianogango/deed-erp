/** Emails and the offer letter sent to candidates. Pure builders; the API route sends them. */

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "2026-10-12T14:30" (Nairobi time as typed in the form) to "Monday, 12 October 2026 at 2:30 PM (EAT)". */
export function formatInterviewTime(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!m) return local
  const [, y, mo, d, hh, mm] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  const hour = Number(hh)
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${DAYS[date.getUTCDay()]}, ${Number(d)} ${MONTHS[Number(mo) - 1]} ${y} at ${h12}:${mm} ${hour < 12 ? 'AM' : 'PM'} (EAT)`
}

export const longDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return `${DAYS[date.getUTCDay()]}, ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

export type CandidateMailKind = 'interview_invite' | 'rejection' | 'offer'

export interface CandidateMailInput {
  kind: CandidateMailKind
  companyName: string
  candidateName: string
  jobTitle: string
  hrEmail?: string
  interview?: { scheduledAt: string; mode: 'in_person' | 'video' | 'phone'; interviewer: string; location?: string }
  offer?: { startDate: string; validUntil?: string }
}

const MODE_LABEL = { in_person: 'In person', video: 'Video call', phone: 'Phone call' } as const

function shell(company: string, heading: string, inner: string) {
  return `<!DOCTYPE html><html><body style="font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;background:#f8fafc;margin:0;padding:24px;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:#1B2762;color:#fff;padding:20px 24px;"><h1 style="margin:0;font-size:20px;">${esc(company)}</h1><p style="margin:4px 0 0;opacity:.85;">${esc(heading)}</p></div>
      <div style="padding:24px;line-height:1.55;">${inner}</div>
    </div></body></html>`
}

export function buildCandidateEmail(i: CandidateMailInput): { subject: string; text: string; html: string } {
  const first = i.candidateName.trim().split(/\s+/)[0] || 'there'
  const contact = i.hrEmail ? `Write to ${i.hrEmail} if you have any questions.` : 'Reply to this email if you have any questions.'
  const sign = ['Best regards,', 'HR Department', i.companyName]
  const signHtml = `<p>Best regards,<br><strong>HR Department</strong><br>${esc(i.companyName)}</p>`

  if (i.kind === 'interview_invite' && i.interview) {
    const v = i.interview
    const when = formatInterviewTime(v.scheduledAt)
    const where = v.mode === 'in_person' ? 'Venue' : v.mode === 'video' ? 'Meeting link' : 'We will call you on'
    const subject = `Interview invitation: ${i.jobTitle}`
    const text = [
      `Hi ${first},`, '',
      `Thank you for applying for the ${i.jobTitle} position at ${i.companyName}. We would like to invite you to an interview.`, '',
      `When: ${when}`,
      `Format: ${MODE_LABEL[v.mode]}`,
      v.location ? `${where}: ${v.location}` : '',
      v.interviewer ? `You will meet: ${v.interviewer}` : '', '',
      'Please reply to confirm that you can attend, and carry your national ID.', contact, '', ...sign,
    ].filter((l, idx, arr) => l !== '' || arr[idx - 1] !== '').join('\n')
    const html = shell(i.companyName, 'Interview invitation', `
      <p>Hi ${esc(first)},</p>
      <p>Thank you for applying for the <strong>${esc(i.jobTitle)}</strong> position at ${esc(i.companyName)}. We would like to invite you to an interview.</p>
      <table style="border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:4px 14px 4px 0;color:#64748b;">When</td><td><strong>${esc(when)}</strong></td></tr>
        <tr><td style="padding:4px 14px 4px 0;color:#64748b;">Format</td><td>${esc(MODE_LABEL[v.mode])}</td></tr>
        ${v.location ? `<tr><td style="padding:4px 14px 4px 0;color:#64748b;">${esc(where)}</td><td>${esc(v.location)}</td></tr>` : ''}
        ${v.interviewer ? `<tr><td style="padding:4px 14px 4px 0;color:#64748b;">You will meet</td><td>${esc(v.interviewer)}</td></tr>` : ''}
      </table>
      <p>Please reply to confirm that you can attend, and carry your national ID. ${esc(contact)}</p>${signHtml}`)
    return { subject, text, html }
  }

  if (i.kind === 'offer') {
    const subject = `Offer of employment: ${i.jobTitle}`
    const by = i.offer?.validUntil ? ` Please sign and return it by ${longDate(i.offer.validUntil)}.` : ' Please sign and return it.'
    const start = i.offer?.startDate ? ` The proposed start date is ${longDate(i.offer.startDate)}.` : ''
    const text = [`Hi ${first},`, '', `We are pleased to offer you the position of ${i.jobTitle} at ${i.companyName}.${start}`, '', `Your offer letter is attached as a PDF.${by}`, contact, '', ...sign].join('\n')
    const html = shell(i.companyName, 'Offer of employment', `
      <p>Hi ${esc(first)},</p>
      <p>We are pleased to offer you the position of <strong>${esc(i.jobTitle)}</strong> at ${esc(i.companyName)}.${esc(start)}</p>
      <p>Your offer letter is attached as a PDF.${esc(by)} ${esc(contact)}</p>${signHtml}`)
    return { subject, text, html }
  }

  // Rejection: kind and brief. The internal reason is never included.
  const subject = `Your application for ${i.jobTitle}`
  const text = [
    `Hi ${first},`, '',
    `Thank you for your interest in the ${i.jobTitle} position at ${i.companyName} and for the time you gave to our process.`, '',
    'After careful consideration we have decided not to take your application further on this occasion. This is not a reflection of your potential, and we encourage you to apply for future openings that suit your experience.', '',
    'We wish you every success.', '', ...sign,
  ].join('\n')
  const html = shell(i.companyName, 'Your application', `
    <p>Hi ${esc(first)},</p>
    <p>Thank you for your interest in the <strong>${esc(i.jobTitle)}</strong> position at ${esc(i.companyName)} and for the time you gave to our process.</p>
    <p>After careful consideration we have decided not to take your application further on this occasion. This is not a reflection of your potential, and we encourage you to apply for future openings that suit your experience.</p>
    <p>We wish you every success.</p>${signHtml}`)
  return { subject, text, html }
}
