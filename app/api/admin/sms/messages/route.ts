import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { publishNotificationEvent } from '@/lib/notifications/service'
import { runNotificationWorker } from '@/lib/notifications/worker'
import { backfillRecentSmsConversations, markSmsThreadRead } from '@/lib/notifications/sms-conversations'

export const dynamic = 'force-dynamic'

const allowedRoles = ['director', 'admin_officer', 'super_admin']

const asFolder = (value: string | null) =>
  ['all', 'inbox', 'sent', 'failed'].includes(String(value)) ? String(value) : 'all'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(allowedRoles)
    await backfillRecentSmsConversations(250).catch(error => {
      console.error('[sms messages] backfill failed', error)
    })

    const folder = asFolder(request.nextUrl.searchParams.get('folder'))
    const query = String(request.nextUrl.searchParams.get('q') || '').trim()
    const threadId = String(request.nextUrl.searchParams.get('threadId') || '').trim()

    const relationFilter: any =
      folder === 'inbox'
        ? { messages: { some: { direction: 'inbound' } } }
        : folder === 'sent'
          ? { messages: { some: { direction: 'outbound' } } }
          : folder === 'failed'
            ? { messages: { some: { direction: 'outbound', status: { in: ['failed', 'dead_letter', 'retrying'] } } } }
            : {}

    const searchFilter: any = query
      ? {
          OR: [
            { participantPhone: { contains: query, mode: 'insensitive' as const } },
            { participantName: { contains: query, mode: 'insensitive' as const } },
            { entityId: { contains: query, mode: 'insensitive' as const } },
          ],
        }
      : {}

    const [threads, unreadTotal, selected] = await Promise.all([
      prisma.communicationThread.findMany({
        where: {
          channel: 'sms',
          ...relationFilter,
          ...searchFilter,
        },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              direction: true,
              body: true,
              status: true,
              createdAt: true,
              receivedAt: true,
              sentAt: true,
            },
          },
          _count: { select: { messages: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 100,
      }),
      prisma.communicationThread.aggregate({
        where: { channel: 'sms' },
        _sum: { unreadCount: true },
      }),
      threadId
        ? prisma.communicationThread.findFirst({
            where: { id: threadId, channel: 'sms' },
            include: {
              messages: {
                orderBy: { createdAt: 'asc' },
                take: 200,
              },
            },
          })
        : Promise.resolve(null),
    ])

    return NextResponse.json({
      folder,
      unreadTotal: unreadTotal._sum.unreadCount || 0,
      threads: threads.map(thread => ({
        id: thread.id,
        participantPhone: thread.participantPhone,
        participantName: thread.participantName,
        entityType: thread.entityType,
        entityId: thread.entityId,
        status: thread.status,
        unreadCount: thread.unreadCount,
        lastMessageAt: thread.lastMessageAt,
        messageCount: thread._count.messages,
        latest: thread.messages[0] || null,
      })),
      selected: selected
        ? {
            id: selected.id,
            participantPhone: selected.participantPhone,
            participantName: selected.participantName,
            entityType: selected.entityType,
            entityId: selected.entityId,
            status: selected.status,
            unreadCount: selected.unreadCount,
            lastMessageAt: selected.lastMessageAt,
            messages: selected.messages,
          }
        : null,
    })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(allowedRoles)
    const body = await request.json().catch(() => ({})) as {
      action?: string
      threadId?: string
      message?: string
    }
    const threadId = String(body.threadId || '').trim()
    if (!threadId) return NextResponse.json({ error: 'threadId is required' }, { status: 400 })

    const thread = await prisma.communicationThread.findFirst({
      where: { id: threadId, channel: 'sms' },
    })
    if (!thread) return NextResponse.json({ error: 'SMS conversation not found' }, { status: 404 })

    if (body.action === 'mark_read') {
      await markSmsThreadRead(thread.id)
      return NextResponse.json({ ok: true })
    }

    if (body.action !== 'reply') {
      return NextResponse.json({ error: 'Invalid SMS action' }, { status: 400 })
    }

    if (thread.status === 'opted_out') {
      return NextResponse.json({
        error: 'This number has opted out of SMS. Re-open only after the recipient gives consent.',
      }, { status: 409 })
    }

    const message = String(body.message || '').normalize('NFKC').trim().slice(0, 480)
    if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

    const event = await publishNotificationEvent({
      eventType: 'system.sms_reply',
      entityType: thread.entityType || 'sms_thread',
      entityId: thread.entityId || thread.id,
      actorUserId: actor.id,
      externalRecipients: [{
        name: thread.participantName,
        phone: thread.participantPhone,
        channels: ['sms'],
      }],
      channels: ['sms'],
      severity: 'info',
      title: thread.entityId ? `SMS reply — ${thread.entityId}` : 'SMS reply',
      body: message,
      metadata: {
        smsText: message,
        communicationThreadId: thread.id,
        createdByUserId: actor.id,
      },
      idempotencyKey: `sms-reply:${thread.id}:${crypto.randomUUID()}`,
    })

    await runNotificationWorker({ routeLimit: 20, deliveryLimit: 20, escalationLimit: 1 })
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { eventId: event.id, channel: 'sms' },
      select: {
        id: true,
        status: true,
        provider: true,
        providerMessageId: true,
        lastError: true,
      },
    })

    return NextResponse.json({ ok: true, eventId: event.id, deliveries })
  })
}
