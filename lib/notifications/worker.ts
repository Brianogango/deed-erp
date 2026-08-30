import 'server-only'

import crypto from 'crypto'
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { defaultNotificationPolicy } from './registry'
import {
  bypassPreference,
  channelEnabled,
  getEffectiveNotificationPreference,
  isQuietNow,
  severityAllowed,
} from './preferences'
import { sendProviderDelivery } from './providers'
import { resolveSmsProvider } from './sms-provider'
import { recordOutboundSms } from './sms-conversations'
import { publishNotificationEvent } from './service'
import { renderNotificationTemplate } from './templates'
import type {
  ExternalNotificationRecipient,
  NotificationChannel,
  NotificationRouting,
  NotificationSeverity,
} from './types'

const MAX_ATTEMPTS = 5
const RETRY_MINUTES = [1, 5, 30, 120, 360]

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}

const hash = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)

function retryAt(attempt: number) {
  const base = RETRY_MINUTES[Math.min(Math.max(attempt - 1, 0), RETRY_MINUTES.length - 1)]
  const jitterSeconds = Math.floor(Math.random() * 30)
  return new Date(Date.now() + base * 60_000 + jitterSeconds * 1000)
}

function normalizePhoneE164(raw?: string | null): string | null {
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

function channelDestination(channel: NotificationChannel, user: { email: string; phone: string | null }) {
  if (channel === 'email') return user.email
  if (channel === 'whatsapp' || channel === 'sms') return normalizePhoneE164(user.phone)
  return null
}

async function createDelivery(input: {
  eventId: string
  recipientId?: string | null
  userId?: string | null
  channel: NotificationChannel
  destination?: string | null
  endpointId?: string | null
}) {
  const destinationKey = input.endpointId || input.destination || input.userId || 'in-app'
  const idempotencyKey = `${input.eventId}:${input.channel}:${hash(destinationKey)}`
  const status = input.channel === 'in_app' ? 'delivered' : 'queued'
  const now = new Date()

  return prisma.notificationDelivery.upsert({
    where: { idempotencyKey },
    create: {
      eventId: input.eventId,
      recipientId: input.recipientId || null,
      userId: input.userId || null,
      channel: input.channel,
      destination: input.destination || null,
      provider: input.channel === 'sms' ? (resolveSmsProvider() || 'twilio') : input.channel,
      status,
      deliveredAt: input.channel === 'in_app' ? now : null,
      sentAt: input.channel === 'in_app' ? now : null,
      idempotencyKey,
      metadata: input.endpointId ? { endpointId: input.endpointId } : {},
    },
    update: {},
  })
}

async function routeUserRecipient(event: any, recipient: any, channels: NotificationChannel[]) {
  const user = await prisma.user.findUnique({
    where: { id: recipient.userId },
    select: { id: true, email: true, phone: true, isActive: true },
  })
  if (!user?.isActive) return

  const severity = event.severity as NotificationSeverity
  const preference = await getEffectiveNotificationPreference(user.id, event.eventType)
  const bypass = bypassPreference(event.eventType, severity)

  if (!bypass && !severityAllowed(preference, severity)) return

  for (const channel of channels) {
    if (!bypass && !channelEnabled(preference, channel)) continue

    if (channel === 'push') {
      const endpoints = await prisma.notificationEndpoint.findMany({
        where: { userId: user.id, kind: 'web_push', revokedAt: null },
        select: { id: true },
      })
      for (const endpoint of endpoints) {
        await createDelivery({
          eventId: event.id,
          recipientId: recipient.id,
          userId: user.id,
          channel,
          endpointId: endpoint.id,
        })
      }
      continue
    }

    const destination = channelDestination(channel, user)
    if (channel !== 'in_app' && !destination) continue
    await createDelivery({
      eventId: event.id,
      recipientId: recipient.id,
      userId: user.id,
      channel,
      destination,
    })
  }
}

async function routeExternalRecipient(
  event: any,
  external: ExternalNotificationRecipient,
  inheritedChannels: NotificationChannel[],
) {
  const channels = (external.channels?.length ? external.channels : inheritedChannels)
    .filter(channel => channel !== 'in_app' && channel !== 'push')

  for (const channel of channels) {
    const destination =
      channel === 'email'
        ? String(external.email || '').trim().toLowerCase() || null
        : normalizePhoneE164(external.phone)
    if (!destination) continue
    await createDelivery({
      eventId: event.id,
      channel,
      destination,
    })
  }
}

async function routeEvent(eventId: string) {
  const event = await prisma.notificationEvent.findUnique({
    where: { id: eventId },
    include: { recipients: true },
  })
  if (!event) return

  const policy = defaultNotificationPolicy(event.eventType)
  const routing = asRecord(event.routing) as NotificationRouting
  const channels = Array.isArray(routing.channels) && routing.channels.length
    ? routing.channels
    : policy.channels

  for (const recipient of event.recipients) {
    await routeUserRecipient(event, recipient, channels)
  }
  for (const external of Array.isArray(routing.externalRecipients) ? routing.externalRecipients : []) {
    await routeExternalRecipient(event, external, channels)
  }
}

async function claimOutbox(limit: number, workerId: string): Promise<Array<{ id: string; event_id: string; attempt_count: number }>> {
  return prisma.$queryRawUnsafe<Array<{ id: string; event_id: string; attempt_count: number }>>(
    `WITH picked AS (
       SELECT id
       FROM notification_outbox
       WHERE status IN ('queued','retrying')
         AND next_attempt_at <= NOW()
         AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '5 minutes')
       ORDER BY next_attempt_at ASC, created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE notification_outbox o
     SET status='processing',
         locked_at=NOW(),
         locked_by=$2,
         attempt_count=o.attempt_count+1,
         updated_at=NOW()
     FROM picked
     WHERE o.id=picked.id
     RETURNING o.id, o.event_id, o.attempt_count`,
    Math.max(1, Math.min(limit, 100)),
    workerId,
  )
}

export async function routePendingNotificationEvents(limit = 50) {
  const workerId = `router:${process.pid}:${crypto.randomUUID().slice(0, 8)}`
  const rows = await claimOutbox(limit, workerId)
  let processed = 0
  let failed = 0

  for (const row of rows) {
    try {
      await routeEvent(row.event_id)
      await prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: 'processed',
          processedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      })
      processed += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'routing_failed'
      const terminal = row.attempt_count >= MAX_ATTEMPTS
      await prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: terminal ? 'failed' : 'retrying',
          nextAttemptAt: terminal ? new Date() : retryAt(row.attempt_count),
          lockedAt: null,
          lockedBy: null,
          lastError: message,
        },
      })
      failed += 1
    }
  }

  return { claimed: rows.length, processed, failed }
}

