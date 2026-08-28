import 'server-only'

import prisma from '@/lib/prisma'
import type { NotificationChannel } from './types'

type EventLike = {
  eventType: string
  title: string
  body: string
  actionUrl?: string | null
  metadata?: unknown
  entityType?: string | null
  entityId?: string | null
  severity?: string | null
  priority?: string | null
}

export type RenderedNotificationTemplate = {
  subject: string
  text: string
  templateId?: string
  templateVersion?: number
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function lookupPath(source: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').map(p => p.trim()).filter(Boolean)
  let cursor: unknown = source
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}

function interpolate(template: string, vars: Record<string, unknown>) {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string) => {
    const value = lookupPath(vars, key)
    if (value === undefined || value === null) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    try { return JSON.stringify(value) } catch { return '' }
  })
}

export async function renderNotificationTemplate(
  event: EventLike,
  channel: NotificationChannel,
): Promise<RenderedNotificationTemplate> {
  const template = await prisma.notificationTemplate.findFirst({
    where: {
      channel,
      isActive: true,
      eventType: { in: [event.eventType, '*'] },
    },
    orderBy: [
      // exact event beats wildcard
      { eventType: 'desc' },
      { version: 'desc' },
    ],
  })

  const metadata = asRecord(event.metadata)
  const vars: Record<string, unknown> = {
    title: event.title,
    body: event.body,
    actionUrl: event.actionUrl || '',
    eventType: event.eventType,
    entityType: event.entityType || '',
    entityId: event.entityId || '',
    severity: event.severity || '',
    priority: event.priority || '',
    metadata,
    ...metadata,
  }

  if (!template) {
    return { subject: event.title, text: event.body }
  }

  return {
    subject: interpolate(template.subjectTemplate || '{{title}}', vars) || event.title,
    text: interpolate(template.bodyTemplate || '{{body}}', vars) || event.body,
    templateId: template.id,
    templateVersion: template.version,
  }
}
