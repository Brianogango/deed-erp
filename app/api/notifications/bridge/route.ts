import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { publishNotificationEvent } from '@/lib/notifications/service'
import { runNotificationWorker } from '@/lib/notifications/worker'
import type { NotificationChannel } from '@/lib/notifications/types'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { recipients, type, title, body, module, path, entityKey, excludeUserId } =
      await request.json()

    if (!title || !body) {
      return NextResponse.json({ error: 'title and body required' }, { status: 400 })
    }

    const userIds = (recipients as unknown[]).filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    )
    if (!userIds.length) return NextResponse.json({ ok: true })

    const keyParts = String(entityKey || '').split(':')
    const entityType = keyParts[0] || type || null
    const entityId = keyParts.length >= 2 ? keyParts[1] : null
    const action = keyParts.length >= 3 ? keyParts.slice(2).join('_') : 'update'

    const actionUrl = module ? `/${module}${path || ''}` : path || null

    await publishNotificationEvent({
      eventType: `app.${entityType}.${action}`,
      entityType,
      entityId,
      actorUserId: excludeUserId || session.user.id,
      userIds,
      channels: ['in_app', 'push'] as NotificationChannel[],
      severity: 'info',
      title,
      body,
      actionUrl,
      idempotencyKey: entityKey || `bridge:${session.user.id}:${Date.now()}`,
      excludeActor: true,
    })

    await runNotificationWorker({ routeLimit: 10, deliveryLimit: 20, escalationLimit: 0 })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[notifications/bridge]', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
