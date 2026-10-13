import 'server-only'

import prisma from '@/lib/prisma'
import { publishNotificationEvent } from './service'
import type { NotificationChannel } from './types'

type LeaveRow = {
  id: string
  reference?: string | null
  employeeId: string
  employeeName?: string | null
  leaveType: string
  startDate: Date | string
  endDate: Date | string
  daysRequested: unknown
  reason?: string | null
  status: string
  reviewedByName?: string | null
  reviewNotes?: string | null
}

type SalaryAdvanceRow = {
  id: string
  reference?: string | null
  employeeId: string
  employeeName?: string | null
  amount: unknown
  status: string
  approvedByName?: string | null
  decisionNote?: string | null
  paidDate?: Date | string | null
}

const date = (value: Date | string) => {
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toISOString().slice(0, 10)
}

async function employeeRecipient(employeeId: string) {
  return prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      workEmail: true,
      phone: true,
      user: { select: { id: true, email: true, phone: true } },
    },
  })
}

type EmployeeRecipient = Awaited<ReturnType<typeof employeeRecipient>>

/** Company mailbox first (HR sets it on the employee), then the login email, then the personal one. */
function employeeEmail(employee: EmployeeRecipient): string | undefined {
  return (employee?.workEmail || employee?.user?.email || employee?.email || '').trim().toLowerCase() || undefined
}

function employeeExternal(employee: EmployeeRecipient): Array<{ name: string; email?: string; phone?: string; channels: NotificationChannel[] }> {
  const email = employeeEmail(employee)
  const phone = employee?.phone || employee?.user?.phone
  return email || phone ? [{
    name: [employee?.firstName, employee?.lastName].filter(Boolean).join(' '),
    email,
    phone: phone || undefined,
    channels: ['email', 'sms'],
  }] : []
}

const fullName = (person?: { firstName?: string | null; lastName?: string | null } | null) =>
  [person?.firstName, person?.lastName].filter(Boolean).join(' ').trim()

/**
 * The email comes from this person's work email (the ERP signs in as the HR
 * mailbox, so no staff password is used) and Reply goes back to them. If the
 * mail server refuses, it shows "Jane Wanjiku (via Deed HR)" instead.
 */
function fromPerson(email?: string, name?: string): Record<string, string> {
  return {
    ...(email ? { emailReplyTo: email, emailSenderEmail: email } : {}),
    ...(name ? { emailSenderName: name } : {}),
  }
}

/** The person who acted (e.g. the approver): work email for Reply-To, and their name. */
async function actorSender(actorUserId?: string | null): Promise<Record<string, string>> {
  if (!actorUserId) return {}
  const user = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { username: true, email: true, employee: { select: { workEmail: true, firstName: true, lastName: true } } },
  })
  const email = (user?.employee?.workEmail || user?.email || '').trim().toLowerCase() || undefined
  return fromPerson(email, fullName(user?.employee) || user?.username || undefined)
}

function leaveBody(row: LeaveRow) {
  return [
    `${row.employeeName || 'Employee'} — ${String(row.leaveType).replaceAll('_', ' ')}`,
    `${date(row.startDate)} to ${date(row.endDate)} · ${Number(row.daysRequested || 0)} day(s)`,
    row.reason ? `Reason: ${row.reason}` : null,
    row.reviewNotes ? `Note: ${row.reviewNotes}` : null,
  ].filter(Boolean).join('\n')
}

export async function publishLeaveApplied(row: LeaveRow, actorUserId?: string | null) {
  const employee = await employeeRecipient(row.employeeId)
  const applicantEmail = employeeEmail(employee)
  const applicantName = fullName(employee) || row.employeeName || undefined
  // The applicant gets a receipt at their work email…
  await publishNotificationEvent({
    eventType: 'hr.leave.submitted',
    entityType: 'leave_request',
    entityId: row.id,
    actorUserId,
    userIds: [employee?.user?.id],
    externalRecipients: applicantEmail ? [{ name: fullName(employee), email: applicantEmail, channels: ['email'] }] : [],
    title: `Leave application received — ${row.reference || row.id}`,
    body: `${leaveBody(row)}\nIt is waiting for approval; you will be emailed the decision.`,
    actionUrl: '/hr?tab=self_service',
    idempotencyKey: `hr-leave-submitted:${row.id}`,
  }).catch(err => console.error('[hr-events] leave receipt failed:', err))
  // …and approvers can reply to the applicant directly.
  return publishNotificationEvent({
    eventType: 'hr.leave.approval_required',
    entityType: 'leave_request',
    entityId: row.id,
    actorUserId,
    title: `Leave approval required — ${row.reference || row.id}`,
    body: leaveBody(row),
    actionUrl: '/hr?tab=leave',
    metadata: {
      leaveType: row.leaveType,
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      days: Number(row.daysRequested || 0),
      ...fromPerson(applicantEmail, applicantName),
    },
    idempotencyKey: `hr-leave-applied:${row.id}`,
  })
}

