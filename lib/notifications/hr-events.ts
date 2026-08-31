import 'server-only'

import prisma from '@/lib/prisma'
import { publishNotificationEvent } from './service'

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
      phone: true,
      user: { select: { id: true, email: true, phone: true } },
    },
  })
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
    externalRecipients: employee?.email || employee?.user?.email || employee?.phone || employee?.user?.phone ? [{
      name: [employee?.firstName, employee?.lastName].filter(Boolean).join(' '),
      email: employee?.email || employee?.user?.email,
      phone: employee?.phone || employee?.user?.phone,
      channels: ['email', 'sms'],
    }] : [],
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
    externalRecipients: employee?.email || employee?.user?.email || employee?.phone || employee?.user?.phone ? [{
      name: [employee?.firstName, employee?.lastName].filter(Boolean).join(' '),
      email: employee?.email || employee?.user?.email,
      phone: employee?.phone || employee?.user?.phone,
      channels: ['email', 'sms'],
    }] : [],
    title: `Leave ${row.reference || row.id} ${verb}`,
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
    roles: ['director', 'admin_officer'],
    title: `Leave cancelled — ${row.reference || row.id}`,
    body: leaveBody(row),
    actionUrl: '/hr?tab=leave',
    idempotencyKey: `hr-leave-cancelled:${row.id}`,
  })
}

export async function publishSalaryAdvanceApplied(row: SalaryAdvanceRow, actorUserId?: string | null) {
  return publishNotificationEvent({
    eventType: 'hr.salary_advance.approval_required',
    entityType: 'salary_advance',
    entityId: row.id,
    actorUserId,
    title: `Salary advance approval required — ${row.reference || row.id}`,
    body: `${row.employeeName || 'Employee'} requested KES ${Math.round(Number(row.amount || 0)).toLocaleString('en-KE')}.`,
    actionUrl: '/hr?tab=salary_advances',
    metadata: { employeeId: row.employeeId, amount: Number(row.amount || 0) },
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
    externalRecipients: employee?.email || employee?.user?.email || employee?.phone || employee?.user?.phone ? [{
      name: [employee?.firstName, employee?.lastName].filter(Boolean).join(' '),
      email: employee?.email || employee?.user?.email,
      phone: employee?.phone || employee?.user?.phone,
      channels: ['email', 'sms'],
    }] : [],
    title: `Salary advance ${row.reference || row.id} ${decision}`,
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
    externalRecipients: employee?.email || employee?.user?.email || employee?.phone || employee?.user?.phone ? [{
      name: [employee?.firstName, employee?.lastName].filter(Boolean).join(' '),
      email: employee?.email || employee?.user?.email,
      phone: employee?.phone || employee?.user?.phone,
      channels: ['email', 'sms'],
    }] : [],
    title: `Salary advance disbursed — ${row.reference || row.id}`,
    body: `KES ${Math.round(Number(row.amount || 0)).toLocaleString('en-KE')} has been disbursed.${row.paidDate ? ` Date: ${date(row.paidDate)}.` : ''}`,
    actionUrl: '/hr?tab=self_service',
    idempotencyKey: `hr-salary-advance-disbursed:${row.id}`,
  })
}
