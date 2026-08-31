import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { sendWebPush } from '@/lib/notifications/web-push'

export const dynamic = 'force-dynamic'

export async function POST() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return NextResponse.json(
        { error: 'Browser push is not configured on this server' },
        { status: 503 },
      )
    }

    const endpoints = await prisma.notificationEndpoint.findMany({
      where: { userId: session.user.id, kind: 'web_push', revokedAt: null },
    })
    if (endpoints.length === 0) {
      return NextResponse.json(
        { error: 'This browser is not subscribed to push notifications' },
        { status: 400 },
      )
    }

    const payload = {
      title: 'Deed ERP',
      body: 'Browser push is working on this device.',
      url: '/',
      eventType: 'system.push_test',
    }

    const results = []
    for (const row of endpoints) {
      if (!row.p256dh || !row.authSecret) {
        results.push({ id: row.id, ok: false, error: 'Incomplete subscription keys' })
        continue
      }
      const sent = await sendWebPush(
        { endpoint: row.endpoint, p256dh: row.p256dh, authSecret: row.authSecret },
        payload,
      )
      if (!sent.success && ['404', '410'].includes(String(sent.errorCode || ''))) {
        await prisma.notificationEndpoint.update({
          where: { id: row.id },
          data: { revokedAt: new Date() },
        }).catch(() => {})
      }
      results.push({
        id: row.id,
        ok: sent.success,
        error: sent.success ? null : sent.error,
      })
    }

    const sent = results.filter(row => row.ok).length
    if (sent === 0) {
      return NextResponse.json(
        { error: results[0]?.error || 'Push service rejected the test', sent: 0, results },
        { status: 502 },
      )
    }
    return NextResponse.json({ ok: true, sent, results })
  })
}
