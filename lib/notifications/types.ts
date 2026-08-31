import type { Prisma } from '@prisma/client'

export type NotificationChannel = 'in_app' | 'email' | 'whatsapp' | 'sms' | 'push'
export type NotificationSeverity = 'info' | 'success' | 'attention' | 'warning' | 'critical'
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'

export type ExternalNotificationRecipient = {
  name?: string | null
  email?: string | null
  phone?: string | null
  channels?: NotificationChannel[]
}

export type NotificationPolicy = {
  channels: NotificationChannel[]
  recipientRoles?: string[]
  severity: NotificationSeverity
  priority: NotificationPriority
  requiresAcknowledgement?: boolean
  escalationMinutes?: number
  escalationRoles?: string[]
  fallbackSms?: boolean
  mandatory?: boolean
  /** Channels that must deliver for this event even when the user's optional channel preference is off. */
  mandatoryChannels?: NotificationChannel[]
}

export type PublishNotificationInput = {
  eventType: string
  entityType?: string | null
  entityId?: string | null
  actorUserId?: string | null
  userIds?: Array<string | null | undefined>
  roles?: string[]
  externalRecipients?: ExternalNotificationRecipient[]
  channels?: NotificationChannel[]
  severity?: NotificationSeverity
  priority?: NotificationPriority
  title: string
  body: string
  actionUrl?: string | null
  metadata?: Prisma.InputJsonValue
  idempotencyKey: string
  excludeActor?: boolean
  requiresAcknowledgement?: boolean
  dueAt?: Date | string | null
  escalateAt?: Date | string | null
}

export type NotificationRouting = {
  userIds: string[]
  externalRecipients: ExternalNotificationRecipient[]
  channels?: NotificationChannel[]
}

export type NotificationChannelContent = {
  subject?: string
  text: string
  html?: string
}

export type ProviderSendResult = {
  success: boolean
  provider: string
  messageId?: string
  error?: string
  errorCode?: string
  response?: Record<string, unknown>
  acceptedAsDelivered?: boolean
}
