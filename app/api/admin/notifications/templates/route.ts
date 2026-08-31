import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

const CHANNELS = new Set(['in_app', 'push', 'email', 'whatsapp', 'sms'])

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'admin_officer', 'super_admin'])
    const rows = await prisma.notificationTemplate.findMany({
      orderBy: [{ eventType: 'asc' }, { channel: 'asc' }, { version: 'desc' }],
    })

    const latest = new Map<string, typeof rows[number]>()
    for (const row of rows) {
      const key = `${row.eventType}::${row.channel}`
      if (!latest.has(key)) latest.set(key, row)
    }

    return NextResponse.json({
      templates: Array.from(latest.values()),
      versions: rows.length,
    })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'admin_officer', 'super_admin'])
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const eventType = String(body.eventType || '').trim().slice(0, 120)
    const channel = String(body.channel || '').trim()
    const subjectTemplate = body.subjectTemplate == null ? null : String(body.subjectTemplate).slice(0, 5000)
    const bodyTemplate = String(body.bodyTemplate || '').trim().slice(0, 20000)

    if (!eventType || !CHANNELS.has(channel) || !bodyTemplate) {
      return NextResponse.json({ error: 'Event type, supported channel, and message body are required.' }, { status: 400 })
    }

    const latest = await prisma.notificationTemplate.findFirst({
      where: { eventType, channel },
      orderBy: { version: 'desc' },
    })
    const version = (latest?.version || 0) + 1

    const [, template] = await prisma.$transaction([
      prisma.notificationTemplate.updateMany({
        where: { eventType, channel, isActive: true },
        data: { isActive: false },
      }),
      prisma.notificationTemplate.create({
        data: {
          eventType,
          channel,
          version,
          subjectTemplate,
          bodyTemplate,
          isActive: body.isActive !== false,
        },
      }),
    ])

    return NextResponse.json({ template }, { status: 201 })
  })
}
