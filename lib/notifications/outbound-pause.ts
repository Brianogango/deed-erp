import type { NotificationChannel } from './types'

type NotificationPauseEnv =
  | NodeJS.ProcessEnv
  | {
      NOTIFICATIONS_PAUSE_EMAIL_SMS?: string
      NOTIFICATIONS_PAUSE_EMAIL?: string
      NOTIFICATIONS_PAUSE_SMS?: string
      NOTIFICATIONS_PAUSE_OVERDUE_INVOICES?: string
    }

const isOn = (raw: string | undefined) => !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase())

/**
 * Operator pause for notification-worker email and SMS.
 *
 * Each channel has its own switch — NOTIFICATIONS_PAUSE_EMAIL and
 * NOTIFICATIONS_PAUSE_SMS — so email can go out while SMS waits for a
 * reliable provider. A channel without its own switch follows the combined
 * NOTIFICATIONS_PAUSE_EMAIL_SMS, which defaults to paused so a cron restart
 * cannot dump a backlog. Resume a channel by setting its switch to false and
 * restarting the app (pm2 restart deed-erp --update-env).
 */
function channelPaused(own: string | undefined, env: NotificationPauseEnv): boolean {
  if (own !== undefined && String(own).trim() !== '') return isOn(own)
  return isOn(env.NOTIFICATIONS_PAUSE_EMAIL_SMS ?? 'true')
}

export function isEmailPaused(env: NotificationPauseEnv = process.env): boolean {
  return channelPaused(env.NOTIFICATIONS_PAUSE_EMAIL, env)
}

export function isSmsPaused(env: NotificationPauseEnv = process.env): boolean {
  return channelPaused(env.NOTIFICATIONS_PAUSE_SMS, env)
}

/** True when both email and SMS are paused (the old single switch). */
export function isEmailSmsPaused(env: NotificationPauseEnv = process.env): boolean {
  return isEmailPaused(env) && isSmsPaused(env)
}

export function isPausedOutboundChannel(
  channel: NotificationChannel | string,
  env: NotificationPauseEnv = process.env,
): boolean {
  if (channel === 'email') return isEmailPaused(env)
  if (channel === 'sms') return isSmsPaused(env)
  return false
}

/** Events that are never emailed, whatever the policy or a queued row says. */
const NEVER_EMAIL_EVENT_TYPES = new Set(['inventory.low_stock'])

/**
 * Overdue customer invoices stay out of email (the director brief's
 * "Customers owing past due date" section) until finance has reconciled
 * receipts, because some listed invoices may already be paid. Defaults to
 * paused; resume with NOTIFICATIONS_PAUSE_OVERDUE_INVOICES=false and
 * pm2 restart deed-erp --update-env. The in-app finance list keeps running
 * so finance can work through the reconciliation.
 */
export function isOverdueInvoiceEmailPaused(env: NotificationPauseEnv = process.env): boolean {
  return isOn(env.NOTIFICATIONS_PAUSE_OVERDUE_INVOICES ?? 'true')
}

/** True when this event must not go out on this channel. */
export function isBlockedEventChannel(
  eventType: string,
  channel: NotificationChannel | string,
  env: NotificationPauseEnv = process.env,
): boolean {
  if (channel !== 'email') return false
  if (NEVER_EMAIL_EVENT_TYPES.has(eventType)) return true
  if (eventType === 'finance.invoice_overdue') return isOverdueInvoiceEmailPaused(env)
  return false
}
