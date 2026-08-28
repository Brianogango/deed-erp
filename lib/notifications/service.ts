import 'server-only'

import prisma from '@/lib/prisma'
import type { Prisma, PrismaClient } from '@prisma/client'
import { defaultNotificationPolicy } from './registry'
import type {
  ExternalNotificationRecipient,
  NotificationRouting,
  PublishNotificationInput,
} from './types'

type DbClient = Prisma.TransactionClient | PrismaClient

const unique = (values: Array<string | null | undefined>) =>
  [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))]

function asDate(value?: Date | string | null): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function normalizeExternalRecipient(row: ExternalNotificationRecipient): ExternalNotificationRecipient | null {
  const email = String(row.email || '').trim().toLowerCase() || null
  const phone = String(row.phone || '').trim() || null
  if (!email && !phone) return null
  return {
    name: String(row.name || '').trim() || null,
    email,
    phone,
    channels: Array.isArray(row.channels) ? [...new Set(row.channels)] : undefined,
  }
}

async function resolveUserIds(
  db: DbClient,
  input: PublishNotificationInput,
): Promise<string[]> {
  const policy = defaultNotificationPolicy(input.eventType)
  const roleNames = unique([...(input.roles || []), ...(policy.recipientRoles || [])])
  const ids = new Set(unique(input.userIds || []))

  if (roleNames.length) {
    const rows = await db.user.findMany({
      where: { isActive: true, role: { in: roleNames as any } },
      select: { id: true },
    })
    for (const row of rows) ids.add(row.id)
  }

  if (input.excludeActor !== false && input.actorUserId) ids.delete(input.actorUserId)
  return [...ids]
}

/**
 * Persist a notification event + recipients + outbox atomically. The provider
 * calls happen later in the worker. A stable idempotencyKey makes repeated API,
 * webhook and scanner invocations safe.
 */
export async function publishNotificationEvent(
  input: PublishNotificationInput,
  tx?: Prisma.TransactionClient,
) {
  const run = async (db: DbClient) => {
    const policy = defaultNotificationPolicy(input.eventType)
    const userIds = await resolveUserIds(db, input)
    const externalRecipients = (input.externalRecipients || [])
      .map(normalizeExternalRecipient)
      .filter((v): v is ExternalNotificationRecipient => Boolean(v))

    const routing: NotificationRouting = {
      userIds,
      externalRecipients,
      channels: input.channels || policy.channels,
    }

    const severity = input.severity || policy.severity
    const priority = input.priority || policy.priority
    const requiresAcknowledgement =
      input.requiresAcknowledgement ?? Boolean(policy.requiresAcknowledgement)

    const escalateAt =
      asDate(input.escalateAt) ||
      (requiresAcknowledgement && policy.escalationMinutes
        ? new Date(Date.now() + policy.escalationMinutes * 60_000)
        : null)

    const existing = await db.notificationEvent.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    })
    if (existing) return existing

    const event = await db.notificationEvent.create({
      data: {
        eventType: input.eventType,
        entityType: input.entityType || null,
        entityId: input.entityId || null,
        actorUserId: input.actorUserId || null,
        severity,
        priority,
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl || null,
        metadata: (input.metadata || {}) as Prisma.InputJsonValue,
        routing: routing as unknown as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey,
        requiresAcknowledgement,
        dueAt: asDate(input.dueAt),
        escalateAt,
      },
    })

    if (userIds.length) {
      await db.notificationRecipient.createMany({
        data: userIds.map(userId => ({ eventId: event.id, userId })),
        skipDuplicates: true,
      })
    }

    await db.notificationOutbox.create({
      data: { eventId: event.id, status: 'queued', nextAttemptAt: new Date() },
    })

    return event
  }

  return tx ? run(tx) : prisma.$transaction(run)
}

export async function resolveNotificationEvent(
  idempotencyKey: string,
  resolvedById?: string | null,
) {
  const event = await prisma.notificationEvent.findUnique({ where: { idempotencyKey } })
  if (!event || event.resolvedAt) return event
  const now = new Date()
  return prisma.$transaction(async tx => {
    const updated = await tx.notificationEvent.update({
      where: { id: event.id },
      data: { resolvedAt: now, resolvedById: resolvedById || null },
    })
    await tx.notificationRecipient.updateMany({
      where: { eventId: event.id, resolvedAt: null },
      data: { resolvedAt: now },
    })
    return updated
  })
}

export async function resolveEntityNotifications(
  entityType: string,
  entityId: string,
  eventTypes?: string[],
  resolvedById?: string | null,
) {
  const now = new Date()
  const where: Prisma.NotificationEventWhereInput = {
    entityType,
    entityId,
    resolvedAt: null,
    ...(eventTypes?.length ? { eventType: { in: eventTypes } } : {}),
  }
  const events = await prisma.notificationEvent.findMany({ where, select: { id: true } })
  if (!events.length) return 0
  const ids = events.map(e => e.id)
  await prisma.$transaction([
    prisma.notificationEvent.updateMany({
      where: { id: { in: ids } },
      data: { resolvedAt: now, resolvedById: resolvedById || null },
    }),
    prisma.notificationRecipient.updateMany({
      where: { eventId: { in: ids }, resolvedAt: null },
      data: { resolvedAt: now },
    }),
  ])
  return ids.length
}

export async function findActiveUsersByRoles(roles: string[]) {
  if (!roles.length) return []
  return prisma.user.findMany({
    where: { isActive: true, role: { in: roles as any } },
    select: { id: true, username: true, email: true, phone: true, role: true },
  })
}
