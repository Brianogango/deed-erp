import 'server-only'

import crypto from 'crypto'
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export function normalizeEmailAddress(raw?: string | null): string | null {
  const value = String(raw || '').trim().toLowerCase()
  if (!value || !value.includes('@') || value.length > 320) return null
  return value
}

const threadHash = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex').slice(0, 40)

const normalizeSubject = (value?: string | null) =>
  String(value || '')
    .trim()
    .replace(/^((re|fw|fwd)\s*:\s*)+/i, '')
    .slice(0, 500)

function emailThreadKey(input: {
  email: string
  mailbox?: string | null
  entityType?: string | null
  entityId?: string | null
  subject?: string | null
}) {
  const entity = input.entityType && input.entityId
    ? `${input.entityType}|${input.entityId}`
    : normalizeSubject(input.subject)
  return `email:${threadHash(`${input.email}|${input.mailbox || ''}|${entity || ''}`)}`
}

function providerKey(provider?: string | null, providerMessageId?: string | null) {
  if (!provider || !providerMessageId) return null
  return `${provider}:${providerMessageId}`
}

const json = (value: unknown): Prisma.InputJsonValue => {
  try {
    return JSON.parse(JSON.stringify(value && typeof value === 'object' ? value : {})) as Prisma.InputJsonValue
  } catch {
    return {} as Prisma.InputJsonValue
  }
}

async function resolveThread(input: {
  participantEmail: string
  participantName?: string | null
  mailbox?: string | null
  subject?: string | null
  entityType?: string | null
  entityId?: string | null
  preferredThreadId?: string | null
}) {
  if (input.preferredThreadId) {
    const existing = await prisma.communicationThread.findUnique({ where: { id: input.preferredThreadId } })
    if (existing?.channel === 'email') return existing
  }

  const key = emailThreadKey({
    email: input.participantEmail,
    mailbox: input.mailbox,
    subject: input.subject,
    entityType: input.entityType,
    entityId: input.entityId,
  })

  return prisma.communicationThread.upsert({
    where: { threadKey: key },
    create: {
      threadKey: key,
      channel: 'email',
      participantEmail: input.participantEmail,
      participantName: input.participantName || null,
      mailbox: input.mailbox || null,
      subject: normalizeSubject(input.subject) || null,
      entityType: input.entityType || null,
      entityId: input.entityId || null,
      status: 'open',
      lastMessageAt: new Date(),
    },
    update: {
      participantName: input.participantName || undefined,
      mailbox: input.mailbox || undefined,
      subject: normalizeSubject(input.subject) || undefined,
      entityType: input.entityType || undefined,
      entityId: input.entityId || undefined,
      lastMessageAt: new Date(),
    },
  })
}

export async function recordOutboundEmail(input: {
  notificationDeliveryId?: string | null
  destination: string
  subject: string
  body: string
  provider?: string | null
  providerMessageId?: string | null
  internetMessageId?: string | null
  status: string
  sentAt?: Date | null
  deliveredAt?: Date | null
  eventType?: string | null
  entityType?: string | null
  entityId?: string | null
  participantName?: string | null
  mailbox?: string | null
  senderEmail?: string | null
  createdByUserId?: string | null
  preferredThreadId?: string | null
  metadata?: Record<string, unknown>
}) {
  const email = normalizeEmailAddress(input.destination)
  if (!email) return null

  const thread = await resolveThread({
    participantEmail: email,
    participantName: input.participantName,
    mailbox: input.mailbox,
    subject: input.subject,
    entityType: input.entityType,
    entityId: input.entityId,
    preferredThreadId: input.preferredThreadId,
  })

  const now = new Date()
  const pKey = providerKey(input.provider, input.providerMessageId)
  const data = {
    threadId: thread.id,
    direction: 'outbound',
    channel: 'email',
    subject: input.subject.slice(0, 500),
    body: input.body,
    provider: input.provider || null,
    providerMessageId: input.providerMessageId || null,
    providerMessageKey: pKey,
    internetMessageId: input.internetMessageId || input.providerMessageId || null,
    notificationDeliveryId: input.notificationDeliveryId || null,
    eventType: input.eventType || null,
    entityType: input.entityType || null,
    entityId: input.entityId || null,
    senderEmail: normalizeEmailAddress(input.senderEmail),
    recipientEmail: email,
    status: input.status,
    sentAt: input.sentAt || (['sent', 'delivered', 'read'].includes(input.status) ? now : null),
    deliveredAt: input.deliveredAt || (['delivered', 'read'].includes(input.status) ? now : null),
    createdByUserId: input.createdByUserId || null,
    metadata: json(input.metadata),
  }

  let message
  if (input.notificationDeliveryId) {
    message = await prisma.communicationMessage.upsert({
      where: { notificationDeliveryId: input.notificationDeliveryId },
      create: data,
      update: {
        threadId: thread.id,
        subject: data.subject,
        body: input.body,
        provider: input.provider || undefined,
        providerMessageId: input.providerMessageId || undefined,
        providerMessageKey: pKey || undefined,
        internetMessageId: data.internetMessageId || undefined,
        status: input.status,
        sentAt: input.sentAt || undefined,
        deliveredAt: input.deliveredAt || undefined,
        metadata: json(input.metadata),
      },
    })
  } else {
    message = await prisma.communicationMessage.create({ data })
  }

  await prisma.communicationThread.update({
    where: { id: thread.id },
    data: { lastMessageAt: message.updatedAt },
  }).catch(() => null)

  return message
}

