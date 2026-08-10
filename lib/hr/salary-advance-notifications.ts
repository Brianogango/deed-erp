/**
 * Salary advance email notifications.
 *
 * Rules (same pattern as leave):
 * - Send only AFTER the advance row is successfully persisted.
 * - Never throw / never block create or decide/pay on mail failure.
 * - Apply: To hr@deed.co.ke, CC Edwin + Dennis only.
 * - Approve / reject / disburse (paid): To the applicant's Employee.email only.
 */

import { sendEmail } from '@/lib/integrations/email'
import {
  leaveApplyToEmail,
  queueLeaveNotification,
  resolveApplicantEmail,
  resolveLeaveApplyCcEmails,
} from '@/lib/hr/leave-notifications'

export type SalaryAdvanceNotifyPayload = {
  id: string
  ref: string
  employeeId: string
  employeeName: string
  amount: number
  paymentTerms?: string | null
  repaymentMonths?: number | null
  repaymentStartPeriod?: string | null
  monthlyDeduction?: number | null
  reason?: string | null
  status: string
  neededByDate?: string | null
  reviewerName?: string | null
  decisionNote?: string | null
  paidDate?: string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? '').trim().toLowerCase()
  if (!email || !EMAIL_RE.test(email)) return null
  return email
}

function formatKes(amount: number): string {
  const n = Number(amount)
  return `KES ${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-KE')}`
}

