import 'server-only'

import crypto from 'crypto'
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { defaultNotificationPolicy } from './registry'
import { resolveSmsProvider } from './sms-provider'
import { updateSmsConversationStatus } from './sms-conversations'

const MAX_ATTEMPTS = 5

const hash = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)

function retryAt(attempt: number) {
  const mins = [1, 5, 30, 120, 360][Math.min(Math.max(attempt - 1, 0), 4)]
  return new Date(Date.now() + mins * 60_000)
}

const terminalSuccess = new Set(['delivered', 'read'])
const terminalFailure = new Set(['failed', 'undelivered', 'bounce', 'bounced', 'dropped', 'complaint', 'spamreport', 'blocked'])

export type ProviderDeliveryStatusInput = {
  provider: string
  messageId: string
  status: string
  error?: string | null
  errorCode?: string | null
  raw?: Record<string, unknown>
  occurredAt?: Date
}

async function createSmsFallback(delivery: any) {
  const policy = defaultNotificationPolicy(delivery.event.eventType)
  if (delivery.channel !== 'whatsapp' || !policy.fallbackSms || !delivery.destination) return
  const key = `${delivery.eventId}:sms:${hash(delivery.destination)}`
  await prisma.notificationDelivery.upsert({
    where: { idempotencyKey: key },
    create: {
      eventId: delivery.eventId,
      recipientId: delivery.recipientId,
      userId: delivery.userId,
      channel: 'sms',
      destination: delivery.destination,
      provider: resolveSmsProvider() || 'twilio',
      status: 'queued',
      idempotencyKey: key,
      metadata: { fallbackFromDeliveryId: delivery.id },
    },
    update: {},
  })
}

export async function applyProviderDeliveryStatus(input: ProviderDeliveryStatusInput) {
  const delivery = await prisma.notificationDelivery.findFirst({
    where: {
      provider: input.provider,
      providerMessageId: input.messageId,
    },
    include: { event: true },
  })
  if (!delivery) return { matched: false as const }

  const status = input.status.toLowerCase()
  const at = input.occurredAt || new Date()
  const syncSmsStatus = async (nextStatus: string) => {
    if (delivery.channel !== 'sms') return
    await updateSmsConversationStatus({
      provider: input.provider,
      providerMessageId: input.messageId,
      status: nextStatus,
      occurredAt: at,
    }).catch(error => console.error('[notifications] SMS conversation status sync failed', error))
  }

  if (status === 'open') {
    // Email open events are advisory; preserve delivered semantics without
    // treating tracking pixels as a business acknowledgement.
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'delivered', deliveredAt: delivery.deliveredAt || at, lastError: null },
    })
    return { matched: true as const, deliveryId: delivery.id, status: 'delivered' }
  }

  if (status === 'read') {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'read', deliveredAt: delivery.deliveredAt || at, readAt: at, lastError: null },
    })
    await syncSmsStatus('read')
    return { matched: true as const, deliveryId: delivery.id, status: 'read' }
  }

  if (terminalSuccess.has(status) || ['sent', 'processed', 'accepted'].includes(status)) {
    // Never regress a delivery already confirmed as delivered/read.
    if (delivery.status === 'read' || delivery.status === 'delivered') {
      return { matched: true as const, deliveryId: delivery.id, status: delivery.status }
    }
    const isDelivered = status === 'delivered'
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: isDelivered ? 'delivered' : 'sent',
        sentAt: delivery.sentAt || at,
        deliveredAt: isDelivered ? at : delivery.deliveredAt,
        lastError: null,
      },
    })
    await syncSmsStatus(isDelivered ? 'delivered' : 'sent')
    return { matched: true as const, deliveryId: delivery.id, status: isDelivered ? 'delivered' : 'sent' }
  }

  if (status === 'deferred' || status === 'queued') {
    if (delivery.status === 'delivered' || delivery.status === 'read') {
      return { matched: true as const, deliveryId: delivery.id, status: delivery.status }
    }
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'retrying', nextAttemptAt: retryAt(Math.max(delivery.attemptCount, 1)), lastError: input.error || status },
    })
    await syncSmsStatus('retrying')
    return { matched: true as const, deliveryId: delivery.id, status: 'retrying' }
  }

  if (terminalFailure.has(status)) {
    if (delivery.status === 'delivered' || delivery.status === 'read') {
      return { matched: true as const, deliveryId: delivery.id, status: delivery.status }
    }
    const reason = input.error || input.errorCode || status
    if (delivery.attemptCount >= MAX_ATTEMPTS || ['bounced', 'dropped', 'complaint'].includes(status)) {
      await prisma.$transaction([
        prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: { status: 'dead_letter', failedAt: at, lastError: reason },
        }),
        prisma.notificationDeadLetter.upsert({
          where: { deliveryId: delivery.id },
          create: {
            deliveryId: delivery.id,
            reason,
            payload: (input.raw || {}) as Prisma.InputJsonValue,
          },
          update: {
            reason,
            payload: (input.raw || {}) as Prisma.InputJsonValue,
            resolvedAt: null,
            resolutionNote: null,
          },
        }),
      ])
      await createSmsFallback(delivery)
      await syncSmsStatus('dead_letter')
      return { matched: true as const, deliveryId: delivery.id, status: 'dead_letter' }
    }

    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'retrying',
        nextAttemptAt: retryAt(Math.max(delivery.attemptCount, 1)),
        failedAt: at,
        lastError: reason,
      },
    })
    await syncSmsStatus('retrying')
    return { matched: true as const, deliveryId: delivery.id, status: 'retrying' }
  }

  return { matched: true as const, deliveryId: delivery.id, status: delivery.status }
}
