import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

const iconForSeverity = (severity: string) =>
  severity === 'critical' ? '🚨'
    : severity === 'warning' ? '⚠️'
    : severity === 'success' ? '✅'
    : severity === 'attention' ? '🔔'
    : 'ℹ️'

function legacyTypeForEvent(eventType: string) {
  const root = eventType.split('.')[0]
  if (root === 'hr') return 'leave'
  if (root === 'repair') return 'repair'
  if (root === 'finance' || root === 'purchase') return 'expense'
  if (root === 'inventory' || root === 'aftersales') return 'asset'
  if (root === 'system') return 'system'
  return 'assignment'
}

function moduleForEvent(eventType: string): string | undefined {
  const root = eventType.split('.')[0]
  const map: Record<string, string> = {
    sales: 'sales',
    crm: 'crm',
    repair: 'repair',
    purchase: 'purchase',
    inventory: 'inventory',
    delivery: 'delivery',
    finance: 'accounting',
    hr: 'hr',
    aftersales: 'after_sales',
    system: 'dashboard',
  }
  return map[root]
}

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const limit = Math.max(1, Math.min(Number(request.nextUrl.searchParams.get('limit') || 100), 200))
    const filter = request.nextUrl.searchParams.get('filter') || 'all'
    const before = request.nextUrl.searchParams.get('before')
    const beforeDate = before ? new Date(before) : null

    const where: any = {
      userId: session.user.id,
      dismissedAt: null,
      ...(filter === 'unread' ? { readAt: null } : {}),
      ...(beforeDate && !Number.isNaN(beforeDate.getTime()) ? { createdAt: { lt: beforeDate } } : {}),
    }

    const [rows, unread] = await Promise.all([
      prisma.notificationRecipient.findMany({
        where,
        include: { event: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      prisma.notificationRecipient.count({
        where: { userId: session.user.id, dismissedAt: null, readAt: null },
      }),
    ])

    const notifications = rows.map(row => ({
      id: row.id,
      eventId: row.eventId,
      userId: row.userId,
      type: legacyTypeForEvent(row.event.eventType),
      eventType: row.event.eventType,
      title: row.event.title,
      body: row.event.body,
      module: moduleForEvent(row.event.eventType),
      path: row.event.actionUrl || undefined,
      read: Boolean(row.readAt),
      readAt: row.readAt?.toISOString() || null,
      acknowledgedAt: row.acknowledgedAt?.toISOString() || null,
      resolvedAt: row.resolvedAt?.toISOString() || row.event.resolvedAt?.toISOString() || null,
      createdAt: row.event.createdAt.toISOString(),
      icon: iconForSeverity(row.event.severity),
      severity: row.event.severity,
      priority: row.event.priority,
      requiresAcknowledgement: row.event.requiresAcknowledgement,
      entityKey: row.event.idempotencyKey,
    }))

    return NextResponse.json({
      notifications,
      unread,
      nextCursor: rows.length === limit ? rows[rows.length - 1].createdAt.toISOString() : null,
    })
  })
}

export async function PATCH(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json().catch(() => ({})) as { action?: string; id?: string }
    const now = new Date()

    if (body.action === 'read') {
      if (!body.id) return NextResponse.json({ error: 'Notification id is required' }, { status: 400 })
      await prisma.notificationRecipient.updateMany({
        where: { id: body.id, userId: session.user.id, readAt: null },
        data: { readAt: now },
      })
    } else if (body.action === 'read_all') {
      await prisma.notificationRecipient.updateMany({
        where: { userId: session.user.id, dismissedAt: null, readAt: null },
        data: { readAt: now },
      })
    } else if (body.action === 'dismiss') {
      if (!body.id) return NextResponse.json({ error: 'Notification id is required' }, { status: 400 })
      await prisma.notificationRecipient.updateMany({
        where: { id: body.id, userId: session.user.id },
        data: { dismissedAt: now, readAt: now },
      })
    } else if (body.action === 'clear_read') {
      await prisma.notificationRecipient.updateMany({
        where: { userId: session.user.id, readAt: { not: null }, dismissedAt: null },
        data: { dismissedAt: now },
      })
    } else if (body.action === 'acknowledge') {
      if (!body.id) return NextResponse.json({ error: 'Notification id is required' }, { status: 400 })
      await prisma.notificationRecipient.updateMany({
        where: { id: body.id, userId: session.user.id },
        data: { acknowledgedAt: now, acknowledgedBy: session.user.id, readAt: now },
      })
    } else {
      return NextResponse.json({ error: 'Invalid notification action' }, { status: 400 })
    }

    const unread = await prisma.notificationRecipient.count({
      where: { userId: session.user.id, dismissedAt: null, readAt: null },
    })
    return NextResponse.json({ ok: true, unread })
  })
}