async function claimDeliveries(limit: number): Promise<Array<{ id: string }>> {
  return prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `WITH picked AS (
       SELECT id
       FROM notification_deliveries
       WHERE status IN ('queued','retrying')
         AND next_attempt_at <= NOW()
       ORDER BY next_attempt_at ASC, created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE notification_deliveries d
     SET status='sending',
         attempt_count=d.attempt_count+1,
         last_attempt_at=NOW(),
         updated_at=NOW()
     FROM picked
     WHERE d.id=picked.id
     RETURNING d.id`,
    Math.max(1, Math.min(limit, 200)),
  )
}

async function maybeCreateSmsFallback(delivery: any) {
  const policy = defaultNotificationPolicy(delivery.event.eventType)
  if (delivery.channel !== 'whatsapp' || !policy.fallbackSms || !delivery.destination) return
  await createDelivery({
    eventId: delivery.eventId,
    recipientId: delivery.recipientId,
    userId: delivery.userId,
    channel: 'sms',
    destination: delivery.destination,
  })
}

async function deadLetter(delivery: any, reason: string) {
  await prisma.$transaction([
    prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'dead_letter', failedAt: new Date(), lastError: reason },
    }),
    prisma.notificationDeadLetter.upsert({
      where: { deliveryId: delivery.id },
      create: {
        deliveryId: delivery.id,
        reason,
        payload: {
          eventId: delivery.eventId,
          channel: delivery.channel,
          destination: delivery.destination ? hash(delivery.destination) : null,
        },
      },
      update: { reason, resolvedAt: null, resolutionNote: null },
    }),
  ])
  await maybeCreateSmsFallback(delivery)
}

