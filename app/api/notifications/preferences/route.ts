import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { DEFAULT_NOTIFICATION_PREFERENCE } from '@/lib/notifications/preferences'

export const dynamic = 'force-dynamic'

const hhmm = (value: unknown) => {
  const text = String(value || '').trim()
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null
}

export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const rows = await prisma.notificationPreference.findMany({
      where: { userId: session.user.id },
      orderBy: { eventType: 'asc' },
    })
    const global = rows.find(row => row.eventType === '*')
    return NextResponse.json({
      global: global || { eventType: '*', ...DEFAULT_NOTIFICATION_PREFERENCE },
      overrides: rows.filter(row => row.eventType !== '*'),
    })
  })
}

export async function PUT(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const eventType = String(body.eventType || '*').trim().slice(0, 120) || '*'
    const severity = ['info', 'success', 'attention', 'warning', 'critical'].includes(String(body.minimumSeverity))
      ? String(body.minimumSeverity)
      : 'info'
    const timezone = String(body.timezone || 'Africa/Nairobi').slice(0, 80)

    const existing = await prisma.notificationPreference.findUnique({
      where: { userId_eventType: { userId: session.user.id, eventType } },
    })
    const base = existing || {
      inAppEnabled: DEFAULT_NOTIFICATION_PREFERENCE.inAppEnabled,
      pushEnabled: DEFAULT_NOTIFICATION_PREFERENCE.pushEnabled,
      emailEnabled: DEFAULT_NOTIFICATION_PREFERENCE.emailEnabled,
      whatsappEnabled: DEFAULT_NOTIFICATION_PREFERENCE.whatsappEnabled,
      smsEnabled: DEFAULT_NOTIFICATION_PREFERENCE.smsEnabled,
      soundEnabled: DEFAULT_NOTIFICATION_PREFERENCE.soundEnabled,
      digestEnabled: DEFAULT_NOTIFICATION_PREFERENCE.digestEnabled,
      quietStart: DEFAULT_NOTIFICATION_PREFERENCE.quietStart,
      quietEnd: DEFAULT_NOTIFICATION_PREFERENCE.quietEnd,
      timezone: DEFAULT_NOTIFICATION_PREFERENCE.timezone,
      minimumSeverity: DEFAULT_NOTIFICATION_PREFERENCE.minimumSeverity,
    }

    const data = {
      inAppEnabled: typeof body.inAppEnabled === 'boolean' ? body.inAppEnabled : base.inAppEnabled,
      pushEnabled: typeof body.pushEnabled === 'boolean' ? body.pushEnabled : base.pushEnabled,
      emailEnabled: typeof body.emailEnabled === 'boolean' ? body.emailEnabled : base.emailEnabled,
      whatsappEnabled: typeof body.whatsappEnabled === 'boolean' ? body.whatsappEnabled : base.whatsappEnabled,
      smsEnabled: typeof body.smsEnabled === 'boolean' ? body.smsEnabled : base.smsEnabled,
      soundEnabled: typeof body.soundEnabled === 'boolean' ? body.soundEnabled : base.soundEnabled,
      digestEnabled: typeof body.digestEnabled === 'boolean' ? body.digestEnabled : base.digestEnabled,
      quietStart: 'quietStart' in body ? hhmm(body.quietStart) : base.quietStart,
      quietEnd: 'quietEnd' in body ? hhmm(body.quietEnd) : base.quietEnd,
      timezone: 'timezone' in body ? timezone : base.timezone,
      minimumSeverity: 'minimumSeverity' in body ? severity : base.minimumSeverity,
    }

    const row = await prisma.notificationPreference.upsert({
      where: { userId_eventType: { userId: session.user.id, eventType } },
      create: { userId: session.user.id, eventType, ...data },
      update: data,
    })
    return NextResponse.json({ preference: row })
  })
}
