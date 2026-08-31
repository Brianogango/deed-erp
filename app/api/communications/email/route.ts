import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { publishNotificationEvent } from '@/lib/notifications/service'
import { runNotificationWorker } from '@/lib/notifications/worker'
import { markEmailThreadRead } from '@/lib/notifications/email-conversations'

export const dynamic = 'force-dynamic'

type SessionLike = Awaited<ReturnType<typeof getRequiredSession>>

const moduleForEntity = (entityType: string) => {
  if (entityType === 'repair') return 'repair'
  if (['invoice', 'bill', 'payment'].includes(entityType)) return 'accounting'
  if (entityType === 'quote') return 'sales'
  if (entityType === 'lead') return 'crm'
  if (['purchase_order', 'rfq'].includes(entityType)) return 'purchase'
  if (['leave_request', 'salary_advance', 'payslip'].includes(entityType)) return 'hr'
  return null
}

async function assertEntityEmailAccess(
  session: SessionLike,
  entityType: string,
  entityId: string,
) {
  const role = String(session.user.role || '')
  const privileged = ['director', 'admin_officer', 'super_admin'].includes(role)
  const requiredModule = moduleForEntity(entityType)
  const modules = Array.isArray(session.user.modules) ? session.user.modules.map(String) : []

  if (!privileged && requiredModule && !modules.includes(requiredModule)) {
    throw Object.assign(new Error('Forbidden — no access to this communication record'), { status: 403 })
  }

  if (entityType === 'repair' && role === 'technician') {
    const repair = await prisma.repair.findUnique({
      where: { id: entityId },
      select: { assignedToId: true },
    })
    if (!repair || repair.assignedToId !== session.user.id) {
      throw Object.assign(new Error('Forbidden — repair is not assigned to you'), { status: 403 })
    }
  }

  if (['leave_request', 'salary_advance', 'payslip'].includes(entityType)
      && !['director', 'admin_officer', 'finance_officer', 'super_admin'].includes(role)) {
    throw Object.assign(new Error('Forbidden — HR communication is restricted'), { status: 403 })
  }
}

async function loadThreads(entityType: string, entityId: string) {
  return prisma.communicationThread.findMany({
    where: {
      channel: 'email',
      entityType,
      entityId,
    },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 200,
      },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 20,
  })
}

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const entityType = String(request.nextUrl.searchParams.get('entityType') || '').trim()
    const entityId = String(request.nextUrl.searchParams.get('entityId') || '').trim()
    if (!entityType || !entityId) {
      return NextResponse.json({ error: 'entityType and entityId are required' }, { status: 400 })
    }

    await assertEntityEmailAccess(session, entityType, entityId)
    const threads = await loadThreads(entityType, entityId)

    return NextResponse.json({
      threads: threads.map(thread => ({
        id: thread.id,
        participantEmail: thread.participantEmail,
        participantName: thread.participantName,
        mailbox: thread.mailbox,
        subject: thread.subject,
        unreadCount: thread.unreadCount,
        lastMessageAt: thread.lastMessageAt,
        messages: thread.messages,
      })),
    })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json().catch(() => ({})) as {
      action?: string
      entityType?: string
      entityId?: string
      threadId?: string
      message?: string
    }

    const entityType = String(body.entityType || '').trim()
    const entityId = String(body.entityId || '').trim()
    const threadId = String(body.threadId || '').trim()
    if (!entityType || !entityId || !threadId) {
      return NextResponse.json({ error: 'entityType, entityId and threadId are required' }, { status: 400 })
    }

    await assertEntityEmailAccess(session, entityType, entityId)

    const thread = await prisma.communicationThread.findFirst({
      where: {
        id: threadId,
        channel: 'email',
        entityType,
        entityId,
      },
    })
    if (!thread) return NextResponse.json({ error: 'Email conversation not found' }, { status: 404 })

    if (body.action === 'mark_read') {
      await markEmailThreadRead(thread.id)
      return NextResponse.json({ ok: true })
    }

    if (body.action !== 'reply') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    if (!thread.participantEmail) {
      return NextResponse.json({ error: 'Conversation has no recipient email address' }, { status: 409 })
    }

    const message = String(body.message || '').normalize('NFKC').trim().slice(0, 20_000)
    if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

    const baseSubject = String(thread.subject || 'Message from Deed Technologies').trim().slice(0, 480)
    const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`

    const event = await publishNotificationEvent({
      eventType: 'system.email_reply',
      entityType,
      entityId,
      actorUserId: session.user.id,
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
        mailbox: thread.mailbox || 'default',
        createdByUserId: session.user.id,
      },
      idempotencyKey: `entity-email-reply:${thread.id}:${crypto.randomUUID()}`,
    })

    await runNotificationWorker({ routeLimit: 20, deliveryLimit: 20, escalationLimit: 1 })

    return NextResponse.json({
      ok: true,
      eventId: event.id,
      threads: await loadThreads(entityType, entityId),
    })
  })
}
