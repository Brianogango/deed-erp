import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import prisma from '@/lib/prisma'
import { publishNotificationEvent } from '@/lib/notifications/service'
import { runNotificationWorker } from '@/lib/notifications/worker'
import type { NotificationChannel } from '@/lib/notifications/types'
import { bridgeEventType } from '@/lib/notifications/bridge-event-type'
import { resolveRoleRecipients } from '@/lib/notifications/recipient-roles'

export const dynamic = 'force-dynamic'

const MAX_RECIPIENTS = 50


export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { recipients, recipientRoles, type, title, body, module, path, entityKey, excludeUserId } =
      await request.json()

    if (!title || !body) {
      return NextResponse.json({ error: 'title and body required' }, { status: 400 })
    }

    const explicitIds = (Array.isArray(recipients) ? recipients as unknown[] : [])
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    // Roles are resolved here, not in the browser: most roles cannot load the
    // user list, so a role-addressed notification from them came out empty.
    const roleIds = Array.isArray(recipientRoles) && recipientRoles.length > 0
      ? resolveRoleRecipients(
          await prisma.user.findMany({ where: { isActive: true }, select: { id: true, role: true, isActive: true } }),
          recipientRoles,
          { excludeUserId: excludeUserId ?? session.user.id, limit: MAX_RECIPIENTS },
        )
      : []
    const rawIds = Array.from(new Set([...explicitIds, ...roleIds])).slice(0, MAX_RECIPIENTS)
    if (!rawIds.length) return NextResponse.json({ ok: true })

    const validUsers = await prisma.user.findMany({
      where: { id: { in: rawIds }, isActive: true },
      select: { id: true },
    })
    const userIds = validUsers.map(u => u.id)
    if (!userIds.length) return NextResponse.json({ ok: true })

    const keyParts = String(entityKey || '').split(':')
    const entityType = keyParts[0] || type || null
    const entityId = keyParts.length >= 2 ? keyParts[1] : null
    const action = keyParts.length >= 3 ? keyParts.slice(2).join('_') : 'update'

    const actionUrl = module ? `/${module}${path || ''}` : path || null

    await publishNotificationEvent({
      eventType: bridgeEventType(entityType, action),
      entityType,
      entityId,
      actorUserId: session.user.id,
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
