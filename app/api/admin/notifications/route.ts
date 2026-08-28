import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'admin_officer', 'super_admin'])
    const sinceDays = Math.max(1, Math.min(Number(request.nextUrl.searchParams.get('days') || 7), 90))
    const since = new Date(Date.now() - sinceDays * 86400000)

    const [byStatus, byChannel, deadLetters, recentFailures, pendingOutbox, pendingDeliveries] = await Promise.all([
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
        include: { event: { select: { eventType: true, title: true, entityType: true, entityId: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      prisma.notificationOutbox.count({ where: { status: { in: ['queued', 'retrying', 'processing'] } } }),
      prisma.notificationDelivery.count({ where: { status: { in: ['queued', 'retrying', 'sending'] } } }),
    ])

    return NextResponse.json({
      since: since.toISOString(),
      byStatus: Object.fromEntries(byStatus.map(row => [row.status, row._count])),
      byChannel: Object.fromEntries(byChannel.map(row => [row.channel, row._count])),
      deadLetters,
      pendingOutbox,
      pendingDeliveries,
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
        data: { status: 'queued', nextAttemptAt: now, failedAt: null, lastError: null },
      }),
      prisma.notificationDeadLetter.updateMany({
        where: { deliveryId: body.deliveryId, resolvedAt: null },
        data: { resolvedAt: now, resolvedById: actor.id, resolutionNote: body.note || 'Manual retry' },
      }),
    ])
    return NextResponse.json({ ok: true })
  })
}