export async function publishLeaveBooked(row: LeaveRow, actorUserId?: string | null) {
  const employee = await employeeRecipient(row.employeeId)
  return publishNotificationEvent({
    eventType: 'hr.leave.booked',
    entityType: 'leave_request',
    entityId: row.id,
    actorUserId,
    userIds: [employee?.user?.id],
    externalRecipients: employeeExternal(employee),
    title: `Leave booked — ${row.reference || row.id}`,
    body: leaveBody(row),
    actionUrl: '/hr?tab=self_service',
    idempotencyKey: `hr-leave-booked:${row.id}`,
  })
}

export async function publishLeaveDecision(
  row: LeaveRow,
  decision: 'approved' | 'rejected',
  actorUserId?: string | null,
) {
  const employee = await employeeRecipient(row.employeeId)
  const eventType = decision === 'approved' ? 'hr.leave.approved' : 'hr.leave.rejected'
  const verb = decision === 'approved' ? 'approved' : 'declined'
  return publishNotificationEvent({
    eventType,
    entityType: 'leave_request',
    entityId: row.id,
    actorUserId,
    userIds: [employee?.user?.id],
    externalRecipients: employeeExternal(employee),
    title: `Leave ${row.reference || row.id} ${verb}`,
    metadata: await actorSender(actorUserId),
    body: `${leaveBody(row)}\nDecision: ${verb}${row.reviewedByName ? ` by ${row.reviewedByName}` : ''}`,
    actionUrl: '/hr?tab=self_service',
    idempotencyKey: `hr-leave-${decision}:${row.id}`,
  })
}

export async function publishLeaveCancelled(row: LeaveRow, actorUserId?: string | null) {
  return publishNotificationEvent({
    eventType: 'hr.leave.cancelled',
    entityType: 'leave_request',
    entityId: row.id,
    actorUserId,
    roles: ['director'],
    title: `Leave cancelled — ${row.reference || row.id}`,
    body: leaveBody(row),
    actionUrl: '/hr?tab=leave',
    idempotencyKey: `hr-leave-cancelled:${row.id}`,
  })
}

export async function publishSalaryAdvanceApplied(row: SalaryAdvanceRow, actorUserId?: string | null) {
  const employee = await employeeRecipient(row.employeeId)
  return publishNotificationEvent({
    eventType: 'hr.salary_advance.approval_required',
    entityType: 'salary_advance',
    entityId: row.id,
    actorUserId,
    title: `Salary advance approval required — ${row.reference || row.id}`,
    body: `${row.employeeName || 'Employee'} requested KES ${Math.round(Number(row.amount || 0)).toLocaleString('en-KE')}.`,
    actionUrl: '/hr?tab=salary_advances',
    metadata: {
      employeeId: row.employeeId,
      amount: Number(row.amount || 0),
      ...fromPerson(employeeEmail(employee), fullName(employee) || row.employeeName || undefined),
    },
    idempotencyKey: `hr-salary-advance-applied:${row.id}`,
  })
}

export async function publishSalaryAdvanceDecision(
  row: SalaryAdvanceRow,
  decision: 'approved' | 'rejected',
  actorUserId?: string | null,
) {
  const employee = await employeeRecipient(row.employeeId)
  const eventType = decision === 'approved' ? 'hr.salary_advance.approved' : 'hr.salary_advance.rejected'
  return publishNotificationEvent({
    eventType,
    entityType: 'salary_advance',
    entityId: row.id,
    actorUserId,
    userIds: [employee?.user?.id],
    externalRecipients: employeeExternal(employee),
    title: `Salary advance ${row.reference || row.id} ${decision}`,
    metadata: await actorSender(actorUserId),
    body: `Your salary advance of KES ${Math.round(Number(row.amount || 0)).toLocaleString('en-KE')} was ${decision}.${row.decisionNote ? ` Note: ${row.decisionNote}` : ''}`,
    actionUrl: '/hr?tab=self_service',
    idempotencyKey: `hr-salary-advance-${decision}:${row.id}`,
  })
}

export async function publishSalaryAdvanceDisbursed(row: SalaryAdvanceRow, actorUserId?: string | null) {
  const employee = await employeeRecipient(row.employeeId)
  return publishNotificationEvent({
    eventType: 'hr.salary_advance.disbursed',
    entityType: 'salary_advance',
    entityId: row.id,
    actorUserId,
    userIds: [employee?.user?.id],
    externalRecipients: employeeExternal(employee),
    title: `Salary advance disbursed — ${row.reference || row.id}`,
    body: `KES ${Math.round(Number(row.amount || 0)).toLocaleString('en-KE')} has been disbursed.${row.paidDate ? ` Date: ${date(row.paidDate)}.` : ''}`,
    actionUrl: '/hr?tab=self_service',
    idempotencyKey: `hr-salary-advance-disbursed:${row.id}`,
  })
}
