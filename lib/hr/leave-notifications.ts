/**
 * Leave application email notifications.
 *
 * Foolproof rules:
 * - Send only AFTER the leave row is successfully persisted.
 * - Never throw / never block leave create or decide on mail failure.
 * - Apply: To hr@deed.co.ke, CC Edwin + Dennis only.
 * - Approve/reject: To the applier's Employee.email on the HR record only.
 */

import prisma from '@/lib/prisma'
import { sendEmail } from '@/lib/integrations/email'

export type LeaveNotifyPayload = {
  id: string
  ref: string
  employeeId: string
  employeeName: string
  leaveType: string
  startDate: string
  endDate: string
  days: number
  reason?: string | null
  status: string
  reviewerName?: string | null
  reviewNotes?: string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Default leave-apply CC list when env / DB lookup is empty. */
export const DEFAULT_LEAVE_APPLY_CC = ['edwin@deed.co.ke', 'dennis@deed.co.ke'] as const
export const DEFAULT_LEAVE_APPLY_TO = 'hr@deed.co.ke'

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

function parseEmailList(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map(part => normalizeEmail(part))
    .filter((v): v is string => !!v)
}

function leaveTypeLabel(type: string): string {
  return String(type || 'leave').replace(/_/g, ' ')
}

function formatDate(iso: string): string {
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

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://erp.deed.co.ke').replace(/\/$/, '')
}

function leaveHrUrl(): string {
  return `${appBaseUrl()}/?module=hr&tab=leave`
}

function leaveSelfUrl(): string {
  return `${appBaseUrl()}/?module=hr&tab=self_service`
}

/** Primary leave-apply inbox (To). */
export function leaveApplyToEmail(): string {
  return (
    normalizeEmail(process.env.HR_TEAM_EMAIL)
    || normalizeEmail(process.env.HR_EMAIL)
    || DEFAULT_LEAVE_APPLY_TO
  )
}

/**
 * CC list for leave apply: Edwin + Dennis only.
 * Prefer LEAVE_APPLY_CC_EMAILS / LEAVE_NOTIFY_EMAILS, else resolve by first name
 * from active employees, else hardcoded deed.co.ke defaults.
 */
export async function resolveLeaveApplyCcEmails(): Promise<string[]> {
  const fromEnv = parseEmailList(
    process.env.LEAVE_APPLY_CC_EMAILS || process.env.LEAVE_NOTIFY_EMAILS,
  )
  if (fromEnv.length > 0) return Array.from(new Set(fromEnv))

  try {
    const rows = await prisma.employee.findMany({
      where: {
        isActive: true,
        OR: [
          { firstName: { equals: 'Edwin', mode: 'insensitive' } },
          { firstName: { equals: 'Dennis', mode: 'insensitive' } },
        ],
      },
      select: { firstName: true, email: true, user: { select: { email: true } } },
    })
    const byName = new Map<string, string>()
    for (const row of rows) {
      const key = String(row.firstName || '').trim().toLowerCase()
      const email = normalizeEmail(row.email) || normalizeEmail(row.user?.email)
      if ((key === 'edwin' || key === 'dennis') && email) byName.set(key, email)
    }
    const resolved = ['edwin', 'dennis']
      .map(n => byName.get(n))
      .filter((v): v is string => !!v)
    if (resolved.length > 0) return Array.from(new Set(resolved))
  } catch (err) {
    console.error('[leave-notifications] failed to resolve Edwin/Dennis emails', err)
  }

  return [...DEFAULT_LEAVE_APPLY_CC]
}

/** @deprecated Use leaveApplyToEmail + resolveLeaveApplyCcEmails. Kept for tests. */
export function configuredLeaveInboxEmails(): string[] {
  return [leaveApplyToEmail()]
}

/** @deprecated Apply notifications no longer blast all HR managers. */
export async function resolveHrApproverEmails(): Promise<string[]> {
  const to = leaveApplyToEmail()
  const cc = await resolveLeaveApplyCcEmails()
  return Array.from(new Set([to, ...cc]))
}

/**
 * Resolve the applier's email from their HR record (`Employee.email`).
 * Decision feedback always uses this address only.
 */
export async function resolveApplicantEmail(employeeId: string, _submittedByUserId?: string | null): Promise<{
  email: string | null
  name: string
}> {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
      },
    })
    const name = employee
      ? `${employee.firstName} ${employee.lastName}`.trim()
      : 'Employee'
    return { email: normalizeEmail(employee?.email), name }
  } catch (err) {
    console.error('[leave-notifications] failed to resolve applicant email', err)
    return { email: null, name: 'Employee' }
  }
}

