import 'server-only'

import prisma from '@/lib/prisma'
import { sendMultiChannelMessage } from './messaging'

export interface LeaveEmailResult {
  attempted: boolean
  success: boolean
  recipients: string[]
  error?: string
}

type LeaveDetails = {
  requestId: string
  reference?: string | null
  employeeId: string
  employeeName?: string | null
  leaveType: string
  days: number
  startDate: Date | string
  endDate: Date | string
  reason?: string | null
  submittedByUserId?: string | null
}

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const dateText = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
}

const leaveLabel = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || 'https://erp.deed.co.ke').replace(/\/$/, '')
const validEmail = (value: unknown): value is string =>
  typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

const resultError = (result: Awaited<ReturnType<typeof sendMultiChannelMessage>>) =>
  Object.values(result.results).map(item => item.error).filter(Boolean).join('; ') || undefined

export async function notifyLeaveSubmitted(details: LeaveDetails): Promise<LeaveEmailResult> {
  const employee = await prisma.employee.findUnique({
    where: { id: details.employeeId },
    select: { user: { select: { role: true } } },
  }).catch(() => null)

  const roles = ['director', 'admin_officer', 'finance_officer']
  if (employee?.user?.role === 'technician') roles.push('technical_lead')

  const approvers = await prisma.user.findMany({
    where: { isActive: true, role: { in: roles as any } },
    select: { id: true, email: true },
  })
  const recipients = Array.from(new Set([
    process.env.HR_EMAIL,
    ...approvers.filter(user => user.id !== details.submittedByUserId).map(user => user.email),
  ].filter(validEmail)))

  if (recipients.length === 0) {
    return { attempted: false, success: false, recipients: [], error: 'No leave approver email address is configured' }
  }

  const reference = details.reference || 'New leave request'
  const employeeName = details.employeeName || 'Employee'
  const reviewUrl = `${appUrl()}/hr?tab=leave`
  const subject = `${reference}: leave request from ${employeeName}`
  const text = `${employeeName} submitted a ${leaveLabel(details.leaveType)} leave request for ${details.days} day(s), ${dateText(details.startDate)} to ${dateText(details.endDate)}.${details.reason ? `\n\nReason: ${details.reason}` : ''}\n\nReview: ${reviewUrl}`
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a">
    <div style="max-width:640px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
      <div style="background:#1B2762;color:#fff;padding:22px 26px"><strong>DEED ERP</strong><div style="margin-top:4px;opacity:.8">Leave approval required</div></div>
      <div style="padding:26px">
        <h2 style="margin:0 0 16px;font-size:20px">${escapeHtml(reference)}</h2>
        <p><strong>${escapeHtml(employeeName)}</strong> submitted a leave request.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px">
          <p style="margin:4px 0"><strong>Type:</strong> ${escapeHtml(leaveLabel(details.leaveType))}</p>
          <p style="margin:4px 0"><strong>Dates:</strong> ${escapeHtml(dateText(details.startDate))} – ${escapeHtml(dateText(details.endDate))}</p>
          <p style="margin:4px 0"><strong>Days:</strong> ${details.days}</p>
          ${details.reason ? `<p style="margin:4px 0"><strong>Reason:</strong> ${escapeHtml(details.reason)}</p>` : ''}
        </div>
        <p style="margin-top:20px"><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#2563eb;color:#fff;padding:11px 17px;border-radius:8px;text-decoration:none;font-weight:700">Review leave request</a></p>
      </div>
    </div>
  </body></html>`

  const result = await sendMultiChannelMessage({
    purpose: 'general',
    recipient: { name: 'Leave approvers', email: recipients[0] },
    channels: ['email'],
    mailbox: 'hr',
    bcc: recipients.slice(1),
    content: { subject, text, html },
    metadata: { type: 'leave', event: 'submitted', requestId: details.requestId },
  })
  return { attempted: true, success: result.success, recipients, error: resultError(result) }
}

export async function notifyLeaveDecision(
  details: LeaveDetails & {
    status: 'approved' | 'rejected' | 'cancelled'
    reviewerName: string
    note?: string | null
  },
): Promise<LeaveEmailResult> {
  const employee = await prisma.employee.findUnique({
    where: { id: details.employeeId },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      user: { select: { email: true } },
    },
  })
  const email = validEmail(employee?.email)
    ? employee.email
    : validEmail(employee?.user?.email) ? employee.user.email : null
  if (!email) {
    return { attempted: false, success: false, recipients: [], error: 'Employee email address is missing' }
  }

  const reference = details.reference || 'Leave request'
  const employeeName = details.employeeName || `${employee?.firstName ?? ''} ${employee?.lastName ?? ''}`.trim() || 'Employee'
  const statusLabel = details.status.charAt(0).toUpperCase() + details.status.slice(1)
  const portalUrl = `${appUrl()}/hr?tab=self_service`
  const subject = `${reference}: leave request ${details.status}`
  const text = `Hi ${employeeName},\n\nYour ${leaveLabel(details.leaveType)} leave request for ${details.days} day(s), ${dateText(details.startDate)} to ${dateText(details.endDate)}, was ${details.status} by ${details.reviewerName}.${details.note ? `\n\nNote: ${details.note}` : ''}\n\nView: ${portalUrl}\n\nHR Department\nDeed Technologies`
  const tone = details.status === 'approved' ? '#16a34a' : details.status === 'rejected' ? '#dc2626' : '#64748b'
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a">
    <div style="max-width:640px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
      <div style="background:#1B2762;color:#fff;padding:22px 26px"><strong>DEED ERP</strong><div style="margin-top:4px;opacity:.8">Leave request update</div></div>
      <div style="padding:26px">
        <p>Hi ${escapeHtml(employeeName)},</p>
        <h2 style="margin:12px 0;color:${tone}">${escapeHtml(statusLabel)}</h2>
        <p>Your <strong>${escapeHtml(leaveLabel(details.leaveType))}</strong> leave request (${escapeHtml(reference)}) was ${escapeHtml(details.status)} by ${escapeHtml(details.reviewerName)}.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px">
          <p style="margin:4px 0"><strong>Dates:</strong> ${escapeHtml(dateText(details.startDate))} – ${escapeHtml(dateText(details.endDate))}</p>
          <p style="margin:4px 0"><strong>Days:</strong> ${details.days}</p>
          ${details.note ? `<p style="margin:4px 0"><strong>Note:</strong> ${escapeHtml(details.note)}</p>` : ''}
        </div>
        <p style="margin-top:20px"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#2563eb;color:#fff;padding:11px 17px;border-radius:8px;text-decoration:none;font-weight:700">View leave details</a></p>
      </div>
    </div>
  </body></html>`

  const result = await sendMultiChannelMessage({
    purpose: 'general',
    recipient: { name: employeeName, email },
    channels: ['email'],
    mailbox: 'hr',
    content: { subject, text, html },
    metadata: { type: 'leave', event: details.status, requestId: details.requestId },
  })
  return { attempted: true, success: result.success, recipients: [email], error: resultError(result) }
}
