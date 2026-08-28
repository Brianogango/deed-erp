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

    const data = {
      inAppEnabled: body.inAppEnabled !== false,
      pushEnabled: body.pushEnabled !== false,
      emailEnabled: body.emailEnabled !== false,
      whatsappEnabled: Boolean(body.whatsappEnabled),
      smsEnabled: Boolean(body.smsEnabled),
      soundEnabled: body.soundEnabled !== false,
      digestEnabled: Boolean(body.digestEnabled),
      quietStart: hhmm(body.quietStart),
      quietEnd: hhmm(body.quietEnd),
      timezone,
      minimumSeverity: severity,
    }

    const row = await prisma.notificationPreference.upsert({
      where: { userId_eventType: { userId: session.user.id, eventType } },
      create: { userId: session.user.id, eventType, ...data },
      update: data,
    })
    return NextResponse.json({ preference: row })
  })
}
