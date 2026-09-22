import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma, mockPublish, mockResolve } = vi.hoisted(() => ({
  mockPrisma: {
    saleOrder: { findUnique: vi.fn() },
    invoice: { findUnique: vi.fn() },
    payrollRun: { findUnique: vi.fn() },
    payslip: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
  },
  mockPublish: vi.fn(),
  mockResolve: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/notifications/service', () => ({
  publishNotificationEvent: mockPublish,
  resolveEntityNotifications: mockResolve,
}))

import {
  notifyInvoicePayment,
  notifyPayrollApproved,
  notifyPayrollPaid,
  notifyPayrollPosted,
  notifyPayrollSubmitted,
  notifySaleOrderConfirmed,
} from '@/lib/notifications/business-events'
import { bridgeEventType } from '@/lib/notifications/bridge-event-type'
import { NOTIFICATION_POLICIES } from '@/lib/notifications/registry'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const RUN = { id: 'run-1', runReference: 'PAY/2026/09', periodEnd: new Date('2026-09-30'), createdById: U1, approvedById: null }

beforeEach(() => {
  vi.clearAllMocks()
  mockPublish.mockResolvedValue({ id: 'evt' })
  mockResolve.mockResolvedValue(0)
  mockPrisma.payrollRun.findUnique.mockResolvedValue(RUN)
  mockPrisma.payslip.findMany.mockResolvedValue([
    { id: 'slip-a', employeeId: 'emp-a' },
    { id: 'slip-b', employeeId: 'emp-b' },
    { id: 'slip-c', employeeId: 'emp-c' },
  ])
  mockPrisma.employee.findMany.mockResolvedValue([
    { id: 'emp-a', user: { id: U1, isActive: true } },
    { id: 'emp-b', user: { id: U2, isActive: false } }, // inactive: skipped
    { id: 'emp-c', user: null },                        // no login: skipped
  ])
})

describe('every published event type has a registry policy', () => {
  it.each([
    'sales.order.confirmed', 'sales.invoice.payment', 'sales.invoice.paid',
    'hr.payroll.approval_required', 'hr.payroll.approved', 'hr.payslip.ready', 'hr.salary.paid',
  ])('%s', eventType => {
    expect(NOTIFICATION_POLICIES[eventType]).toBeDefined()
  })
})

describe('sales', () => {
  it('confirmed order notifies the salesperson and inventory officers, once per order', async () => {
    mockPrisma.saleOrder.findUnique.mockResolvedValue({
      id: 'so-1', orderNumber: 'SO/2026/0100', totalAmount: 45000, salespersonId: U2, client: { name: 'ACME' },
    })
    await notifySaleOrderConfirmed('so-1', U1)
    const call = mockPublish.mock.calls[0][0]
    expect(call).toMatchObject({
      eventType: 'sales.order.confirmed',
      userIds: [U2],
      roles: ['inventory_officer'],
      actorUserId: U1,
      idempotencyKey: 'sales-order-confirmed:so-1',
    })
    expect(call.body).toContain('KES 45,000')
  })

  it('invoice payment tells the salesperson; full payment clears the overdue alert', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1', invoiceNumber: 'INV/2026/0170', totalAmount: 10000, amountPaid: 10000, saleOrderId: 'so-1', client: { name: 'ACME' },
    })
    mockPrisma.saleOrder.findUnique.mockResolvedValue({ salespersonId: U2 })
    await notifyInvoicePayment({ invoiceId: 'inv-1', paymentId: 'pay-1', amount: 4000, actorUserId: U1 })
    expect(mockPublish.mock.calls[0][0]).toMatchObject({
      eventType: 'sales.invoice.paid', userIds: [U2], idempotencyKey: 'sales-invoice-payment:pay-1',
    })
    expect(mockResolve).toHaveBeenCalledWith('invoice', 'inv-1', ['finance.invoice_overdue'], U1)
  })

  it('part payment reports the remaining balance', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1', invoiceNumber: 'INV/2026/0170', totalAmount: 10000, amountPaid: 4000, saleOrderId: 'so-1', client: { name: 'ACME' },
    })
    mockPrisma.saleOrder.findUnique.mockResolvedValue({ salespersonId: U2 })
    await notifyInvoicePayment({ invoiceId: 'inv-1', paymentId: 'pay-1', amount: 4000 })
    const call = mockPublish.mock.calls[0][0]
    expect(call.eventType).toBe('sales.invoice.payment')
    expect(call.body).toContain('Balance KES 6,000')
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('no salesperson → no notification', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: 'inv-1', invoiceNumber: 'X', totalAmount: 1, amountPaid: 1, saleOrderId: null, client: null })
    await notifyInvoicePayment({ invoiceId: 'inv-1', paymentId: 'p', amount: 1 })
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('a notification failure never breaks the business action', async () => {
    mockPrisma.saleOrder.findUnique.mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(notifySaleOrderConfirmed('so-1')).resolves.toBeUndefined()
    err.mockRestore()
  })
})

