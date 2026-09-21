import 'server-only'

import prisma from '@/lib/prisma'
import { publishNotificationEvent, resolveEntityNotifications } from './service'

/**
 * Event-driven notifications for sales orders, invoices and payroll.
 *
 * Until now these relied on the periodic operational scanner (which only runs
 * when /api/cron/notifications is called) or were never published at all
 * (`sales.order.confirmed`, `hr.payslip.ready`). Each helper is fired from the
 * route that performs the state change, uses a stable idempotency key so a
 * retried request never notifies twice, and never throws into the caller.
 */

async function safely(label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (error) {
    console.error(`[notifications] ${label} failed:`, error)
  }
}

const kes = (value: unknown) => `KES ${Math.round(Number(value) || 0).toLocaleString('en-KE')}`

const monthLabel = (value: Date | string) => {
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime())
    ? String(value).slice(0, 7)
    : d.toLocaleDateString('en-KE', { month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi' })
}

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

// ── Sales ───────────────────────────────────────────────────────────────────

export async function notifySaleOrderConfirmed(saleOrderId: string, actorUserId?: string | null) {
  await safely('sales.order.confirmed', async () => {
    const order = await prisma.saleOrder.findUnique({
      where: { id: saleOrderId },
      select: {
        id: true, orderNumber: true, totalAmount: true, salespersonId: true,
        client: { select: { name: true } },
      },
    })
    if (!order) return
    await publishNotificationEvent({
      eventType: 'sales.order.confirmed',
      entityType: 'sale_order',
      entityId: order.id,
      actorUserId: actorUserId || null,
      // Salesperson (their deal closed) + inventory officers (pick & deliver).
      userIds: [order.salespersonId],
      roles: ['inventory_officer'],
      title: `Sales order confirmed — ${order.orderNumber}`,
      body: `${order.client?.name || 'Customer'} · ${kes(order.totalAmount)}. Prepare for delivery.`,
      actionUrl: `/sales?id=${order.id}`,
      idempotencyKey: `sales-order-confirmed:${order.id}`,
    })
    // A confirmed order no longer needs its quotation approval reminder.
    await resolveEntityNotifications('quote', order.id, ['sales.quote.approval_required'], actorUserId)
  })
}

/** Internal notice to the salesperson when their customer pays an invoice. */
export async function notifyInvoicePayment(input: {
  invoiceId: string
  paymentId: string
  amount: number
  actorUserId?: string | null
}) {
  await safely('sales.invoice.payment', async () => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: input.invoiceId },
      select: {
        id: true, invoiceNumber: true, totalAmount: true, amountPaid: true, saleOrderId: true,
        client: { select: { name: true } },
      },
    })
    if (!invoice) return
    const order = invoice.saleOrderId
      ? await prisma.saleOrder.findUnique({ where: { id: invoice.saleOrderId }, select: { salespersonId: true } })
      : null
    if (!order?.salespersonId) return
    const balance = Number(invoice.totalAmount) - Number(invoice.amountPaid)
    const fullyPaid = balance <= 0.01
    await publishNotificationEvent({
      eventType: fullyPaid ? 'sales.invoice.paid' : 'sales.invoice.payment',
      entityType: 'invoice',
      entityId: invoice.id,
      actorUserId: input.actorUserId || null,
      userIds: [order.salespersonId],
      title: fullyPaid
        ? `Invoice paid in full — ${invoice.invoiceNumber}`
        : `Payment received — ${invoice.invoiceNumber}`,
      body: fullyPaid
        ? `${invoice.client?.name || 'Customer'} has settled ${invoice.invoiceNumber} (${kes(invoice.totalAmount)}).`
        : `${invoice.client?.name || 'Customer'} paid ${kes(input.amount)}. Balance ${kes(balance)}.`,
      actionUrl: `/accounting?invoice=${invoice.id}`,
      idempotencyKey: `sales-invoice-payment:${input.paymentId}`,
    })
    if (fullyPaid) {
      await resolveEntityNotifications('invoice', invoice.id, ['finance.invoice_overdue'], input.actorUserId)
    }
  })
}

// ── Payroll ─────────────────────────────────────────────────────────────────

