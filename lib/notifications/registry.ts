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
 */
export const NOTIFICATION_POLICIES: Record<string, NotificationPolicy> = {
  'crm.lead.created': POLICY(['in_app', 'push', 'email'], 'attention', { recipientRoles: ['sales_rep'], escalationMinutes: 60, escalationRoles: ['director'] }),
  'crm.opportunity.assigned': POLICY(['in_app', 'push'], 'attention'),
  'crm.opportunity.stale': POLICY(['in_app', 'email'], 'warning', { escalationMinutes: 1440, escalationRoles: ['director'] }),
  'crm.opportunity.close_due': POLICY(['in_app', 'push', 'email'], 'warning'),
  'sales.quote.approval_required': POLICY(['in_app', 'push', 'email'], 'attention', { recipientRoles: ['director'], requiresAcknowledgement: true, escalationMinutes: 120 }),
  'sales.quote.expiring': POLICY(['in_app', 'email'], 'warning'),
  'sales.order.confirmed': POLICY(['in_app'], 'success'),
  'sales.followup.overdue': POLICY(['in_app', 'push'], 'warning'),

  'repair.unassigned': POLICY(['in_app', 'push'], 'critical', { recipientRoles: ['technical_lead', 'director'], requiresAcknowledgement: true, escalationMinutes: 30, escalationRoles: ['director'], mandatory: true }),
  'repair.assignment': POLICY(['in_app', 'push'], 'attention'),
  'repair.diagnosis_overdue': POLICY(['in_app', 'push', 'email'], 'warning', { escalationMinutes: 120, escalationRoles: ['technical_lead', 'director'] }),
  'repair.customer_approval': POLICY(['in_app', 'push'], 'attention'),
  'repair.quote_declined': POLICY(['in_app'], 'warning'),
  'repair.parts_requested': POLICY(['in_app', 'email'], 'attention', { recipientRoles: ['inventory_officer', 'admin_officer'] }),
  'repair.parts_received': POLICY(['in_app', 'push'], 'attention'),
  'repair.sla_breach': POLICY(['in_app', 'push', 'email'], 'critical', { recipientRoles: ['technical_lead', 'director'], requiresAcknowledgement: true, escalationMinutes: 60, mandatory: true }),
  'repair.ready': POLICY(['email', 'whatsapp'], 'success', { fallbackSms: true }),
  'repair.uncollected': POLICY(['email', 'whatsapp'], 'warning', { fallbackSms: true }),

  'purchase.rfq_ready': POLICY(['in_app'], 'attention'),
  'purchase.po_approval_required': POLICY(['in_app', 'push', 'email'], 'attention', { recipientRoles: ['director', 'finance_officer'], requiresAcknowledgement: true, escalationMinutes: 180 }),
  'purchase.po_overdue': POLICY(['in_app', 'email'], 'warning', { recipientRoles: ['inventory_officer', 'admin_officer'] }),
  'purchase.grn_validation_required': POLICY(['in_app', 'push'], 'attention', { recipientRoles: ['inventory_officer'] }),
  'purchase.match_exception': POLICY(['in_app', 'email'], 'critical', { recipientRoles: ['finance_officer', 'director'], requiresAcknowledgement: true, escalationMinutes: 120, mandatory: true }),
  'purchase.vendor_bill_blocked': POLICY(['in_app', 'email'], 'warning', { recipientRoles: ['finance_officer'] }),
  'purchase.vendor_bill_due': POLICY(['in_app', 'email'], 'warning', { recipientRoles: ['finance_officer'] }),

  'inventory.low_stock': POLICY(['in_app'], 'warning', { recipientRoles: ['inventory_officer'] }),
  'inventory.negative_stock_attempt': POLICY(['in_app', 'push'], 'critical', { recipientRoles: ['inventory_officer', 'director'], requiresAcknowledgement: true, escalationMinutes: 30, mandatory: true }),
  'inventory.serial_mismatch': POLICY(['in_app', 'push'], 'critical', { recipientRoles: ['inventory_officer', 'technical_lead'], requiresAcknowledgement: true, escalationMinutes: 60 }),
  'inventory.transfer_overdue': POLICY(['in_app'], 'warning', { recipientRoles: ['inventory_officer'] }),
  'inventory.valuation_exception': POLICY(['in_app', 'email'], 'critical', { recipientRoles: ['finance_officer', 'director'], requiresAcknowledgement: true, escalationMinutes: 60, mandatory: true }),

  'delivery.assigned': POLICY(['in_app', 'push'], 'attention'),
  'delivery.dispatched': POLICY(['email', 'whatsapp'], 'success', { fallbackSms: true }),
  'delivery.failed': POLICY(['in_app', 'push', 'email'], 'critical', { recipientRoles: ['admin_officer', 'director'], requiresAcknowledgement: true, escalationMinutes: 30 }),
  'delivery.overdue': POLICY(['in_app', 'push'], 'warning', { recipientRoles: ['admin_officer'] }),
  'delivery.pod_missing': POLICY(['in_app'], 'warning', { recipientRoles: ['admin_officer'] }),

  'finance.invoice_overdue': POLICY(['in_app', 'email'], 'warning', { recipientRoles: ['finance_officer'] }),
  'finance.payment_received': POLICY(['email', 'whatsapp'], 'success', { fallbackSms: true }),
  'finance.payment_allocation_exception': POLICY(['in_app', 'email'], 'critical', { recipientRoles: ['finance_officer', 'director'], requiresAcknowledgement: true, escalationMinutes: 60, mandatory: true }),
  'finance.bank_reconciliation_exception': POLICY(['in_app', 'email'], 'critical', { recipientRoles: ['finance_officer', 'director'], requiresAcknowledgement: true, escalationMinutes: 120, mandatory: true }),
  'finance.vat_exception': POLICY(['in_app', 'email'], 'critical', { recipientRoles: ['finance_officer', 'director'], requiresAcknowledgement: true, escalationMinutes: 120, mandatory: true }),
  'finance.integrity_failure': POLICY(['in_app', 'push', 'email'], 'critical', { recipientRoles: ['finance_officer', 'director'], requiresAcknowledgement: true, escalationMinutes: 60, mandatory: true }),
  'finance.month_end_action': POLICY(['in_app', 'email'], 'attention', { recipientRoles: ['finance_officer'] }),

  'hr.leave.approval_required': POLICY(['in_app', 'push', 'email'], 'attention', { recipientRoles: ['director', 'admin_officer'], requiresAcknowledgement: true, escalationMinutes: 240 }),
  'hr.leave.approved': POLICY(['in_app', 'email'], 'success'),
  'hr.leave.rejected': POLICY(['in_app', 'email'], 'warning'),
  'hr.leave.booked': POLICY(['in_app', 'email'], 'attention'),
  'hr.leave.cancelled': POLICY(['in_app'], 'info'),
  'hr.salary_advance.approval_required': POLICY(['in_app', 'push', 'email'], 'attention', { recipientRoles: ['director', 'finance_officer'], requiresAcknowledgement: true, escalationMinutes: 240 }),
  'hr.salary_advance.approved': POLICY(['in_app', 'email'], 'success'),
  'hr.salary_advance.rejected': POLICY(['in_app', 'email'], 'warning'),
  'hr.salary_advance.disbursed': POLICY(['in_app', 'email'], 'success'),
  'hr.payroll.approval_required': POLICY(['in_app', 'push', 'email'], 'critical', { recipientRoles: ['director', 'finance_officer'], requiresAcknowledgement: true, escalationMinutes: 120, mandatory: true }),
  'hr.payslip.ready': POLICY(['in_app', 'email'], 'success'),
  'hr.contract.expiring': POLICY(['in_app', 'email'], 'warning', { recipientRoles: ['admin_officer', 'director'] }),
  'hr.attendance.missing': POLICY(['in_app'], 'warning'),

  'aftersales.warranty.expiring': POLICY(['email', 'whatsapp'], 'attention', { fallbackSms: true }),
  'aftersales.rma_action_required': POLICY(['in_app', 'push'], 'warning', { recipientRoles: ['admin_officer', 'technical_lead'] }),
  'aftersales.sla_breach': POLICY(['in_app', 'push', 'email'], 'critical', { recipientRoles: ['technical_lead', 'director'], requiresAcknowledgement: true, escalationMinutes: 60, mandatory: true }),

  'system.security': POLICY(['in_app', 'push', 'email'], 'critical', { recipientRoles: ['director'], requiresAcknowledgement: true, escalationMinutes: 30, mandatory: true }),
  'system.integration_failure': POLICY(['in_app', 'email'], 'critical', { recipientRoles: ['director'], requiresAcknowledgement: true, escalationMinutes: 60, mandatory: true }),
}

export const defaultNotificationPolicy = (eventType: string): NotificationPolicy =>
  NOTIFICATION_POLICIES[eventType] || POLICY(['in_app'], 'info')

export function shouldBypassUserPreference(eventType: string, severity: NotificationSeverity): boolean {
  const policy = defaultNotificationPolicy(eventType)
  return Boolean(policy.mandatory || severity === 'critical')
}
