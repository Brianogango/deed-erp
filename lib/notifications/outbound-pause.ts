import type { NotificationChannel } from './types'

type NotificationPauseEnv = Pick<NodeJS.ProcessEnv, 'NOTIFICATIONS_PAUSE_EMAIL_SMS'>

/**
 * Temporary operator pause for notification-worker email and SMS.
 *
 * Default is paused so a cron restart cannot dump another backlog.
 * Resume by setting NOTIFICATIONS_PAUSE_EMAIL_SMS=false and restarting the app.
 */
export function isEmailSmsPaused(env: NotificationPauseEnv = process.env): boolean {
  const raw = String(env.NOTIFICATIONS_PAUSE_EMAIL_SMS ?? 'true').trim().toLowerCase()
  return !['0', 'false', 'no', 'off'].includes(raw)
}

export function isPausedOutboundChannel(
  channel: NotificationChannel | string,
  env: NotificationPauseEnv = process.env,
): boolean {
  if (channel !== 'email' && channel !== 'sms') return false
  return isEmailSmsPaused(env)
}
