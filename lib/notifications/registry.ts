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
  'crm.lead.created': POLICY(['in_app', 'push'], 'attention'),
  'crm.lead.assigned': POLICY(['in_app', 'push'], 'attention'),
  /** A lead's follow-up date has come, or a new lead has had no contact for a day. */
  'crm.lead.follow_up_due': POLICY(['in_app', 'push'], 'warning', { cooldownHours: 24 }),
  /** A call / meeting / task scheduled on a deal is due or overdue. */
  'crm.activity.due': POLICY(['in_app', 'push'], 'warning', { cooldownHours: 24 }),
  'crm.opportunity.stale': POLICY(['in_app'], 'warning', { cooldownHours: 72 }),
  'crm.opportunity.close_due': POLICY(['in_app', 'push'], 'warning', { cooldownHours: 24 }),
  'sales.quote.approval_required': POLICY(['in_app', 'push', 'email'], 'attention', { recipientRoles: ['director'], requiresAcknowledgement: true, escalationMinutes: 120 }),
  /**
   * A quotation sent to the client three days ago with no answer. Chasing the
   * client is the admin officers' job (and the quote owner's), not the
   * directors': no acknowledgement, no escalation.
   */
  'sales.quote.client_no_reply': POLICY(['in_app', 'push', 'email'], 'warning', { recipientRoles: ['admin_officer'] }),
  'sales.quote.expiring': POLICY(['in_app'], 'warning', { cooldownHours: 24 }),
  'sales.order.confirmed': POLICY(['in_app', 'push'], 'success'),
  'sales.invoice.payment': POLICY(['in_app'], 'success'),
  'sales.invoice.paid': POLICY(['in_app', 'push'], 'success'),

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
  'repair.diagnosis_overdue': POLICY(['in_app', 'push'], 'warning', { recipientRoles: ['technical_lead'], cooldownHours: 24 }),
  'repair.parts_requested': POLICY(['in_app'], 'attention', { recipientRoles: ['inventory_officer'] }),
  'repair.sla_breach': POLICY(['in_app', 'push', 'email'], 'critical', { recipientRoles: ['technical_lead'], mandatory: true, cooldownHours: 12 }),
  // One summary per working day for the directors (see scanRepairs).
  'repair.director_digest': POLICY(['in_app', 'push'], 'warning', { recipientRoles: ['director'] }),

  // ── Purchasing ──────────────────────────────────────────────────────────
  'purchase.po_overdue': POLICY(['in_app'], 'warning', { recipientRoles: ['inventory_officer'], cooldownHours: 48 }),
  'purchase.vendor_bill_blocked': POLICY(['in_app'], 'warning', { recipientRoles: ['finance_officer'], cooldownHours: 48 }),
  // Bills to pay reach the directors too — they sign the payments.
  'purchase.vendor_bill_due': POLICY(['in_app', 'push'], 'warning', { recipientRoles: ['finance_officer', 'director'], cooldownHours: 24 }),

  // ── Cheque register: one summary a day each, until the cheque is banked or closed ──
  'finance.cheque.due_tomorrow': POLICY(['in_app', 'push', 'email'], 'attention', { recipientRoles: ['director', 'admin_officer', 'finance_officer'] }),
  'finance.cheque.ready_for_banking': POLICY(['in_app', 'push', 'email'], 'warning', { recipientRoles: ['director', 'admin_officer', 'finance_officer'] }),
  'finance.cheque.given_due': POLICY(['in_app', 'push', 'email'], 'warning', { recipientRoles: ['director', 'admin_officer', 'finance_officer'] }),

  // ── Inventory ───────────────────────────────────────────────────────────
  'inventory.low_stock': POLICY(['in_app'], 'warning', { recipientRoles: ['inventory_officer'], cooldownHours: 72 }),
  'inventory.checkout.approval_required': POLICY(['in_app', 'push'], 'attention', { recipientRoles: ['director', 'inventory_officer', 'technical_lead'] }),
  'inventory.checkout.approved': POLICY(['in_app', 'push'], 'success'),
  'inventory.checkout.rejected': POLICY(['in_app', 'push'], 'warning'),
  'inventory.valuation_exception': POLICY(['in_app'], 'warning', { recipientRoles: ['finance_officer'], cooldownHours: 48 }),

  // ── Delivery ────────────────────────────────────────────────────────────
  'delivery.dispatched': POLICY(['email', 'whatsapp', 'sms'], 'success', { fallbackSms: true }),
  'delivery.rider_completed': POLICY(['in_app', 'push'], 'success', { recipientRoles: ['admin_officer'] }),
  'delivery.failed': POLICY(['in_app', 'push'], 'critical', { recipientRoles: ['admin_officer'], requiresAcknowledgement: true, escalationMinutes: 30, escalationRoles: ['director'] }),
  'delivery.overdue': POLICY(['in_app'], 'warning', { recipientRoles: ['admin_officer'], cooldownHours: 24 }),
  'delivery.pod_missing': POLICY(['in_app'], 'warning', { recipientRoles: ['admin_officer'], cooldownHours: 48 }),

  // ── Finance ─────────────────────────────────────────────────────────────
  // Credit applications (corporate credit terms)
  'credit.application.submitted': POLICY(['in_app', 'push', 'email'], 'attention', { recipientRoles: ['finance_officer'] }),
  'credit.application.recommended': POLICY(['in_app', 'push', 'email'], 'attention', { recipientRoles: ['director'], requiresAcknowledgement: true, escalationMinutes: 1440 }),
  'credit.application.approve': POLICY(['in_app', 'push'], 'success'),
  'credit.application.decline': POLICY(['in_app', 'push'], 'warning'),
  'credit.application.request_info': POLICY(['in_app', 'push'], 'attention'),
  'credit.review_due': POLICY(['in_app', 'email'], 'warning', { recipientRoles: ['finance_officer'] }),
  'finance.invoice_overdue': POLICY(['in_app'], 'warning', { recipientRoles: ['finance_officer'], cooldownHours: 72 }),
  // Supplier credit notes (purchase returns) nobody has used or had refunded.
  // A rent / internet / electricity bill whose day has come (Bills → Recurring bills).
  'finance.recurring_bill.due': POLICY(['in_app', 'push', 'email'], 'attention', { recipientRoles: ['finance_officer'] }),
  'finance.vendor_credit_unapplied': POLICY(['in_app'], 'warning', { recipientRoles: ['finance_officer', 'director'], cooldownHours: 72 }),
  'finance.payment_received': POLICY(['email', 'whatsapp', 'sms'], 'success', { fallbackSms: true }),
  'finance.payment_allocation_exception': POLICY(['in_app', 'email'], 'critical', { recipientRoles: ['finance_officer'], requiresAcknowledgement: true, escalationMinutes: 60, escalationRoles: ['director'], mandatory: true, cooldownHours: 24 }),
  'finance.bank_reconciliation_exception': POLICY(['in_app'], 'warning', { recipientRoles: ['finance_officer'], cooldownHours: 72 }),
  'finance.vat_exception': POLICY(['in_app'], 'warning', { recipientRoles: ['finance_officer'], cooldownHours: 48 }),
  'finance.integrity_failure': POLICY(['in_app', 'push'], 'critical', { recipientRoles: ['finance_officer'], requiresAcknowledgement: true, escalationMinutes: 120, escalationRoles: ['director'], mandatory: true, cooldownHours: 24 }),
  'finance.month_end_action': POLICY(['in_app'], 'attention', { recipientRoles: ['finance_officer'] }),

  // ── HR ──────────────────────────────────────────────────────────────────
  'hr.leave.approval_required': POLICY(['in_app', 'push', 'email', 'sms'], 'attention', { recipientRoles: ['director'], requiresAcknowledgement: true, escalationMinutes: 240, mandatoryChannels: ['sms'] }),
  'hr.leave.submitted': POLICY(['in_app', 'email'], 'info'),
  'hr.leave.approved': POLICY(['in_app', 'email', 'sms'], 'success'),
  'hr.leave.rejected': POLICY(['in_app', 'email', 'sms'], 'warning'),
  'hr.leave.booked': POLICY(['in_app', 'email', 'sms'], 'attention'),
  'hr.leave.cancelled': POLICY(['in_app'], 'info'),
  'hr.salary_advance.approval_required': POLICY(['in_app', 'push', 'email', 'sms'], 'attention', { recipientRoles: ['director', 'finance_officer'], requiresAcknowledgement: true, escalationMinutes: 240, mandatoryChannels: ['sms'] }),
  'hr.salary_advance.approved': POLICY(['in_app', 'email', 'sms'], 'success'),
  'hr.salary_advance.rejected': POLICY(['in_app', 'email', 'sms'], 'warning'),
  'hr.salary_advance.disbursed': POLICY(['in_app', 'email', 'sms'], 'success'),
  'hr.payroll.approval_required': POLICY(['in_app', 'push', 'email', 'sms'], 'critical', { recipientRoles: ['director', 'finance_officer'], requiresAcknowledgement: true, escalationMinutes: 120, mandatory: true, mandatoryChannels: ['sms'] }),
  'hr.payroll.approved': POLICY(['in_app', 'push'], 'attention', { recipientRoles: ['finance_officer'] }),
  'hr.payslip.ready': POLICY(['in_app', 'push'], 'success'),
  'hr.salary.paid': POLICY(['in_app', 'push', 'sms'], 'success'),
  'hr.contract.expiring': POLICY(['in_app'], 'warning', { recipientRoles: ['admin_officer'], cooldownHours: 168 }),

  // ── Aftersales ──────────────────────────────────────────────────────────
  'aftersales.warranty.expiring': POLICY(['email', 'whatsapp', 'sms'], 'attention', { fallbackSms: true, cooldownHours: 168 }),

  // ── Directors ───────────────────────────────────────────────────────────
  // One brief each working morning: bills to pay, approvals waiting (leave,
  // advances, payroll, POs, stock checkouts), customers owing, stock out on
  // checkout, machines invoiced but not delivered (see director-brief.ts).
  'director.daily_brief': POLICY(['in_app', 'push', 'email'], 'attention', { recipientRoles: ['director'] }),

  // ── System ──────────────────────────────────────────────────────────────
  'system.escalation': POLICY(['in_app', 'push', 'email'], 'critical', { requiresAcknowledgement: true, mandatory: true }),
  'system.push_test': POLICY(['push'], 'info'),
  'system.manual_message': POLICY(['email'], 'info'),
  'system.sms_reply': POLICY(['sms'], 'info'),
  // A provider (email, SMS, WhatsApp) failing to deliver: one alert per channel per day.
  'system.integration_failure': POLICY(['in_app', 'push', 'email'], 'critical', { recipientRoles: ['director', 'admin_officer'], mandatory: true }),
}

export const defaultNotificationPolicy = (eventType: string): NotificationPolicy =>
  NOTIFICATION_POLICIES[eventType] || POLICY(['in_app'], 'info')

export function shouldBypassUserPreference(eventType: string, severity: NotificationSeverity): boolean {
  const policy = defaultNotificationPolicy(eventType)
  return Boolean(policy.mandatory || severity === 'critical')
}