function detailBlock(payload: LeaveNotifyPayload): string {
  return `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:18px 0;">
      <p style="margin:4px 0;"><strong>Reference:</strong> ${escapeHtml(payload.ref)}</p>
      <p style="margin:4px 0;"><strong>Employee:</strong> ${escapeHtml(payload.employeeName)}</p>
      <p style="margin:4px 0;"><strong>Type:</strong> ${escapeHtml(leaveTypeLabel(payload.leaveType))}</p>
      <p style="margin:4px 0;"><strong>Dates:</strong> ${escapeHtml(formatDate(payload.startDate))} – ${escapeHtml(formatDate(payload.endDate))}</p>
      <p style="margin:4px 0;"><strong>Days:</strong> ${escapeHtml(String(payload.days))}</p>
      ${payload.reason ? `<p style="margin:4px 0;"><strong>Reason:</strong> ${escapeHtml(payload.reason)}</p>` : ''}
      ${payload.reviewerName ? `<p style="margin:4px 0;"><strong>Decided by:</strong> ${escapeHtml(payload.reviewerName)}</p>` : ''}
      ${payload.reviewNotes ? `<p style="margin:4px 0;"><strong>Notes:</strong> ${escapeHtml(payload.reviewNotes)}</p>` : ''}
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
    console.warn('[leave-notifications] skip send — no recipients', opts.metadata)
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
      console.error('[leave-notifications] send failed', { error: result.error, ...opts.metadata })
    } else {
      console.log('[leave-notifications] sent', {
        messageId: result.messageId,
        to: toList,
        cc: ccList,
        ...opts.metadata,
      })
    }
  } catch (err) {
    console.error('[leave-notifications] send threw', err, opts.metadata)
  }
}

/** Email HR (To) with Edwin + Dennis CC when a leave request needs approval. */
export async function notifyLeaveApplied(payload: LeaveNotifyPayload): Promise<void> {
  const to = leaveApplyToEmail()
  const cc = await resolveLeaveApplyCcEmails()
  const subject = `Leave request ${payload.ref} — ${payload.employeeName}`
  const text = [
    `New leave request awaiting approval.`,
    ``,
    `Reference: ${payload.ref}`,
    `Employee: ${payload.employeeName}`,
    `Type: ${leaveTypeLabel(payload.leaveType)}`,
    `Dates: ${formatDate(payload.startDate)} – ${formatDate(payload.endDate)}`,
    `Days: ${payload.days}`,
    payload.reason ? `Reason: ${payload.reason}` : '',
    ``,
    `Review in ERP: ${leaveHrUrl()}`,
  ].filter(Boolean).join('\n')

  const html = wrapHtml('Leave Approval Required', `
    <p>A new leave request needs your review.</p>
    ${detailBlock(payload)}
    <p><a href="${escapeHtml(leaveHrUrl())}" style="display:inline-block;background:#1B2762;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Open Leave Queue</a></p>
    <p style="font-size:13px;color:#64748b;">This message was sent automatically by Deed ERP.</p>
  `)

  await sendHrMailbox({
    to,
    cc,
    subject,
    html,
    text,
    metadata: { action: 'leave_applied', leaveId: payload.id, ref: payload.ref },
  })
}

/** Email the applier only when leave is approved or declined. */
export async function notifyLeaveDecision(
  payload: LeaveNotifyPayload,
  decision: 'approved' | 'rejected',
): Promise<void> {
  const applicant = await resolveApplicantEmail(payload.employeeId)
  if (!applicant.email) {
    console.warn('[leave-notifications] skip decision email — employee HR record has no email', {
      ref: payload.ref,
      employeeId: payload.employeeId,
    })
    return
  }

  const approved = decision === 'approved'
  const verb = approved ? 'approved' : 'declined'
  const subject = `Leave ${payload.ref} ${verb}`
  const greeting = applicant.name || payload.employeeName || 'there'
  const text = [
    `Hi ${greeting},`,
    ``,
    `Your leave request ${payload.ref} has been ${verb}${payload.reviewerName ? ` by ${payload.reviewerName}` : ''}.`,
    ``,
    `Type: ${leaveTypeLabel(payload.leaveType)}`,
    `Dates: ${formatDate(payload.startDate)} – ${formatDate(payload.endDate)}`,
    `Days: ${payload.days}`,
    payload.reviewNotes ? `Notes: ${payload.reviewNotes}` : '',
    ``,
    `View in ERP: ${leaveSelfUrl()}`,
    ``,
    `Best regards,`,
    `HR Department`,
    `Deed Technologies`,
  ].filter(Boolean).join('\n')

  const html = wrapHtml(`Leave ${approved ? 'Approved' : 'Declined'}`, `
    <p>Hi ${escapeHtml(greeting)},</p>
    <p>Your leave request <strong>${escapeHtml(payload.ref)}</strong> has been <strong>${escapeHtml(verb)}</strong>${payload.reviewerName ? ` by ${escapeHtml(payload.reviewerName)}` : ''}.</p>
    ${detailBlock({ ...payload, employeeName: payload.employeeName })}
    <p><a href="${escapeHtml(leaveSelfUrl())}" style="display:inline-block;background:${approved ? '#059669' : '#DC2626'};color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">View My Leave</a></p>
    <p>Best regards,<br><strong>HR Department</strong><br>Deed Technologies</p>
  `)

  await sendHrMailbox({
    to: applicant.email,
    subject,
    html,
    text,
    metadata: { action: `leave_${decision}`, leaveId: payload.id, ref: payload.ref },
  })
}

/** Email the employee when HR books leave for them (auto-approved). */
export async function notifyLeaveBookedForEmployee(payload: LeaveNotifyPayload): Promise<void> {
  const applicant = await resolveApplicantEmail(payload.employeeId)
  if (!applicant.email) {
    console.warn('[leave-notifications] skip booked email — employee HR record has no email', {
      ref: payload.ref,
      employeeId: payload.employeeId,
    })
    return
  }
  const greeting = applicant.name || payload.employeeName || 'there'
  const subject = `Leave booked for you — ${payload.ref}`
  const text = [
    `Hi ${greeting},`,
    ``,
    `${payload.reviewerName || 'HR'} has booked leave for you (${payload.ref}).`,
    `Type: ${leaveTypeLabel(payload.leaveType)}`,
    `Dates: ${formatDate(payload.startDate)} – ${formatDate(payload.endDate)}`,
    `Days: ${payload.days}`,
    ``,
    `View in ERP: ${leaveSelfUrl()}`,
  ].join('\n')
  const html = wrapHtml('Leave Booked', `
    <p>Hi ${escapeHtml(greeting)},</p>
    <p>${escapeHtml(payload.reviewerName || 'HR')} has booked leave for you.</p>
    ${detailBlock(payload)}
    <p><a href="${escapeHtml(leaveSelfUrl())}" style="display:inline-block;background:#1B2762;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">View My Leave</a></p>
  `)
  await sendHrMailbox({
    to: applicant.email,
    subject,
    html,
    text,
    metadata: { action: 'leave_booked', leaveId: payload.id, ref: payload.ref },
  })
}

/** Fire-and-forget wrapper so callers never await mail failures. */
export function queueLeaveNotification(task: () => Promise<void>): void {
  void task().catch(err => {
    console.error('[leave-notifications] background task failed', err)
  })
}

export function toLeaveNotifyPayload(row: {
  id: string
  reference?: string | null
  ref?: string | null
  employeeId: string
  employeeName?: string | null
  leaveType: string
  startDate: Date | string
  endDate: Date | string
  daysRequested?: number | null
  days?: number | null
  reason?: string | null
  status: string
  reviewedByName?: string | null
  reviewNotes?: string | null
}): LeaveNotifyPayload {
  const start = row.startDate instanceof Date ? row.startDate.toISOString() : String(row.startDate)
  const end = row.endDate instanceof Date ? row.endDate.toISOString() : String(row.endDate)
  return {
    id: row.id,
    ref: String(row.reference || row.ref || row.id),
    employeeId: row.employeeId,
    employeeName: String(row.employeeName || 'Employee'),
    leaveType: String(row.leaveType),
    startDate: start.slice(0, 10),
    endDate: end.slice(0, 10),
    days: Number(row.daysRequested ?? row.days ?? 0) || 0,
    reason: row.reason,
    status: String(row.status),
    reviewerName: row.reviewedByName,
    reviewNotes: row.reviewNotes,
  }
}
