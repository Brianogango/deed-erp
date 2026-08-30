import 'server-only'

import crypto from 'crypto'
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export function normalizeSmsPhone(raw?: string | null): string | null {
  let value = String(raw || '').trim()
  if (!value) return null
  value = value.replace(/[\s().-]/g, '')
  if (value.startsWith('+')) return /^\+[1-9]\d{7,14}$/.test(value) ? value : null
  const digits = value.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) {
    const intl = '+' + digits.slice(2)
    return /^\+[1-9]\d{7,14}$/.test(intl) ? intl : null
  }
  if (digits.startsWith('254')) return '+' + digits
  const defaultCode = String(process.env.DEFAULT_PHONE_COUNTRY_CODE || '254').replace(/\D/g, '')
  const local = digits.startsWith('0') ? digits.slice(1) : digits
  const e164 = `+${defaultCode}${local}`
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null
}

const threadHash = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex').slice(0, 40)

function threadKey(phone: string, entityType?: string | null, entityId?: string | null) {
  return `sms:${threadHash(`${phone}|${entityType || ''}|${entityId || ''}`)}`
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
  participantPhone: string
  participantName?: string | null
  entityType?: string | null
  entityId?: string | null
  preferredThreadId?: string | null
}) {
  if (input.preferredThreadId) {
    const existing = await prisma.communicationThread.findUnique({ where: { id: input.preferredThreadId } })
    if (existing) return existing
  }

  const key = threadKey(input.participantPhone, input.entityType, input.entityId)
  return prisma.communicationThread.upsert({
    where: { threadKey: key },
    create: {
      threadKey: key,
      channel: 'sms',
      participantPhone: input.participantPhone,
      participantName: input.participantName || null,
      entityType: input.entityType || null,
      entityId: input.entityId || null,
      status: 'open',
      lastMessageAt: new Date(),
    },
    update: {
      participantName: input.participantName || undefined,
      lastMessageAt: new Date(),
    },
  })
}

export async function recordOutboundSms(input: {
  notificationDeliveryId: string
  destination: string
  body: string
  provider?: string | null
  providerMessageId?: string | null
  status: string
  sentAt?: Date | null
  deliveredAt?: Date | null
  eventType?: string | null
  entityType?: string | null
  entityId?: string | null
  participantName?: string | null
  createdByUserId?: string | null
  preferredThreadId?: string | null
  metadata?: Record<string, unknown>
}) {
  const phone = normalizeSmsPhone(input.destination)
  if (!phone) return null
  const thread = await resolveThread({
    participantPhone: phone,
    participantName: input.participantName,
    entityType: input.entityType,
    entityId: input.entityId,
    preferredThreadId: input.preferredThreadId,
  })
  const now = new Date()
  const pKey = providerKey(input.provider, input.providerMessageId)

  const message = await prisma.communicationMessage.upsert({
    where: { notificationDeliveryId: input.notificationDeliveryId },
    create: {
      threadId: thread.id,
      direction: 'outbound',
      channel: 'sms',
      body: input.body,
      provider: input.provider || null,
      providerMessageId: input.providerMessageId || null,
      providerMessageKey: pKey,
      notificationDeliveryId: input.notificationDeliveryId,
      eventType: input.eventType || null,
      entityType: input.entityType || null,
      entityId: input.entityId || null,
      recipientPhone: phone,
      status: input.status,
      sentAt: input.sentAt || (['sent', 'delivered', 'read'].includes(input.status) ? now : null),
      deliveredAt: input.deliveredAt || (['delivered', 'read'].includes(input.status) ? now : null),
      createdByUserId: input.createdByUserId || null,
      metadata: json(input.metadata),
    },
    update: {
      threadId: thread.id,
      body: input.body,
      provider: input.provider || undefined,
      providerMessageId: input.providerMessageId || undefined,
      providerMessageKey: pKey || undefined,
      status: input.status,
      sentAt: input.sentAt || undefined,
      deliveredAt: input.deliveredAt || undefined,
      metadata: json(input.metadata),
    },
  })

  await prisma.communicationThread.update({
    where: { id: thread.id },
    data: { lastMessageAt: message.updatedAt },
  }).catch(() => null)

  return message
}