function formatDate(iso?: string | null): string {
  const d = String(iso || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d || '—'
  try {
    return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-KE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return d
  }
}

function paymentTermsLabel(terms?: string | null): string {
  return terms === 'manual_repayment' ? 'Manual repayment' : 'Payroll deduction'
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://erp.deed.co.ke').replace(/\/$/, '')
}

function advanceHrUrl(): string {
  return `${appBaseUrl()}/?module=hr&tab=salary_advances`
}

function advanceSelfUrl(): string {
  return `${appBaseUrl()}/?module=hr&tab=salary_advances`
}

function detailBlock(payload: SalaryAdvanceNotifyPayload): string {
  return `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:18px 0;">
      <p style="margin:4px 0;"><strong>Reference:</strong> ${escapeHtml(payload.ref)}</p>
      <p style="margin:4px 0;"><strong>Employee:</strong> ${escapeHtml(payload.employeeName)}</p>
      <p style="margin:4px 0;"><strong>Amount:</strong> ${escapeHtml(formatKes(payload.amount))}</p>
      <p style="margin:4px 0;"><strong>Terms:</strong> ${escapeHtml(paymentTermsLabel(payload.paymentTerms))}</p>
      <p style="margin:4px 0;"><strong>Repayment:</strong> ${escapeHtml(String(payload.repaymentMonths || 1))} month(s) from ${escapeHtml(payload.repaymentStartPeriod || '—')}</p>
      <p style="margin:4px 0;"><strong>Monthly deduction:</strong> ${escapeHtml(formatKes(Number(payload.monthlyDeduction || 0)))}</p>
      ${payload.neededByDate ? `<p style="margin:4px 0;"><strong>Needed by:</strong> ${escapeHtml(formatDate(payload.neededByDate))}</p>` : ''}
      ${payload.reason ? `<p style="margin:4px 0;"><strong>Reason:</strong> ${escapeHtml(payload.reason)}</p>` : ''}
      ${payload.reviewerName ? `<p style="margin:4px 0;"><strong>Decided by:</strong> ${escapeHtml(payload.reviewerName)}</p>` : ''}
      ${payload.decisionNote ? `<p style="margin:4px 0;"><strong>Notes:</strong> ${escapeHtml(payload.decisionNote)}</p>` : ''}
      ${payload.paidDate ? `<p style="margin:4px 0;"><strong>Disbursed:</strong> ${escapeHtml(formatDate(payload.paidDate))}</p>` : ''}
    </div>`
}

function wrapHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html><body style="font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;background:#f8fafc;margin:0;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:#1B2762;color:#fff;padding:24px;"><h1 style="margin:0;font-size:22px;">Deed Technologies</h1><p style="margin:4px 0 0;opacity:.85;">${escapeHtml(title)}</p></div>
      <div style="padding:28px;">${bodyHtml}</div>
    </div>
  </body></html>`
}

async function sendHrMailbox(opts: {
  to: string | string[]
  cc?: string | string[]
  subject: string
  html: string
  text: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const toList = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .map(normalizeEmail)
    .filter((v): v is string => !!v)
  const toSet = new Set(toList)
  const ccList = (Array.isArray(opts.cc) ? opts.cc : opts.cc ? [opts.cc] : [])
    .map(normalizeEmail)
    .filter((v): v is string => !!v && !toSet.has(v))
  if (toList.length === 0) {
    console.warn('[salary-advance-notifications] skip send — no recipients', opts.metadata)
    return
  }
  try {
    const result = await sendEmail({
      to: toList.length === 1 ? toList[0] : toList,
      cc: ccList.length > 0 ? ccList : undefined,
      mailbox: 'hr',
      from: process.env.HR_EMAIL || undefined,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    })
    if (!result.success) {
      console.error('[salary-advance-notifications] send failed', { error: result.error, ...opts.metadata })
    } else {
      console.log('[salary-advance-notifications] sent', {
        messageId: result.messageId,
        to: toList,
        cc: ccList,
        ...opts.metadata,
      })
    }
  } catch (err) {
    console.error('[salary-advance-notifications] send threw', err, opts.metadata)
  }
}

/** Email HR (To) with Edwin + Dennis CC when a salary advance is submitted. */
export async function notifySalaryAdvanceApplied(payload: SalaryAdvanceNotifyPayload): Promise<void> {
  const to = leaveApplyToEmail()
  const cc = await resolveLeaveApplyCcEmails()
  const subject = `Salary advance ${payload.ref} — ${payload.employeeName}`
  const text = [
    `New salary advance application awaiting review.`,
    ``,
    `Reference: ${payload.ref}`,
    `Employee: ${payload.employeeName}`,
    `Amount: ${formatKes(payload.amount)}`,
    `Terms: ${paymentTermsLabel(payload.paymentTerms)}`,
    `Repayment: ${payload.repaymentMonths || 1} month(s) from ${payload.repaymentStartPeriod || '—'}`,
    `Monthly deduction: ${formatKes(Number(payload.monthlyDeduction || 0))}`,
    payload.neededByDate ? `Needed by: ${formatDate(payload.neededByDate)}` : '',
    payload.reason ? `Reason: ${payload.reason}` : '',
    ``,
    `Review in ERP: ${advanceHrUrl()}`,
  ].filter(Boolean).join('\n')

  const html = wrapHtml('Salary Advance Approval Required', `
    <p>A new salary advance application needs your review.</p>
    ${detailBlock(payload)}
    <p><a href="${escapeHtml(advanceHrUrl())}" style="display:inline-block;background:#1B2762;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Open Salary Advances</a></p>
    <p style="font-size:13px;color:#64748b;">This message was sent automatically by Deed ERP.</p>
  `)

  await sendHrMailbox({
    to,
    cc,
    subject,
    html,
    text,
    metadata: { action: 'salary_advance_applied', advanceId: payload.id, ref: payload.ref },
  })
}

/** Email the applicant when the advance is approved or rejected. */
export async function notifySalaryAdvanceDecision(
  payload: SalaryAdvanceNotifyPayload,
  decision: 'approved' | 'rejected',
): Promise<void> {
  const applicant = await resolveApplicantEmail(payload.employeeId)
  if (!applicant.email) {
    console.warn('[salary-advance-notifications] skip decision email — employee HR record has no email', {
      ref: payload.ref,
      employeeId: payload.employeeId,
    })
    return
  }

  const approved = decision === 'approved'
  const verb = approved ? 'approved' : 'rejected'
  const subject = `Salary advance ${payload.ref} ${verb}`
  const greeting = applicant.name || payload.employeeName || 'there'
  const text = [
    `Hi ${greeting},`,
    ``,
    `Your salary advance application ${payload.ref} has been ${verb}${payload.reviewerName ? ` by ${payload.reviewerName}` : ''}.`,
    ``,
    `Amount: ${formatKes(payload.amount)}`,
    `Terms: ${paymentTermsLabel(payload.paymentTerms)}`,
    `Repayment: ${payload.repaymentMonths || 1} month(s) from ${payload.repaymentStartPeriod || '—'}`,
    payload.decisionNote ? `Notes: ${payload.decisionNote}` : '',
    ``,
    approved
      ? `Finance will disburse the advance once ready. You will receive another email when it is paid.`
      : `If you have questions, reply to this email or contact HR.`,
    ``,
    `View in ERP: ${advanceSelfUrl()}`,
    ``,
    `Best regards,`,
    `HR / Finance`,
    `Deed Technologies`,
  ].filter(Boolean).join('\n')

  const html = wrapHtml(`Salary Advance ${approved ? 'Approved' : 'Rejected'}`, `
    <p>Hi ${escapeHtml(greeting)},</p>
    <p>Your salary advance application <strong>${escapeHtml(payload.ref)}</strong> has been <strong>${escapeHtml(verb)}</strong>${payload.reviewerName ? ` by ${escapeHtml(payload.reviewerName)}` : ''}.</p>
    ${detailBlock(payload)}
    <p>${approved
      ? 'Finance will disburse the advance once ready. You will receive another email when it is paid.'
      : 'If you have questions, reply to this email or contact HR.'}</p>
    <p><a href="${escapeHtml(advanceSelfUrl())}" style="display:inline-block;background:${approved ? '#059669' : '#DC2626'};color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">View Application</a></p>
    <p>Best regards,<br><strong>HR / Finance</strong><br>Deed Technologies</p>
  `)

  await sendHrMailbox({
    to: applicant.email,
    subject,
    html,
    text,
    metadata: { action: `salary_advance_${decision}`, advanceId: payload.id, ref: payload.ref },
  })
}

/** Email the applicant when the advance is disbursed (paid). */
export async function notifySalaryAdvanceDisbursed(payload: SalaryAdvanceNotifyPayload): Promise<void> {
  const applicant = await resolveApplicantEmail(payload.employeeId)
  if (!applicant.email) {
    console.warn('[salary-advance-notifications] skip disbursed email — employee HR record has no email', {
      ref: payload.ref,
      employeeId: payload.employeeId,
    })
    return
  }

  const greeting = applicant.name || payload.employeeName || 'there'
  const subject = `Salary advance ${payload.ref} disbursed`
  const text = [
    `Hi ${greeting},`,
    ``,
    `Your salary advance ${payload.ref} for ${formatKes(payload.amount)} has been disbursed.`,
    payload.paidDate ? `Disbursed on: ${formatDate(payload.paidDate)}` : '',
    `Repayment: ${payload.repaymentMonths || 1} month(s) via ${paymentTermsLabel(payload.paymentTerms).toLowerCase()} starting ${payload.repaymentStartPeriod || '—'}.`,
    `Monthly deduction: ${formatKes(Number(payload.monthlyDeduction || 0))}`,
    ``,
    `View in ERP: ${advanceSelfUrl()}`,
    ``,
    `Best regards,`,
    `HR / Finance`,
    `Deed Technologies`,
  ].filter(Boolean).join('\n')

  const html = wrapHtml('Salary Advance Disbursed', `
    <p>Hi ${escapeHtml(greeting)},</p>
    <p>Your salary advance <strong>${escapeHtml(payload.ref)}</strong> for <strong>${escapeHtml(formatKes(payload.amount))}</strong> has been disbursed.</p>
    ${detailBlock(payload)}
    <p><a href="${escapeHtml(advanceSelfUrl())}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">View Application</a></p>
    <p>Best regards,<br><strong>HR / Finance</strong><br>Deed Technologies</p>
  `)

  await sendHrMailbox({
    to: applicant.email,
    subject,
    html,
    text,
    metadata: { action: 'salary_advance_disbursed', advanceId: payload.id, ref: payload.ref },
  })
}

/** Fire-and-forget wrapper so API handlers never await mail failures. */
export function queueSalaryAdvanceNotification(task: () => Promise<void>): void {
  queueLeaveNotification(task)
}

export function toSalaryAdvanceNotifyPayload(row: {
  id: string
  reference?: string | null
  ref?: string | null
  employeeId: string
  employeeName?: string | null
  amount: number | string
  paymentTerms?: string | null
  repaymentMonths?: number | null
  repaymentStartPeriod?: string | null
  monthlyDeduction?: number | string | null
  reason?: string | null
  status: string
  neededByDate?: Date | string | null
  approvedByName?: string | null
  decisionNote?: string | null
  paidDate?: Date | string | null
}): SalaryAdvanceNotifyPayload {
  const needed = row.neededByDate instanceof Date
    ? row.neededByDate.toISOString()
    : row.neededByDate
      ? String(row.neededByDate)
      : null
  const paid = row.paidDate instanceof Date
    ? row.paidDate.toISOString()
    : row.paidDate
      ? String(row.paidDate)
      : null
  return {
    id: row.id,
    ref: String(row.reference || row.ref || row.id),
    employeeId: row.employeeId,
    employeeName: String(row.employeeName || 'Employee'),
    amount: Number(row.amount) || 0,
    paymentTerms: row.paymentTerms,
    repaymentMonths: Number(row.repaymentMonths) || 1,
    repaymentStartPeriod: row.repaymentStartPeriod ?? null,
    monthlyDeduction: Number(row.monthlyDeduction) || 0,
    reason: row.reason,
    status: String(row.status),
    neededByDate: needed ? needed.slice(0, 10) : null,
    reviewerName: row.approvedByName,
    decisionNote: row.decisionNote,
    paidDate: paid ? paid.slice(0, 10) : null,
  }
}