describe('payroll', () => {
  it('submission publishes the same event type the scanner uses', async () => {
    await notifyPayrollSubmitted('run-1', U1)
    expect(mockPublish.mock.calls[0][0]).toMatchObject({
      eventType: 'hr.payroll.approval_required', entityType: 'payroll_run', entityId: 'run-1',
      idempotencyKey: 'hr-payroll-submitted:run-1',
    })
  })

  it('approval resolves the pending reminder and tells the creator', async () => {
    await notifyPayrollApproved('run-1', U2)
    expect(mockResolve).toHaveBeenCalledWith('payroll_run', 'run-1', ['hr.payroll.approval_required'], U2)
    expect(mockPublish.mock.calls[0][0]).toMatchObject({ eventType: 'hr.payroll.approved', userIds: [U1] })
  })

  it('posting sends one payslip-ready notice per active employee login', async () => {
    await notifyPayrollPosted('run-1', U2)
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish.mock.calls[0][0]).toMatchObject({
      eventType: 'hr.payslip.ready', userIds: [U1], excludeActor: false,
      idempotencyKey: 'hr-payslip-ready:slip-a', actionUrl: '/hr?tab=payroll',
    })
  })

  it('salary-paid notice carries no amounts (it can appear on a locked phone)', async () => {
    await notifyPayrollPaid('run-1', U2)
    const call = mockPublish.mock.calls[0][0]
    expect(call.eventType).toBe('hr.salary.paid')
    expect(`${call.title} ${call.body}`).not.toMatch(/KES|\d{1,3},\d{3}/)
  })
})

describe('bridge de-duplication', () => {
  it('maps browser quote approvals onto the scanner event type', () => {
    expect(bridgeEventType('quote', 'approval_abc')).toBe('sales.quote.approval_required')
    expect(bridgeEventType('repair', 'assigned')).toBe('app.repair.assigned')
  })
})

describe('daily digests replace per-item floods', () => {
  it('lists the first 10 items and counts the rest', async () => {
    const { buildDigest } = await import('@/lib/notifications/operational-scanner')
    const items = Array.from({ length: 23 }, (_, i) => ({ id: `p${i}`, line: `Product ${i}` }))
    const body = buildDigest(items)
    expect(body.split('\n')).toHaveLength(11)
    expect(body).toContain('• Product 0')
    expect(body).not.toContain('Product 10')
    expect(body).toContain('…and 13 more.')
  })
})

describe('repair alerts: Technical Lead first, directors get one daily summary', () => {
  it('repair alerts no longer escalate per job to directors', () => {
    for (const t of ['repair.unassigned', 'repair.sla_breach', 'repair.diagnosis_overdue']) {
      const p = NOTIFICATION_POLICIES[t]
      expect(p.recipientRoles).toEqual(['technical_lead'])
      expect(p.escalationMinutes).toBeUndefined()
      expect(p.escalationRoles ?? []).not.toContain('director')
    }
    expect(NOTIFICATION_POLICIES['repair.director_digest'].recipientRoles).toEqual(['director'])
  })

  it('counts working days, skipping weekends (Nairobi dates)', async () => {
    const { workingDaysSince } = await import('@/lib/notifications/operational-scanner')
    const fri = new Date('2026-09-18T14:00:00+03:00')
    expect(workingDaysSince(fri, new Date('2026-09-18T17:00:00+03:00'))).toBe(0) // same day
    expect(workingDaysSince(fri, new Date('2026-09-20T10:00:00+03:00'))).toBe(0) // Sunday
    expect(workingDaysSince(fri, new Date('2026-09-21T09:30:00+03:00'))).toBe(1) // Monday
    expect(workingDaysSince(fri, new Date('2026-09-23T09:30:00+03:00'))).toBe(3) // Wednesday
    // 23:30 EAT is still the same Nairobi day even though UTC is 20:30
    expect(workingDaysSince(new Date('2026-09-21T23:30:00+03:00'), new Date('2026-09-22T00:30:00+03:00'))).toBe(1)
  })

  it('lists jobs unassigned since before today and jobs past their promised date', async () => {
    const { buildRepairDirectorDigestItems } = await import('@/lib/notifications/operational-scanner')
    const now = new Date('2026-09-22T09:30:00+03:00') // Tuesday
    const base = { deviceBrand: 'HP', deviceModel: 'EliteBook 840', deviceType: 'laptop', promisedDate: null }
    const items = buildRepairDirectorDigestItems([
      { ...base, id: 'a', jobNumber: 'RJ-1', status: 'intake', assignedToId: null, createdAt: new Date('2026-09-22T08:00:00+03:00') }, // today: not yet
      { ...base, id: 'b', jobNumber: 'RJ-2', status: 'intake', assignedToId: null, createdAt: new Date('2026-09-21T15:00:00+03:00') }, // yesterday
      { ...base, id: 'c', jobNumber: 'RJ-3', status: 'diagnosis', assignedToId: null, createdAt: new Date('2026-09-17T10:00:00+03:00') },
      { ...base, id: 'd', jobNumber: 'RJ-4', status: 'in_repair', assignedToId: 'tech', createdAt: new Date('2026-09-10T10:00:00+03:00'), promisedDate: new Date('2026-09-19T00:00:00Z') },
      { ...base, id: 'e', jobNumber: 'RJ-5', status: 'ready', assignedToId: 'tech', createdAt: new Date('2026-09-10T10:00:00+03:00'), promisedDate: new Date('2026-09-19T00:00:00Z') },
    ], now)
    expect(items.map(i => i.id)).toEqual(['c', 'b', 'd'])
    expect(items[0].line).toBe('RJ-3 — unassigned 3 working days (HP EliteBook 840)')
    expect(items[2].line).toContain('past promised date 2026-09-19 (in repair)')
  })
})
