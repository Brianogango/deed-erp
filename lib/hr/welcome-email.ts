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

  const html = `<!DOCTYPE html><html><body style="font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;background:#f8fafc;margin:0;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:#1B2762;color:#fff;padding:24px;"><h1 style="margin:0;font-size:22px;">${esc(i.companyName)}</h1><p style="margin:4px 0 0;opacity:.85;">Welcome aboard</p></div>
      <div style="padding:28px;line-height:1.55;">
        <p>Hi ${esc(first)},</p>
        <p>Welcome to ${esc(i.companyName)}. We are glad you are joining us${role ? ` as <strong>${esc(role)}</strong>` : ''}.</p>
        <p style="background:#f1f5f9;border-radius:8px;padding:12px 16px;"><strong>Your first day:</strong> ${esc(longDate(i.startDate))}</p>
        ${note ? `<p>${esc(note).replace(/\n/g, '<br>')}</p>` : ''}
        <p><strong>Please bring:</strong></p>
        <ul>${WELCOME_BRING_LIST.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
        <p>${i.workEmail ? `Your work email address is <strong>${esc(i.workEmail)}</strong>. Your line manager or IT will give you the password on your first day.` : 'Your work email address will be set up for you and shared on your first day.'}</p>
        <p>You will also receive a separate email with your sign-in details for the company system. You will be asked to choose a new password the first time you sign in.</p>
        <p>${i.hrEmail ? `Questions before you start? Write to <a href="mailto:${esc(i.hrEmail)}">${esc(i.hrEmail)}</a>.` : 'Questions before you start? Reply to this email.'}</p>
        <p>Best regards,<br><strong>HR Department</strong><br>${esc(i.companyName)}</p>
      </div>
    </div>
  </body></html>`
  return { subject, text, html }
}
