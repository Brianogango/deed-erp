import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'admin_officer', 'super_admin'])
    const sinceDays = Math.max(1, Math.min(Number(request.nextUrl.searchParams.get('days') || 7), 90))
    const since = new Date(Date.now() - sinceDays * 86400000)

    const [
      byStatus,
      byChannel,
      deadLetters,
      recentFailures,
      recentDeliveries,
      pendingOutbox,
      pendingDeliveries,
      topEvents,
      activeTemplates,
    ] = await Promise.all([
      prisma.notificationDelivery.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: true,
      }),
      prisma.notificationDelivery.groupBy({
        by: ['channel'],
        where: { createdAt: { gte: since } },
        _count: true,
      }),
      prisma.notificationDeadLetter.count({ where: { resolvedAt: null } }),
      prisma.notificationDelivery.findMany({
        where: { status: { in: ['failed', 'dead_letter', 'retrying'] } },
        include: {
          event: {
            select: {
              eventType: true,
              title: true,
              entityType: true,
              entityId: true,
              severity: true,
              createdAt: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      prisma.notificationDelivery.findMany({
        where: { createdAt: { gte: since } },
        include: {
          event: {
            select: {
              eventType: true,
              title: true,
              body: true,
              entityType: true,
              entityId: true,
              severity: true,
              createdAt: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 80,
      }),
      prisma.notificationOutbox.count({ where: { status: { in: ['queued', 'retrying', 'processing'] } } }),
      prisma.notificationDelivery.count({ where: { status: { in: ['queued', 'retrying', 'sending'] } } }),
      prisma.notificationEvent.groupBy({
        by: ['eventType'],
        where: { createdAt: { gte: since } },
        _count: true,
        orderBy: { _count: { eventType: 'desc' } },
        take: 8,
      }),
      prisma.notificationTemplate.count({ where: { isActive: true } }),
    ])

    return NextResponse.json({
      since: since.toISOString(),
      byStatus: Object.fromEntries(byStatus.map(row => [row.status, row._count])),
      byChannel: Object.fromEntries(byChannel.map(row => [row.channel, row._count])),
      deadLetters,
      pendingOutbox,
      pendingDeliveries,
      activeTemplates,
      topEvents: topEvents.map(row => ({ eventType: row.eventType, count: row._count })),
      recentDeliveries: recentDeliveries.map(row => ({
        id: row.id,
        eventType: row.event.eventType,
        title: row.event.title,
        body: row.event.body,
        entityType: row.event.entityType,
        entityId: row.event.entityId,
        severity: row.event.severity,
        channel: row.channel,
        destination: row.destination,
        provider: row.provider,
        status: row.status,
        attempts: row.attemptCount,
        error: row.lastError,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        sentAt: row.sentAt,
        deliveredAt: row.deliveredAt,
        readAt: row.readAt,
      })),
      recentFailures: recentFailures.map(row => ({
        id: row.id,
        eventType: row.event.eventType,
        title: row.event.title,
        channel: row.channel,
        provider: row.provider,
        status: row.status,
        attempts: row.attemptCount,
        error: row.lastError,
        updatedAt: row.updatedAt,
        entityType: row.event.entityType,
        entityId: row.event.entityId,
        severity: row.event.severity,
        eventCreatedAt: row.event.createdAt,
      })),
    })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'admin_officer', 'super_admin'])
    const body = await request.json().catch(() => ({})) as { action?: string; deliveryId?: string; note?: string }
    if (body.action !== 'retry_dead_letter' || !body.deliveryId) {
      return NextResponse.json({ error: 'Invalid admin notification action' }, { status: 400 })
    }
    const now = new Date()
    await prisma.$transaction([
      prisma.notificationDelivery.update({
        where: { id: body.deliveryId },
        data: { status: 'queued', nextAttemptAt: now, attemptCount: 0, failedAt: null, lastError: null },
      }),
      prisma.notificationDeadLetter.updateMany({
        where: { deliveryId: body.deliveryId, resolvedAt: null },
        data: { resolvedAt: now, resolvedById: actor.id, resolutionNote: body.note || 'Manual retry' },
      }),
    ])
    return NextResponse.json({ ok: true })
  })
}
