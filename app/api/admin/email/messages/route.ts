import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { publishNotificationEvent } from '@/lib/notifications/service'
import { runNotificationWorker } from '@/lib/notifications/worker'
import {
  backfillRecentEmailConversations,
  markEmailThreadRead,
} from '@/lib/notifications/email-conversations'

export const dynamic = 'force-dynamic'

const allowedRoles = ['director', 'admin_officer', 'super_admin']

const asFolder = (value: string | null) =>
  ['all', 'inbox', 'sent', 'failed'].includes(String(value)) ? String(value) : 'all'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(allowedRoles)
    await backfillRecentEmailConversations(250).catch(error => {
      console.error('[email messages] backfill failed', error)
    })

    const folder = asFolder(request.nextUrl.searchParams.get('folder'))
    const query = String(request.nextUrl.searchParams.get('q') || '').trim()
    const threadId = String(request.nextUrl.searchParams.get('threadId') || '').trim()
    const mailbox = String(request.nextUrl.searchParams.get('mailbox') || '').trim()

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
            { participantEmail: { contains: query, mode: 'insensitive' as const } },
            { participantName: { contains: query, mode: 'insensitive' as const } },
            { subject: { contains: query, mode: 'insensitive' as const } },
            { entityId: { contains: query, mode: 'insensitive' as const } },
          ],
        }
      : {}

    const where: any = {
      channel: 'email',
      ...(mailbox ? { mailbox } : {}),
      ...relationFilter,
      ...searchFilter,
    }

    const [threads, unreadTotal, selected] = await Promise.all([
      prisma.communicationThread.findMany({
        where,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              direction: true,
              subject: true,
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
        where: { channel: 'email', ...(mailbox ? { mailbox } : {}) },
        _sum: { unreadCount: true },
      }),
      threadId
        ? prisma.communicationThread.findFirst({
            where: { id: threadId, channel: 'email' },
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
      mailbox: mailbox || 'all',
      unreadTotal: unreadTotal._sum.unreadCount || 0,
      threads: threads.map(thread => ({
        id: thread.id,
        participantEmail: thread.participantEmail,
        participantName: thread.participantName,
        mailbox: thread.mailbox,
        subject: thread.subject,
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
            participantEmail: selected.participantEmail,
            participantName: selected.participantName,
            mailbox: selected.mailbox,
            subject: selected.subject,
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
      subject?: string
    }
    const threadId = String(body.threadId || '').trim()
    if (!threadId) return NextResponse.json({ error: 'threadId is required' }, { status: 400 })

    const thread = await prisma.communicationThread.findFirst({
      where: { id: threadId, channel: 'email' },
    })
    if (!thread) return NextResponse.json({ error: 'Email conversation not found' }, { status: 404 })

    if (body.action === 'mark_read') {
      await markEmailThreadRead(thread.id)
      return NextResponse.json({ ok: true })
    }

    if (body.action !== 'reply') {
      return NextResponse.json({ error: 'Invalid email action' }, { status: 400 })
    }

    if (!thread.participantEmail) {
      return NextResponse.json({ error: 'Conversation has no recipient email address' }, { status: 409 })
    }

    const message = String(body.message || '').normalize('NFKC').trim().slice(0, 20_000)
    if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

    const baseSubject = String(body.subject || thread.subject || 'Message from Deed Technologies').trim().slice(0, 480)
    const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`
    const mailbox = String(thread.mailbox || 'default').trim()

    const event = await publishNotificationEvent({
      eventType: 'system.email_reply',
      entityType: thread.entityType || 'email_thread',
      entityId: thread.entityId || thread.id,
      actorUserId: actor.id,
      externalRecipients: [{
        name: thread.participantName,
        email: thread.participantEmail,
        channels: ['email'],
      }],
      channels: ['email'],
      severity: 'info',
      title: subject,
      body: message,
      metadata: {
        emailSubject: subject,
        emailText: message,
        emailTriggered: true,
        communicationThreadId: thread.id,
        mailbox,
        createdByUserId: actor.id,
      },
      idempotencyKey: `email-reply:${thread.id}:${crypto.randomUUID()}`,
    })

    await runNotificationWorker({ routeLimit: 20, deliveryLimit: 20, escalationLimit: 1 })
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { eventId: event.id, channel: 'email' },
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