export async function recordInboundSms(input: {
  provider: string
  providerMessageId: string
  from: string
  to?: string | null
  body: string
  participantName?: string | null
  metadata?: Record<string, unknown>
}) {
  const from = normalizeSmsPhone(input.from)
  if (!from || !input.body.trim()) return null

  const pKey = providerKey(input.provider, input.providerMessageId)
  if (pKey) {
    const duplicate = await prisma.communicationMessage.findUnique({ where: { providerMessageKey: pKey } })
    if (duplicate) return duplicate
  }

  let thread = await prisma.communicationThread.findFirst({
    where: { channel: 'sms', participantPhone: from, status: { in: ['open', 'active'] } },
    orderBy: { lastMessageAt: 'desc' },
  })

  if (!thread) {
    thread = await resolveThread({
      participantPhone: from,
      participantName: input.participantName || null,
      entityType: 'sms_contact',
      entityId: from,
    })
  }

  const upper = input.body.trim().toUpperCase()
  const optedOut = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(upper)
  const now = new Date()
  const message = await prisma.communicationMessage.create({
    data: {
      threadId: thread.id,
      direction: 'inbound',
      channel: 'sms',
      body: input.body.trim(),
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      providerMessageKey: pKey,
      senderPhone: from,
      recipientPhone: normalizeSmsPhone(input.to),
      status: 'received',
      receivedAt: now,
      entityType: thread.entityType,
      entityId: thread.entityId,
      metadata: json(input.metadata),
    },
  })

  await prisma.communicationThread.update({
    where: { id: thread.id },
    data: {
      lastMessageAt: now,
      unreadCount: { increment: 1 },
      status: optedOut ? 'opted_out' : thread.status,
    },
  })

  return message
}

export async function updateSmsConversationStatus(input: {
  provider: string
  providerMessageId: string
  status: string
  occurredAt?: Date
}) {
  const key = providerKey(input.provider, input.providerMessageId)
  if (!key) return 0
  const at = input.occurredAt || new Date()
  const data: Record<string, unknown> = { status: input.status }
  if (['sent', 'delivered', 'read'].includes(input.status)) data.sentAt = at
  if (['delivered', 'read'].includes(input.status)) data.deliveredAt = at
  if (input.status === 'read') data.readAt = at
  const result = await prisma.communicationMessage.updateMany({
    where: { providerMessageKey: key },
    data: data as any,
  })
  return result.count
}

export async function isSmsPhoneOptedOut(phone: string) {
  const normalized = normalizeSmsPhone(phone)
  if (!normalized) return false
  const row = await prisma.communicationThread.findFirst({
    where: { channel: 'sms', participantPhone: normalized, status: 'opted_out' },
    select: { id: true },
  })
  return Boolean(row)
}

export async function markSmsThreadRead(threadId: string) {
  const now = new Date()
  await prisma.$transaction([
    prisma.communicationThread.update({
      where: { id: threadId },
      data: { unreadCount: 0 },
    }),
    prisma.communicationMessage.updateMany({
      where: { threadId, direction: 'inbound', readAt: null },
      data: { readAt: now },
    }),
  ])
}

export async function backfillRecentSmsConversations(limit = 250) {
  const deliveries = await prisma.notificationDelivery.findMany({
    where: { channel: 'sms' },
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
    const participantName = external[0]?.name ? String(external[0].name) : null
    const preferredThreadId = String(metadata.communicationThreadId || '').trim() || null

    await recordOutboundSms({
      notificationDeliveryId: delivery.id,
      destination: delivery.destination,
      body: String(metadata.smsText || delivery.event.body || '').slice(0, 480),
      provider: delivery.provider,
      providerMessageId: delivery.providerMessageId,
      status: delivery.status,
      sentAt: delivery.sentAt,
      deliveredAt: delivery.deliveredAt,
      eventType: delivery.event.eventType,
      entityType: delivery.event.entityType,
      entityId: delivery.event.entityId,
      participantName,
      createdByUserId: delivery.event.actorUserId,
      preferredThreadId,
      metadata: {
        eventId: delivery.eventId,
        historicalBackfill: true,
      },
    }).catch(() => null)
    backfilled += 1
  }

  return { checked: deliveries.length, backfilled }
}

export async function latestSmsThreadForPhone(phone: string) {
  const normalized = normalizeSmsPhone(phone)
  if (!normalized) return null
  return prisma.communicationThread.findFirst({
    where: { channel: 'sms', participantPhone: normalized },
    orderBy: { lastMessageAt: 'desc' },
  })
}
