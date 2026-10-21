import { brandedEmailFromHtml, emailSignature } from '@/lib/email/branded-layout'

/** The email that carries a payslip PDF. No amounts in the body: the figures live only in the attachment. */

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function payslipPeriodLabel(month: string | number, year: number): string {
  const m = Number(month)
  return `${MONTHS[m - 1] ?? String(month)} ${year}`
}

export function buildPayslipEmail(i: { companyName: string; employeeName: string; month: string | number; year: number; hrEmail?: string }) {
  const first = i.employeeName.trim().split(/\s+/)[0] || 'there'
  const period = payslipPeriodLabel(i.month, i.year)
  const subject = `Your payslip for ${period}`
  const contact = i.hrEmail ? `Questions about your pay? Write to ${i.hrEmail}.` : 'Questions about your pay? Reply to this email.'
  const text = [
    `Hi ${first},`,
    '',
    `Your payslip for ${period} is attached as a PDF.`,
    'It shows your earnings, deductions, employer contributions and year-to-date totals.',
    'Please keep it safe: it contains personal and tax information.',
    '',
    contact,
    '',
    'Best regards,',
    'HR Department',
    i.companyName,
  ].join('\n')
  const html = brandedEmailFromHtml({
    title: `Payslip, ${period}`,
    eyebrow: 'Payroll',
    companyName: i.companyName,
    html: `<p style="margin:0 0 14px">Hi ${esc(first)},</p>
        <p style="margin:0 0 14px">Your payslip for <strong>${esc(period)}</strong> is attached as a PDF. It shows your earnings, deductions, employer contributions and year-to-date totals.</p>
        <p style="margin:0 0 14px;color:#64748b;font-size:13px">Please keep it safe: it contains personal and tax information.</p>
        <p style="margin:0 0 14px">${i.hrEmail ? `Questions about your pay? Write to <a href="mailto:${esc(i.hrEmail)}">${esc(i.hrEmail)}</a>.` : 'Questions about your pay? Reply to this email.'}</p>`,
    signatureHtml: emailSignature(['Best regards,', 'HR Department', i.companyName]),
  })
  return { subject, text, html }
}
