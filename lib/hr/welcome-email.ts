import { brandedEmailFromHtml, emailDetailsHtml, emailSignature } from '@/lib/email/branded-layout'

/** Builds the new-hire welcome email. Pure so it can be tested; sending lives in the API route. */

export interface WelcomeEmailInput {
  companyName: string
  employeeName: string
  jobTitle?: string
  department?: string
  /** ISO date of the first day. */
  startDate: string
  workEmail?: string
  hrEmail?: string
  /** Free text from HR: arrival time, venue, who to ask for. */
  note?: string
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const longDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export const WELCOME_BRING_LIST = [
  'Original national ID (or passport)',
  'KRA PIN certificate',
  'NSSF number and SHA (SHIF) number',
  'Bank account details, or the M-Pesa number you want your salary paid to',
  'Copies of your academic and professional certificates',
]

export function buildWelcomeEmail(i: WelcomeEmailInput): { subject: string; text: string; html: string } {
  const first = i.employeeName.trim().split(/\s+/)[0] || 'there'
  const role = [i.jobTitle, i.department ? `in ${i.department}` : ''].filter(Boolean).join(' ')
  const subject = `Welcome to ${i.companyName}: your first day is ${longDate(i.startDate)}`
  const note = (i.note ?? '').trim()

  const text = [
    `Hi ${first},`,
    '',
    `Welcome to ${i.companyName}. We are glad you are joining us${role ? ` as ${role}` : ''}.`,
    '',
    `Your first day is ${longDate(i.startDate)}.`,
    note ? `\n${note}\n` : '',
    'Please bring:',
    ...WELCOME_BRING_LIST.map(b => `- ${b}`),
    '',
    i.workEmail ? `Your work email address is ${i.workEmail}. Your line manager or IT will give you the password on your first day.` : 'Your work email address will be set up for you and shared on your first day.',
    'You will also receive a separate email with your sign-in details for the company system. You will be asked to choose a new password the first time you sign in.',
    '',
    i.hrEmail ? `Questions before you start? Write to ${i.hrEmail}.` : 'Questions before you start? Reply to this email.',
    '',
    'Best regards,',
    `HR Department`,
    i.companyName,
  ].filter(l => l !== undefined).join('\n')

  const html = brandedEmailFromHtml({
    title: `Welcome to ${i.companyName}`,
    eyebrow: 'Welcome aboard',
    companyName: i.companyName,
    html: `<p style="margin:0 0 14px">Hi ${esc(first)},</p>
        <p style="margin:0 0 14px">Welcome to ${esc(i.companyName)}. We are glad you are joining us${role ? ` as <strong>${esc(role)}</strong>` : ''}.</p>
        ${emailDetailsHtml([['Your first day', longDate(i.startDate)]])}
        ${note ? `<p style="margin:0 0 14px">${esc(note).replace(/\n/g, '<br>')}</p>` : ''}
        <p style="margin:0 0 6px"><strong>Please bring:</strong></p>
        <ul style="margin:0 0 14px;padding-left:20px">${WELCOME_BRING_LIST.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
        <p style="margin:0 0 14px">${i.workEmail ? `Your work email address is <strong>${esc(i.workEmail)}</strong>. Your line manager or IT will give you the password on your first day.` : 'Your work email address will be set up for you and shared on your first day.'}</p>
        <p style="margin:0 0 14px">You will also receive a separate email with your sign-in details for the company system. You will be asked to choose a new password the first time you sign in.</p>
        <p style="margin:0 0 14px">${i.hrEmail ? `Questions before you start? Write to <a href="mailto:${esc(i.hrEmail)}">${esc(i.hrEmail)}</a>.` : 'Questions before you start? Reply to this email.'}</p>`,
    signatureHtml: emailSignature(['Best regards,', 'HR Department', i.companyName]),
  })
  return { subject, text, html }
}
