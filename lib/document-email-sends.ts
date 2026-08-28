import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'

/**
 * Compatibility facade for document-send history.
 *
 * The old implementation stored a bounded array in app_state under
 * deed_documentEmailSends. History is now durable and relational:
 * notification_events = document-send audit record
 * notification_deliveries = per-channel provider attempt/result
 */
export const DOCUMENT_EMAIL_SENDS_KEY = 'deed_documentEmailSends'

export type DocumentEmailDocumentType = 'quote' | 'invoice' | 'bill' | 'rfq' | 'payment_receipt'

export type DocumentEmailSendStatus = 'success' | 'failed'

export interface DocumentEmailSend {
  id: string
  documentType: DocumentEmailDocumentType
  documentId: string
  documentRef: string
  to: string
  cc: string[]
  subject?: string
  status: DocumentEmailSendStatus
  error?: string
  messageId?: string
  channel?: 'email' | 'whatsapp'
  kind?: 'initial' | 'update'
  sentById?: string
  sentByName?: string
  sentAt: string
}

/** Split a free-text CC field into unique email addresses. */
export function parseEmailList(raw?: string | string[] | null): string[] {
  const parts = Array.isArray(raw)
    ? raw.flatMap(v => String(v).split(/[,;\s]+/))
    : String(raw ?? '').split(/[,;\s]+/)
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const email = part.trim()
    if (!email || !email.includes('@')) continue
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(email)
  }
  return out
}

function meta(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function isSuccessfulDelivery(status: string) {
  return ['sent', 'delivered', 'read'].includes(status)
}

function providerForChannel(channel: 'email' | 'whatsapp') {
  if (channel === 'whatsapp') return 'whatsapp'
  const configured = String(process.env.EMAIL_PROVIDER || 'smtp').trim().toLowerCase()
  if (configured === 'sendgrid') return 'sendgrid'
  if (configured === 'ses') return 'ses'
  return 'smtp'
}

export async function listDocumentEmailSends(filters?: {
  documentId?: string
  documentType?: DocumentEmailDocumentType
  limit?: number
}): Promise<DocumentEmailSend[]> {
  const limit = Math.max(1, Math.min(filters?.limit ?? 200, 500))
  const rows = await prisma.notificationDelivery.findMany({
    where: {
      event: {
        eventType: 'document.send',
        ...(filters?.documentId ? { entityId: filters.documentId } : {}),
        ...(filters?.documentType ? { entityType: filters.documentType } : {}),
      },
    },
    include: {
      event: {
        select: {
          entityType: true,
          entityId: true,
          actorUserId: true,
          title: true,
          metadata: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return rows.map(row => {
    const eventMeta = meta(row.event.metadata)
    const deliveryMeta = meta(row.metadata)
    return {
      id: row.id,
      documentType: String(row.event.entityType || eventMeta.documentType || 'invoice') as DocumentEmailDocumentType,
      documentId: String(row.event.entityId || eventMeta.documentId || ''),
      documentRef: String(eventMeta.documentRef || ''),
      to: String(row.destination || ''),
      cc: Array.isArray(deliveryMeta.cc) ? deliveryMeta.cc.map(String) : [],
      subject: String(eventMeta.subject || row.event.title || '') || undefined,
      status: isSuccessfulDelivery(row.status) ? 'success' : 'failed',
      error: row.lastError || undefined,
      messageId: row.providerMessageId || undefined,
      channel: row.channel === 'whatsapp' ? 'whatsapp' : 'email',
      kind: deliveryMeta.kind === 'update' ? 'update' : deliveryMeta.kind === 'initial' ? 'initial' : undefined,
      sentById: row.event.actorUserId || undefined,
      sentByName: eventMeta.sentByName ? String(eventMeta.sentByName) : undefined,
      sentAt: (row.sentAt || row.createdAt || row.event.createdAt).toISOString(),
    }
  })
}

export async function appendDocumentEmailSend(
  input: Omit<DocumentEmailSend, 'id' | 'sentAt' | 'cc'> & {
    cc?: string[]
    sentAt?: string
  },
): Promise<DocumentEmailSend> {
  const sentAt = input.sentAt ? new Date(input.sentAt) : new Date()
  const normalizedSentAt = Number.isNaN(sentAt.getTime()) ? new Date() : sentAt
  const eventId = randomUUID()
  const deliveryId = randomUUID()
  const channel = input.channel ?? 'email'
  const successful = input.status === 'success'
  const idempotencyKey = `document-send:${input.documentType}:${input.documentId}:${deliveryId}`

  await prisma.$transaction(async tx => {
    await tx.notificationEvent.create({
      data: {
        id: eventId,
        eventType: 'document.send',
        entityType: input.documentType,
        entityId: input.documentId,
        actorUserId: input.sentById || null,
        severity: successful ? 'success' : 'warning',
        priority: successful ? 'normal' : 'high',
        title: input.subject || `${input.documentRef} document send`,
        body: successful
          ? `${input.documentRef} sent via ${channel}.`
          : `${input.documentRef} failed to send via ${channel}.`,
        metadata: {
          documentType: input.documentType,
          documentId: input.documentId,
          documentRef: input.documentRef,
          subject: input.subject || null,
          sentByName: input.sentByName || null,
        },
        routing: {},
        idempotencyKey,
        createdAt: normalizedSentAt,
        updatedAt: normalizedSentAt,
      },
    })
    await tx.notificationDelivery.create({
      data: {
        id: deliveryId,
        eventId,
        channel,
        destination: input.to,
        provider: providerForChannel(channel),
        providerMessageId: input.messageId || null,
        status: successful ? 'sent' : 'failed',
        attemptCount: 1,
        lastAttemptAt: normalizedSentAt,
        sentAt: successful ? normalizedSentAt : null,
        failedAt: successful ? null : normalizedSentAt,
        lastError: input.error || null,
        idempotencyKey: `${idempotencyKey}:${channel}`,
        metadata: {
          cc: input.cc ?? [],
          kind: input.kind || null,
          source: 'document-send-compat',
        },
        createdAt: normalizedSentAt,
        updatedAt: normalizedSentAt,
      },
    })
  })

  return {
    id: deliveryId,
    sentAt: normalizedSentAt.toISOString(),
    cc: input.cc ?? [],
    documentType: input.documentType,
    documentId: input.documentId,
    documentRef: input.documentRef,
    to: input.to,
    subject: input.subject,
    status: input.status,
    error: input.error,
    messageId: input.messageId,
    channel,
    kind: input.kind,
    sentById: input.sentById,
    sentByName: input.sentByName,
  }
}