async function payrollRun(runId: string) {
  return prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, runReference: true, periodEnd: true, createdById: true, approvedById: true },
  })
}

export async function notifyPayrollSubmitted(runId: string, actorUserId?: string | null) {
  await safely('hr.payroll.approval_required', async () => {
    const run = await payrollRun(runId)
    if (!run) return
    // Same eventType/entity as the scanner, so the scanner sees it open and
    // does not publish a second copy.
    await publishNotificationEvent({
      eventType: 'hr.payroll.approval_required',
      entityType: 'payroll_run',
      entityId: run.id,
      actorUserId: actorUserId || null,
      title: `Payroll approval required — ${run.runReference}`,
      body: `Payroll for ${monthLabel(run.periodEnd)} was submitted and is waiting for approval.`,
      actionUrl: `/hr?tab=payroll&run=${run.id}`,
      idempotencyKey: `hr-payroll-submitted:${run.id}`,
    })
  })
}

export async function notifyPayrollApproved(runId: string, actorUserId?: string | null) {
  await safely('hr.payroll.approved', async () => {
    const run = await payrollRun(runId)
    if (!run) return
    await resolveEntityNotifications('payroll_run', run.id, ['hr.payroll.approval_required'], actorUserId)
    await publishNotificationEvent({
      eventType: 'hr.payroll.approved',
      entityType: 'payroll_run',
      entityId: run.id,
      actorUserId: actorUserId || null,
      userIds: [run.createdById],
      title: `Payroll approved — ${run.runReference}`,
      body: `Payroll for ${monthLabel(run.periodEnd)} is approved and ready to post.`,
      actionUrl: `/hr?tab=payroll&run=${run.id}`,
      idempotencyKey: `hr-payroll-approved:${run.id}`,
    })
  })
}

async function payslipRecipients(runId: string) {
  const slips = await prisma.payslip.findMany({
    where: { payrollRunId: runId },
    select: { id: true, employeeId: true },
  })
  const employees = await prisma.employee.findMany({
    where: { id: { in: slips.map(s => s.employeeId) } },
    select: { id: true, user: { select: { id: true, isActive: true } } },
  })
  const userByEmployee = new Map(
    employees
      .filter(e => e.user?.id && e.user.isActive)
      .map(e => [e.id, e.user!.id] as const),
  )
  return slips
    .map(s => ({ payslipId: s.id, userId: userByEmployee.get(s.employeeId) }))
    .filter((r): r is { payslipId: string; userId: string } => isUuid(r.userId))
}

export async function notifyPayrollPosted(runId: string, actorUserId?: string | null) {
  await safely('hr.payslip.ready', async () => {
    const run = await payrollRun(runId)
    if (!run) return
    await resolveEntityNotifications('payroll_run', run.id, ['hr.payroll.approval_required', 'hr.payroll.approved'], actorUserId)
    for (const r of await payslipRecipients(run.id)) {
      await publishNotificationEvent({
        eventType: 'hr.payslip.ready',
        entityType: 'payslip',
        entityId: r.payslipId,
        actorUserId: actorUserId || null,
        userIds: [r.userId],
        excludeActor: false,
        title: `Your payslip for ${monthLabel(run.periodEnd)} is ready`,
        body: 'Open HR › Payslips to view or download it.',
        actionUrl: '/hr?tab=payroll',
        idempotencyKey: `hr-payslip-ready:${r.payslipId}`,
      })
    }
  })
}

export async function notifyPayrollPaid(runId: string, actorUserId?: string | null) {
  await safely('hr.salary.paid', async () => {
    const run = await payrollRun(runId)
    if (!run) return
    for (const r of await payslipRecipients(run.id)) {
      await publishNotificationEvent({
        eventType: 'hr.salary.paid',
        entityType: 'payslip',
        entityId: r.payslipId,
        actorUserId: actorUserId || null,
        userIds: [r.userId],
        excludeActor: false,
        // No amounts: push/SMS text can show on a locked phone screen.
        title: `Salary for ${monthLabel(run.periodEnd)} has been paid`,
        body: 'Your net pay has been sent. Your payslip has the details.',
        actionUrl: '/hr?tab=payroll',
        idempotencyKey: `hr-salary-paid:${r.payslipId}`,
      })
    }
  })
}
