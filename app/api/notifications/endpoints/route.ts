import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const endpoints = await prisma.notificationEndpoint.findMany({
      where: { userId: session.user.id, revokedAt: null },
      select: { id: true, kind: true, deviceLabel: true, lastSeenAt: true, createdAt: true },
      orderBy: { lastSeenAt: 'desc' },
    })
    return NextResponse.json({
      endpoints,
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
      pushConfigured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json().catch(() => ({})) as any
    const endpoint = String(body.endpoint || '').trim()
    const p256dh = String(body.keys?.p256dh || body.p256dh || '').trim()
    const authSecret = String(body.keys?.auth || body.authSecret || '').trim()
    if (!endpoint.startsWith('https://') || !p256dh || !authSecret) {
      return NextResponse.json({ error: 'Valid Web Push subscription is required' }, { status: 400 })
    }

    const existing = await prisma.notificationEndpoint.findFirst({
      where: { userId: session.user.id, endpoint },
    })
    const row = existing
      ? await prisma.notificationEndpoint.update({
          where: { id: existing.id },
          data: {
            p256dh,
            authSecret,
            deviceLabel: String(body.deviceLabel || '').slice(0, 120) || null,
            userAgent: request.headers.get('user-agent'),
            revokedAt: null,
            lastSeenAt: new Date(),
          },
        })
      : await prisma.notificationEndpoint.create({
          data: {
            userId: session.user.id,
            kind: 'web_push',
            endpoint,
            p256dh,
            authSecret,
            deviceLabel: String(body.deviceLabel || '').slice(0, 120) || null,
            userAgent: request.headers.get('user-agent'),
          },
        })

    return NextResponse.json({ endpoint: { id: row.id, kind: row.kind, deviceLabel: row.deviceLabel } })
  })
}

export async function DELETE(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json().catch(() => ({})) as { id?: string; endpoint?: string }
    const where = body.id
      ? { id: body.id, userId: session.user.id }
      : { endpoint: body.endpoint || '', userId: session.user.id }
    await prisma.notificationEndpoint.updateMany({
      where,
      data: { revokedAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  })
}
