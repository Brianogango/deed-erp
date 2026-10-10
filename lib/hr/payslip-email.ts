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
  const html = `<!DOCTYPE html><html><body style="font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;background:#f8fafc;margin:0;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:#1B2762;color:#fff;padding:20px 24px;"><h1 style="margin:0;font-size:20px;">${esc(i.companyName)}</h1><p style="margin:4px 0 0;opacity:.85;">Payslip, ${esc(period)}</p></div>
      <div style="padding:24px;line-height:1.55;">
        <p>Hi ${esc(first)},</p>
        <p>Your payslip for <strong>${esc(period)}</strong> is attached as a PDF. It shows your earnings, deductions, employer contributions and year-to-date totals.</p>
        <p style="color:#64748b;font-size:13px;">Please keep it safe: it contains personal and tax information.</p>
        <p>${i.hrEmail ? `Questions about your pay? Write to <a href="mailto:${esc(i.hrEmail)}">${esc(i.hrEmail)}</a>.` : 'Questions about your pay? Reply to this email.'}</p>
        <p>Best regards,<br><strong>HR Department</strong><br>${esc(i.companyName)}</p>
      </div>
    </div>
  </body></html>`
  return { subject, text, html }
}
