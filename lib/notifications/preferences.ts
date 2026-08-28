import 'server-only'

import prisma from '@/lib/prisma'
import { SEVERITY_RANK, shouldBypassUserPreference } from './registry'
import type { NotificationChannel, NotificationSeverity } from './types'

export type EffectiveNotificationPreference = {
  inAppEnabled: boolean
  pushEnabled: boolean
  emailEnabled: boolean
  whatsappEnabled: boolean
  smsEnabled: boolean
  soundEnabled: boolean
  digestEnabled: boolean
  quietStart: string | null
  quietEnd: string | null
  timezone: string
  minimumSeverity: NotificationSeverity
}

export const DEFAULT_NOTIFICATION_PREFERENCE: EffectiveNotificationPreference = {
  inAppEnabled: true,
  pushEnabled: true,
  emailEnabled: true,
  whatsappEnabled: false,
  smsEnabled: false,
  soundEnabled: true,
  digestEnabled: false,
  quietStart: null,
  quietEnd: null,
  timezone: 'Africa/Nairobi',
  minimumSeverity: 'info',
}

function normalize(row: any): EffectiveNotificationPreference {
  if (!row) return { ...DEFAULT_NOTIFICATION_PREFERENCE }
  const severity = String(row.minimumSeverity || 'info') as NotificationSeverity
  return {
    inAppEnabled: Boolean(row.inAppEnabled),
    pushEnabled: Boolean(row.pushEnabled),
    emailEnabled: Boolean(row.emailEnabled),
    whatsappEnabled: Boolean(row.whatsappEnabled),
    smsEnabled: Boolean(row.smsEnabled),
    soundEnabled: Boolean(row.soundEnabled),
    digestEnabled: Boolean(row.digestEnabled),
    quietStart: row.quietStart || null,
    quietEnd: row.quietEnd || null,
    timezone: row.timezone || 'Africa/Nairobi',
    minimumSeverity: severity in SEVERITY_RANK ? severity : 'info',
  }
}

export async function getEffectiveNotificationPreference(userId: string, eventType: string) {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId, eventType: { in: ['*', eventType] } },
  })
  const specific = rows.find(r => r.eventType === eventType)
  const wildcard = rows.find(r => r.eventType === '*')
  return normalize(specific || wildcard)
}

export function channelEnabled(pref: EffectiveNotificationPreference, channel: NotificationChannel) {
  if (channel === 'in_app') return pref.inAppEnabled
  if (channel === 'push') return pref.pushEnabled
  if (channel === 'email') return pref.emailEnabled
  if (channel === 'whatsapp') return pref.whatsappEnabled
  if (channel === 'sms') return pref.smsEnabled
  return false
}

export function severityAllowed(pref: EffectiveNotificationPreference, severity: NotificationSeverity) {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[pref.minimumSeverity]
}

function localMinutes(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date())
    const hour = Number(parts.find(p => p.type === 'hour')?.value || 0)
    const minute = Number(parts.find(p => p.type === 'minute')?.value || 0)
    return hour * 60 + minute
  } catch {
    const now = new Date()
    return now.getUTCHours() * 60 + now.getUTCMinutes()
  }
}

function hhmmMinutes(value: string | null): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null
  const [h, m] = value.split(':').map(Number)
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

export function isQuietNow(pref: EffectiveNotificationPreference): boolean {
  const start = hhmmMinutes(pref.quietStart)
  const end = hhmmMinutes(pref.quietEnd)
  if (start == null || end == null || start === end) return false
  const now = localMinutes(pref.timezone)
  if (start < end) return now >= start && now < end
  return now >= start || now < end
}

export function bypassPreference(eventType: string, severity: NotificationSeverity) {
  return shouldBypassUserPreference(eventType, severity)
}
