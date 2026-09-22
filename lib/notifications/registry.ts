import type { NotificationPolicy, NotificationSeverity } from './types'

export const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  info: 0,
  success: 1,
  attention: 2,
  warning: 3,
  critical: 4,
}

const POLICY = (
  channels: NotificationPolicy['channels'],
  severity: NotificationPolicy['severity'],
  options: Partial<NotificationPolicy> = {},
): NotificationPolicy => ({
  channels,
  severity,
  priority: severity === 'critical' ? 'urgent' : severity === 'warning' ? 'high' : 'normal',
  ...options,
})

/**
 * Central event policy registry. Business modules publish events; this table
 * owns delivery channels, urgency, acknowledgement and escalation semantics.
 * Event-specific user/customer targets are added by the publisher/scanner.
 *
 * Routing principle: notifications go to the responsible officer first.
 * The director receives only approval requests and system-critical alerts.
 * All other critical events escalate to the director after a cooldown
 * if the primary recipient hasn't acknowledged.
 */
export const NOTIFICATION_POLICIES: Record<string, NotificationPolicy> = {
  // ── CRM & Sales ──────────────────────────────────────────────────────────
  'crm.lead.created': POLICY(['in_app', 'push'], 'attention', { escalationMinutes: 60, escalationRoles: ['director'] }),
  'crm.opportunity.assigned': POLICY(['in_app'], 'info'),
  'crm.opportunity.stale': POLICY(['in_app'], 'warning', { cooldownHours: 72, escalationMinutes: 1440, escalationRoles: ['director'] }),
  'crm.opportunity.close_due': POLICY(['in_app', 'push'], 'warning', { cooldownHours: 24 }),
  'sales.quote.approval_required': POLICY(['in_app', 'push', 'email'], 'attention', { recipientRoles: ['director'], requiresAcknowledgement: true, escalationMinutes: 120 }),
  'sales.quote.expiring': POLICY(['in_app'], 'warning', { cooldownHours: 24 }),
  'sales.order.confirmed': POLICY(['in_app', 'push'], 'success'),
  'sales.invoice.payment': POLICY(['in_app'], 'success'),
  'sales.invoice.paid': POLICY(['in_app', 'push'], 'success'),
  'sales.followup.overdue': POLICY(['in_app'], 'warning', { cooldownHours: 24 }),

  // ── Repairs (customer-facing) ────────────────────────────────────────────
  'repair.received': POLICY(['sms'], 'success'),
  'repair.customer_message': POLICY(['email', 'whatsapp', 'sms'], 'attention', { fallbackSms: true }),
  'repair.quote_ready': POLICY(['email', 'whatsapp', 'sms'], 'attention', { fallbackSms: true }),
  'repair.ready': POLICY(['email', 'whatsapp', 'sms'], 'success', { fallbackSms: true, cooldownHours: 24 }),
  'repair.uncollected': POLICY(['email', 'whatsapp', 'sms'], 'warning', { fallbackSms: true, cooldownHours: 72 }),

  // ── Repairs (internal) ──────────────────────────────────────────────────
  // Workshop alerts go to the Technical Lead only and stay open until the job
  // is assigned / back on schedule. Directors no longer get a per-job
  // escalation 30–60 min later; they get `repair.director_digest` instead.
  'repair.unassigned': POLICY(['in_app', 'push'], 'critical', { recipientRoles: ['technical_lead'], mandatory: true, cooldownHours: 4 }),
  'repair.assignment': POLICY(['in_app', 'push'], 'attention'),
  'repair.diagnosis_overdue': POLICY(['in_app', 'push'], 'warning', { recipientRoles: ['technical_lead'], cooldownHours: 24 }),
  'repair.customer_approval': POLICY(['in_app'], 'attention'),
  'repair.quote_declined': POLICY(['in_app'], 'warning'),
  'repair.parts_requested': POLICY(['in_app'], 'attention', { recipientRoles: ['inventory_officer'] }),
  'repair.parts_received': POLICY(['in_app', 'push'], 'attention'),
  'repair.sla_breach': POLICY(['in_app', 'push', 'email'], 'critical', { recipientRoles: ['technical_lead'], mandatory: true, cooldownHours: 12 }),
  // One summary per working day for the directors (see scanRepairs).
  'repair.director_digest': POLICY(['in_app', 'push'], 'warning', { recipientRoles: ['director'] }),

  // ── Purchasing ──────────────────────────────────────────────────────────
  'purchase.rfq_ready': POLICY(['in_app'], 'attention'),
  'purchase.po_approval_required': POLICY(['in_app', 'push', 'email'], 'attention', { recipientRoles: ['director', 'finance_officer'], requiresAcknowledgement: true, escalationMinutes: 180 }),
  'purchase.po_overdue': POLICY(['in_app'], 'warning', { recipientRoles: ['inventory_officer'], cooldownHours: 48 }),
  'purchase.grn_validation_required': POLICY(['in_app'], 'attention', { recipientRoles: ['inventory_officer'], cooldownHours: 24 }),
  'purchase.match_exception': POLICY(['in_app', 'email'], 'critical', { recipientRoles: ['finance_officer'], requiresAcknowledgement: true, escalationMinutes: 120, escalationRoles: ['director'], mandatory: true, cooldownHours: 24 }),
  'purchase.vendor_bill_blocked': POLICY(['in_app'], 'warning', { recipientRoles: ['finance_officer'], cooldownHours: 48 }),
  'purchase.vendor_bill_due': POLICY(['in_app'], 'warning', { recipientRoles: ['finance_officer'], cooldownHours: 24 }),

  // ── Inventory ───────────────────────────────────────────────────────────
  'inventory.low_stock': POLICY(['in_app'], 'warning', { recipientRoles: ['inventory_officer'], cooldownHours: 72 }),
  'inventory.negative_stock_attempt': POLICY(['in_app', 'push'], 'critical', { recipientRoles: ['inventory_officer'], requiresAcknowledgement: true, escalationMinutes: 30, escalationRoles: ['director'], mandatory: true }),
  'inventory.serial_mismatch': POLICY(['in_app', 'push'], 'critical', { recipientRoles: ['inventory_officer', 'technical_lead'], requiresAcknowledgement: true, escalationMinutes: 60, escalationRoles: ['director'] }),
  'inventory.transfer_overdue': POLICY(['in_app'], 'warning', { recipientRoles: ['inventory_officer'], cooldownHours: 48 }),
  'inventory.valuation_exception': POLICY(['in_app'], 'warning', { recipientRoles: ['finance_officer'], cooldownHours: 48, escalationMinutes: 1440, escalationRoles: ['director'] }),

  // ── Delivery ────────────────────────────────────────────────────────────
  'delivery.assigned': POLICY(['in_app', 'push'], 'attention'),
  'delivery.dispatched': POLICY(['email', 'whatsapp', 'sms'], 'success', { fallbackSms: true }),
  'delivery.failed': POLICY(['in_app', 'push'], 'critical', { recipientRoles: ['admin_officer'], requiresAcknowledgement: true, escalationMinutes: 30, escalationRoles: ['director'] }),
  'delivery.overdue': POLICY(['in_app'], 'warning', { recipientRoles: ['admin_officer'], cooldownHours: 24 }),
  'delivery.pod_missing': POLICY(['in_app'], 'warning', { recipientRoles: ['admin_officer'], cooldownHours: 48 }),

  // ── Finance ─────────────────────────────────────────────────────────────
  'finance.invoice_overdue': POLICY(['in_app'], 'warning', { recipientRoles: ['finance_officer'], cooldownHours: 72 }),
  'finance.payment_received': POLICY(['email', 'whatsapp', 'sms'], 'success', { fallbackSms: true }),
  'finance.payment_allocation_exception': POLICY(['in_app', 'email'], 'critical', { recipientRoles: ['finance_officer'], requiresAcknowledgement: true, escalationMinutes: 60, escalationRoles: ['director'], mandatory: true, cooldownHours: 24 }),
  'finance.bank_reconciliation_exception': POLICY(['in_app'], 'warning', { recipientRoles: ['finance_officer'], cooldownHours: 72, escalationMinutes: 1440, escalationRoles: ['director'] }),
  'finance.vat_exception': POLICY(['in_app'], 'warning', { recipientRoles: ['finance_officer'], cooldownHours: 48, escalationMinutes: 1440, escalationRoles: ['director'] }),
  'finance.integrity_failure': POLICY(['in_app', 'push'], 'critical', { recipientRoles: ['finance_officer'], requiresAcknowledgement: true, escalationMinutes: 120, escalationRoles: ['director'], mandatory: true, cooldownHours: 24 }),
  'finance.month_end_action': POLICY(['in_app'], 'attention', { recipientRoles: ['finance_officer'] }),

  // ── HR ──────────────────────────────────────────────────────────────────
  'hr.leave.approval_required': POLICY(['in_app', 'push', 'email', 'sms'], 'attention', { recipientRoles: ['director', 'admin_officer'], requiresAcknowledgement: true, escalationMinutes: 240, mandatoryChannels: ['sms'] }),
  'hr.leave.approved': POLICY(['in_app', 'sms'], 'success'),
  'hr.leave.rejected': POLICY(['in_app', 'sms'], 'warning'),
  'hr.leave.booked': POLICY(['in_app', 'sms'], 'attention'),
  'hr.leave.cancelled': POLICY(['in_app'], 'info'),
  'hr.salary_advance.approval_required': POLICY(['in_app', 'push', 'email', 'sms'], 'attention', { recipientRoles: ['director', 'finance_officer'], requiresAcknowledgement: true, escalationMinutes: 240, mandatoryChannels: ['sms'] }),
  'hr.salary_advance.approved': POLICY(['in_app', 'sms'], 'success'),
  'hr.salary_advance.rejected': POLICY(['in_app', 'sms'], 'warning'),
  'hr.salary_advance.disbursed': POLICY(['in_app', 'sms'], 'success'),
  'hr.payroll.approval_required': POLICY(['in_app', 'push', 'email', 'sms'], 'critical', { recipientRoles: ['director', 'finance_officer'], requiresAcknowledgement: true, escalationMinutes: 120, mandatory: true, mandatoryChannels: ['sms'] }),
  'hr.payroll.approved': POLICY(['in_app', 'push'], 'attention', { recipientRoles: ['finance_officer'] }),
  'hr.payslip.ready': POLICY(['in_app', 'push'], 'success'),
  'hr.salary.paid': POLICY(['in_app', 'push', 'sms'], 'success'),
  'hr.contract.expiring': POLICY(['in_app'], 'warning', { recipientRoles: ['admin_officer'], cooldownHours: 168 }),
  'hr.attendance.missing': POLICY(['in_app'], 'info', { cooldownHours: 12 }),

  // ── Aftersales ──────────────────────────────────────────────────────────
  'aftersales.warranty.expiring': POLICY(['email', 'whatsapp', 'sms'], 'attention', { fallbackSms: true, cooldownHours: 168 }),
  'aftersales.rma_action_required': POLICY(['in_app', 'push'], 'warning', { recipientRoles: ['admin_officer', 'technical_lead'], cooldownHours: 24 }),
  'aftersales.sla_breach': POLICY(['in_app', 'push', 'email'], 'critical', { recipientRoles: ['technical_lead'], requiresAcknowledgement: true, escalationMinutes: 60, escalationRoles: ['director'], mandatory: true, cooldownHours: 12 }),

  // ── System ──────────────────────────────────────────────────────────────
  'system.escalation': POLICY(['in_app', 'push', 'email'], 'critical', { requiresAcknowledgement: true, mandatory: true }),
  'system.push_test': POLICY(['push'], 'info'),
  'system.manual_message': POLICY(['email'], 'info'),
  'system.sms_reply': POLICY(['sms'], 'info'),
  'system.security': POLICY(['in_app', 'push', 'email'], 'critical', { recipientRoles: ['director'], requiresAcknowledgement: true, escalationMinutes: 30, mandatory: true }),
  'system.integration_failure': POLICY(['in_app', 'email'], 'critical', { recipientRoles: ['director'], requiresAcknowledgement: true, escalationMinutes: 60, mandatory: true }),
}

export const defaultNotificationPolicy = (eventType: string): NotificationPolicy =>
  NOTIFICATION_POLICIES[eventType] || POLICY(['in_app'], 'info')

export function shouldBypassUserPreference(eventType: string, severity: NotificationSeverity): boolean {
  const policy = defaultNotificationPolicy(eventType)
  return Boolean(policy.mandatory || severity === 'critical')
}