export async function recordInboundEmail(input: {
  provider?: string | null
  providerMessageId?: string | null
  internetMessageId?: string | null
  from: string
  to?: string | null
  mailbox?: string | null
  subject?: string | null
  body: string
  participantName?: string | null
  inReplyTo?: string | null
  references?: string[]
  entityType?: string | null
  entityId?: string | null
  metadata?: Record<string, unknown>
}) {
  const from = normalizeEmailAddress(input.from)
  if (!from) return null

  const internetMessageId = String(input.internetMessageId || input.providerMessageId || '').trim() || null
  if (internetMessageId) {
    const duplicate = await prisma.communicationMessage.findFirst({
      where: {
        channel: 'email',
        OR: [
          { internetMessageId },
          { providerMessageId: internetMessageId },
        ],
      },
    })
    if (duplicate) return duplicate
  }

  const referenceIds = Array.from(new Set([
    String(input.inReplyTo || '').trim(),
    ...(input.references || []).map(v => String(v).trim()),
  ].filter(Boolean)))

  let thread = null
  if (referenceIds.length) {
    const parent = await prisma.communicationMessage.findFirst({
      where: {
        channel: 'email',
        OR: [
          { internetMessageId: { in: referenceIds } },
          { providerMessageId: { in: referenceIds } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { thread: true },
    })
    if (parent?.thread) thread = parent.thread
  }

  if (!thread && input.entityType && input.entityId) {
    thread = await prisma.communicationThread.findFirst({
      where: {
        channel: 'email',
        participantEmail: from,
        entityType: input.entityType,
        entityId: input.entityId,
      },
      orderBy: { lastMessageAt: 'desc' },
    })
  }

  if (!thread && normalizeSubject(input.subject)) {
    thread = await prisma.communicationThread.findFirst({
      where: {
        channel: 'email',
        participantEmail: from,
        ...(input.mailbox ? { mailbox: input.mailbox } : {}),
        subject: { equals: normalizeSubject(input.subject), mode: 'insensitive' },
        status: { in: ['open', 'active'] },
      },
      orderBy: { lastMessageAt: 'desc' },
    })
  }

  if (!thread) {
    thread = await prisma.communicationThread.findFirst({
      where: {
        channel: 'email',
        participantEmail: from,
        ...(input.mailbox ? { mailbox: input.mailbox } : {}),
        status: { in: ['open', 'active'] },
      },
      orderBy: { lastMessageAt: 'desc' },
    })
  }

  if (!thread) {
    thread = await resolveThread({
      participantEmail: from,
      participantName: input.participantName || null,
      mailbox: input.mailbox || null,
      subject: input.subject || null,
      entityType: input.entityType || 'email_contact',
      entityId: input.entityId || from,
    })
  }

  const now = new Date()
  const message = await prisma.communicationMessage.create({
    data: {
      threadId: thread.id,
      direction: 'inbound',
      channel: 'email',
      subject: String(input.subject || '').slice(0, 500) || null,
      body: input.body || '',
      provider: input.provider || 'imap',
      providerMessageId: input.providerMessageId || internetMessageId,
      providerMessageKey: providerKey(input.provider || 'imap', input.providerMessageId || internetMessageId),
      internetMessageId,
      inReplyTo: String(input.inReplyTo || '').slice(0, 500) || null,
      senderEmail: from,
      recipientEmail: normalizeEmailAddress(input.to),
      status: 'received',
      receivedAt: now,
      entityType: thread.entityType,
      entityId: thread.entityId,
      metadata: json({
        ...(input.metadata || {}),
        references: input.references || [],
        mailbox: input.mailbox || null,
      }),
    },
  })

  await prisma.communicationThread.update({
    where: { id: thread.id },
    data: {
      participantName: input.participantName || undefined,
      subject: normalizeSubject(input.subject) || undefined,
      mailbox: input.mailbox || undefined,
      lastMessageAt: now,
      unreadCount: { increment: 1 },
    },
  })

  return message
}

export async function updateEmailConversationStatus(input: {
  provider: string
  providerMessageId: string
  status: string
  occurredAt?: Date
}) {
  const at = input.occurredAt || new Date()
  const data: Record<string, unknown> = { status: input.status }
  if (['sent', 'delivered', 'read'].includes(input.status)) data.sentAt = at
  if (['delivered', 'read'].includes(input.status)) data.deliveredAt = at
  if (input.status === 'read') data.readAt = at

  const result = await prisma.communicationMessage.updateMany({
    where: {
      channel: 'email',
      OR: [
        { providerMessageKey: providerKey(input.provider, input.providerMessageId) || undefined },
        { providerMessageId: input.providerMessageId },
        { internetMessageId: input.providerMessageId },
      ],
    },
    data: data as any,
  })
  return result.count
}

export async function markEmailThreadRead(threadId: string) {
  const now = new Date()
  await prisma.$transaction([
    prisma.communicationThread.update({
      where: { id: threadId },
      data: { unreadCount: 0 },
    }),
    prisma.communicationMessage.updateMany({
      where: { threadId, channel: 'email', direction: 'inbound', readAt: null },
      data: { readAt: now },
    }),
  ])
}

export async function backfillRecentEmailConversations(limit = 250) {
  const deliveries = await prisma.notificationDelivery.findMany({
    where: { channel: 'email' },
    include: { event: true },
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(limit, 500)),
  })
  if (!deliveries.length) return { checked: 0, backfilled: 0 }

  const existing = await prisma.communicationMessage.findMany({
    where: { notificationDeliveryId: { in: deliveries.map(row => row.id) } },
    select: { notificationDeliveryId: true },
  })
  const seen = new Set(existing.map(row => row.notificationDeliveryId).filter(Boolean))
  let backfilled = 0

  for (const delivery of deliveries) {
    if (seen.has(delivery.id) || !delivery.destination) continue
    const metadata = delivery.event.metadata && typeof delivery.event.metadata === 'object' && !Array.isArray(delivery.event.metadata)
      ? delivery.event.metadata as Record<string, unknown>
      : {}
    const routing = delivery.event.routing && typeof delivery.event.routing === 'object' && !Array.isArray(delivery.event.routing)
      ? delivery.event.routing as Record<string, unknown>
      : {}
    const external = Array.isArray(routing.externalRecipients)
      ? routing.externalRecipients as Array<Record<string, unknown>>
      : []

    await recordOutboundEmail({
      notificationDeliveryId: delivery.id,
      destination: delivery.destination,
      subject: String(metadata.emailSubject || delivery.event.title || ''),
      body: String(metadata.emailText || delivery.event.body || ''),
      provider: delivery.provider,
      providerMessageId: delivery.providerMessageId,
      status: delivery.status,
      sentAt: delivery.sentAt,
      deliveredAt: delivery.deliveredAt,
      eventType: delivery.event.eventType,
      entityType: delivery.event.entityType,
      entityId: delivery.event.entityId,
      participantName: external[0]?.name ? String(external[0].name) : null,
      mailbox: String(metadata.mailbox || '').trim() || null,
      createdByUserId: delivery.event.actorUserId,
      preferredThreadId: String(metadata.communicationThreadId || '').trim() || null,
      metadata: {
        eventId: delivery.eventId,
        historicalBackfill: true,
      },
    }).catch(() => null)
    backfilled += 1
  }

  return { checked: deliveries.length, backfilled }
}