export async function dispatchPendingNotificationDeliveries(limit = 100) {
  const claimed = await claimDeliveries(limit)
  let sent = 0
  let retried = 0
  let dead = 0

  for (const row of claimed) {
    const delivery = await prisma.notificationDelivery.findUnique({
      where: { id: row.id },
      include: { event: true },
    })
    if (!delivery) continue

    const severity = delivery.event.severity as NotificationSeverity
    if (delivery.userId && delivery.channel !== 'in_app' && !bypassPreference(delivery.event.eventType, severity)) {
      const pref = await getEffectiveNotificationPreference(delivery.userId, delivery.event.eventType)
      if (isQuietNow(pref)) {
        await prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'retrying',
            nextAttemptAt: new Date(Date.now() + 30 * 60_000),
            attemptCount: Math.max(0, delivery.attemptCount - 1),
          },
        })
        retried += 1
        continue
      }
    }

    let endpoint: { endpoint: string; p256dh: string; authSecret: string } | null = null
    let endpointId: string | null = null
    if (delivery.channel === 'push') {
      endpointId = String(asRecord(delivery.metadata).endpointId || '') || null
      if (endpointId) {
        const rowEndpoint = await prisma.notificationEndpoint.findUnique({ where: { id: endpointId } })
        if (rowEndpoint?.revokedAt == null && rowEndpoint?.p256dh && rowEndpoint?.authSecret) {
          endpoint = {
            endpoint: rowEndpoint.endpoint,
            p256dh: rowEndpoint.p256dh,
            authSecret: rowEndpoint.authSecret,
          }
        }
      }
    }

    const attemptNo = delivery.attemptCount
    const attempt = await prisma.notificationAttempt.create({
      data: {
        deliveryId: delivery.id,
        attemptNo,
        status: 'sending',
        provider: delivery.provider,
      },
    })

    const metadata = asRecord(delivery.event.metadata)
    const channel = delivery.channel as NotificationChannel
    const rendered = await renderNotificationTemplate(delivery.event, channel)
    const channelTextKey = `${channel}Text`
    const effectiveMetadata: Record<string, unknown> = {
      ...metadata,
      [channelTextKey]: metadata[channelTextKey] ?? rendered.text,
      ...(channel === 'email'
        ? { emailSubject: metadata.emailSubject ?? rendered.subject }
        : {}),
    }

    if (rendered.templateId) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          metadata: {
            ...asRecord(delivery.metadata),
            templateId: rendered.templateId,
            templateVersion: rendered.templateVersion,
          },
        },
      })
    }

    const result = await sendProviderDelivery({
      channel,
      eventType: delivery.event.eventType,
      title: rendered.subject,
      body: rendered.text,
      actionUrl: delivery.event.actionUrl,
      destination: delivery.destination,
      endpoint,
      metadata: effectiveMetadata,
    })

    const smsBody = channel === 'sms'
      ? String(effectiveMetadata.smsText ?? rendered.text).slice(0, 480)
      : ''
    const routing = asRecord(delivery.event.routing)
    const externalRecipients = Array.isArray(routing.externalRecipients)
      ? routing.externalRecipients as Array<Record<string, unknown>>
      : []
    const participantName = externalRecipients.find(row => String(row.phone || '') === String(delivery.destination || ''))?.name
      || externalRecipients[0]?.name
      || null
    const preferredThreadId = String(metadata.communicationThreadId || '').trim() || null
    const createdByUserId = String(metadata.createdByUserId || delivery.event.actorUserId || '').trim() || null

    if (result.success) {
      const delivered = Boolean(result.acceptedAsDelivered || delivery.channel === 'in_app')
      const sentAt = new Date()
      await prisma.$transaction([
        prisma.notificationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: delivered ? 'delivered' : 'sent',
            provider: result.provider,
            providerResponse: (result.response || {}) as Prisma.InputJsonValue,
            finishedAt: sentAt,
          },
        }),
        prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: delivered ? 'delivered' : 'sent',
            provider: result.provider,
            providerMessageId: result.messageId || null,
            sentAt,
            deliveredAt: delivered ? sentAt : null,
            lastError: null,
          },
        }),
      ])
      if (channel === 'sms' && delivery.destination) {
        await recordOutboundSms({
          notificationDeliveryId: delivery.id,
          destination: delivery.destination,
          body: smsBody,
          provider: result.provider,
          providerMessageId: result.messageId || null,
          status: delivered ? 'delivered' : 'sent',
          sentAt,
          deliveredAt: delivered ? sentAt : null,
          eventType: delivery.event.eventType,
          entityType: delivery.event.entityType,
          entityId: delivery.event.entityId,
          participantName: participantName ? String(participantName) : null,
          createdByUserId,
          preferredThreadId,
          metadata: {
            eventId: delivery.eventId,
            title: rendered.subject,
            actionUrl: delivery.event.actionUrl,
          },
        }).catch(error => console.error('[notifications] could not write SMS conversation ledger', error))
      }
      sent += 1
      continue
    }

    const error = result.error || 'provider_send_failed'
    await prisma.notificationAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'failed',
        provider: result.provider,
        providerResponse: (result.response || {}) as Prisma.InputJsonValue,
        errorCode: result.errorCode || null,
        error,
        finishedAt: new Date(),
      },
    })

    if (delivery.channel === 'push' && endpointId && ['404', '410'].includes(String(result.errorCode || ''))) {
      await prisma.notificationEndpoint.update({
        where: { id: endpointId },
        data: { revokedAt: new Date() },
      }).catch(() => {})
    }

    if (attemptNo >= MAX_ATTEMPTS) {
      await deadLetter({ ...delivery, event: delivery.event }, error)
      if (channel === 'sms' && delivery.destination) {
        await recordOutboundSms({
          notificationDeliveryId: delivery.id,
          destination: delivery.destination,
          body: smsBody,
          provider: result.provider,
          providerMessageId: result.messageId || null,
          status: 'dead_letter',
          eventType: delivery.event.eventType,
          entityType: delivery.event.entityType,
          entityId: delivery.event.entityId,
          participantName: participantName ? String(participantName) : null,
          createdByUserId,
          preferredThreadId,
          metadata: { eventId: delivery.eventId, error },
        }).catch(logError => console.error('[notifications] could not write failed SMS ledger row', logError))
      }
      dead += 1
    } else {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'retrying',
          nextAttemptAt: retryAt(attemptNo),
          lastError: error,
        },
      })
      if (channel === 'sms' && delivery.destination) {
        await recordOutboundSms({
          notificationDeliveryId: delivery.id,
          destination: delivery.destination,
          body: smsBody,
          provider: result.provider,
          providerMessageId: result.messageId || null,
          status: 'retrying',
          eventType: delivery.event.eventType,
          entityType: delivery.event.entityType,
          entityId: delivery.event.entityId,
          participantName: participantName ? String(participantName) : null,
          createdByUserId,
          preferredThreadId,
          metadata: { eventId: delivery.eventId, error },
        }).catch(logError => console.error('[notifications] could not write retrying SMS ledger row', logError))
      }
      retried += 1
    }
  }

  return { claimed: claimed.length, sent, retried, deadLettered: dead }
}

export async function processNotificationEscalations(limit = 50) {
  const events = await prisma.notificationEvent.findMany({
    where: {
      resolvedAt: null,
      requiresAcknowledgement: true,
      escalateAt: { lte: new Date() },
    },
    include: { recipients: true },
    orderBy: { escalateAt: 'asc' },
    take: Math.max(1, Math.min(limit, 100)),
  })

  let escalated = 0
  for (const event of events) {
    if (event.recipients.some(r => r.acknowledgedAt)) {
      await prisma.notificationEvent.update({ where: { id: event.id }, data: { escalateAt: null } })
      continue
    }

    const policy = defaultNotificationPolicy(event.eventType)
    const roles = policy.escalationRoles?.length ? policy.escalationRoles : ['director']
    await publishNotificationEvent({
      eventType: 'system.escalation',
      entityType: event.entityType || 'notification_event',
      entityId: event.entityId || event.id,
      roles,
      severity: 'critical',
      priority: 'urgent',
      title: `Escalation: ${event.title}`,
      body: `This action has not been acknowledged within the required time.\n\n${event.body}`,
      actionUrl: event.actionUrl,
      metadata: { originalEventId: event.id, originalEventType: event.eventType },
      idempotencyKey: `notification-escalation:${event.id}:1`,
      requiresAcknowledgement: true,
    })

    await prisma.notificationEvent.update({ where: { id: event.id }, data: { escalateAt: null } })
    escalated += 1
  }

  return { checked: events.length, escalated }
}

export async function runNotificationWorker(options?: { routeLimit?: number; deliveryLimit?: number; escalationLimit?: number }) {
  const routed = await routePendingNotificationEvents(options?.routeLimit || 50)
  const delivered = await dispatchPendingNotificationDeliveries(options?.deliveryLimit || 100)
  const escalations = await processNotificationEscalations(options?.escalationLimit || 50)
  return { routed, delivered, escalations }
}
