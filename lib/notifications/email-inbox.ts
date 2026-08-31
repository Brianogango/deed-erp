import 'server-only'

import prisma from '@/lib/prisma'
import {
  fetchSalesInboxEmails,
  markSalesInboxUidsSeen,
  type SalesImapConfig,
} from '@/lib/crm/sales-inbox-imap'
import { recordInboundEmail } from './email-conversations'
import { publishNotificationEvent } from './service'

export type DepartmentMailbox = 'accounts' | 'hr' | 'repairs' | 'procurement' | 'default'

function clean(value?: string) {
  return String(value || '').trim().replace(/^"|"$/g, '')
}

function envBool(value: string | undefined, fallback: boolean) {
  if (value == null || value === '') return fallback
  return !['0', 'false', 'no'].includes(String(value).toLowerCase())
}

function profileDefaults(profile: DepartmentMailbox) {
  if (profile === 'accounts') return { email: 'accounts@deed.co.ke', prefix: 'ACCOUNTS' }
  if (profile === 'hr') return { email: 'hr@deed.co.ke', prefix: 'HR' }
  if (profile === 'repairs') return { email: 'repairs@deed.co.ke', prefix: 'REPAIRS' }
  if (profile === 'procurement') return { email: 'procurement@deed.co.ke', prefix: 'PROCUREMENT' }
  return { email: process.env.EMAIL_FROM || process.env.SMTP_USER || 'hello@deed.co.ke', prefix: 'DEFAULT' }
}

export function resolveDepartmentImapConfig(
  profile: DepartmentMailbox,
  env: NodeJS.ProcessEnv = process.env,
): SalesImapConfig | null {
  const defaults = profileDefaults(profile)
  const prefix = defaults.prefix

  const user = clean(
    env[`${prefix}_IMAP_USER`]
    || env[`${prefix}_SMTP_USER`]
    || env[profile === 'default' ? 'SMTP_USER' : `${prefix}_EMAIL`]
    || defaults.email,
  )

  const pass = clean(
    env[`${prefix}_IMAP_PASS`]
    || env[`${prefix}_SMTP_PASS`]
    || (profile === 'default' ? env.SMTP_PASS : undefined),
  )
  if (!user || !pass) return null

  const host = clean(
    env[`${prefix}_IMAP_HOST`]
    || env.SMTP_HOST
    || 'mail.deed.co.ke',
  )
  const port = Math.max(1, Number(env[`${prefix}_IMAP_PORT`] || 993) || 993)
  const secure = envBool(env[`${prefix}_IMAP_SECURE`], port === 993)

  return {
    host,
    port,
    secure,
    user,
    pass,
    mailbox: clean(env[`${prefix}_IMAP_MAILBOX`] || 'INBOX') || 'INBOX',
  }
}

function recipientsForMailbox(profile: DepartmentMailbox) {
  if (profile === 'accounts') return ['finance_officer', 'director']
  if (profile === 'hr') return ['admin_officer', 'director']
  if (profile === 'repairs') return ['technical_lead', 'admin_officer', 'director']
  if (profile === 'procurement') return ['inventory_officer', 'admin_officer', 'director']
  return ['admin_officer', 'director']
}

function actionUrl(entityType?: string | null, entityId?: string | null) {
  if (!entityId) return '/settings'
  if (entityType === 'repair') return `/repairs?id=${entityId}`
  if (entityType === 'invoice' || entityType === 'bill' || entityType === 'payment') return `/accounting?invoice=${entityId}`
  if (entityType === 'quote') return `/sales?quote=${entityId}`
  if (entityType === 'lead') return `/crm?crmTab=leads&leadId=${entityId}`
  if (entityType === 'purchase_order') return `/purchase?po=${entityId}`
  return '/settings'
}

export async function processDepartmentEmailReplies(opts?: {
  limitPerMailbox?: number
  profiles?: DepartmentMailbox[]
}) {
  const profiles = opts?.profiles || ['accounts', 'hr', 'repairs', 'procurement', 'default']
  const result: Record<string, { configured: boolean; fetched: number; recorded: number; errors: string[] }> = {}

  for (const profile of profiles) {
    const state = { configured: false, fetched: 0, recorded: 0, errors: [] as string[] }
    result[profile] = state
    const config = resolveDepartmentImapConfig(profile)
    if (!config) continue
    state.configured = true

    try {
      const messages = await fetchSalesInboxEmails({
        config,
        limit: Math.max(1, Math.min(opts?.limitPerMailbox || 20, 50)),
        includeRecentSeen: false,
      })
      state.fetched = messages.length
      const seen: number[] = []

      for (const mail of messages) {
        try {
          const sender = String(mail.fromEmail || '').trim().toLowerCase()
          // Never create an ERP conversation from mail sent by our own domain.
          if (sender.endsWith('@deed.co.ke') || sender.endsWith('@deedcomputers.co.ke')) {
            seen.push(mail.uid)
            continue
          }

          const message = await recordInboundEmail({
            provider: 'imap',
            providerMessageId: mail.messageId,
            internetMessageId: mail.messageId,
            from: mail.fromEmail,
            to: config.user,
            mailbox: profile,
            subject: mail.subject,
            body: mail.textBody || '',
            participantName: mail.fromName || null,
            inReplyTo: mail.inReplyTo || null,
            references: String(mail.references || '').split(/\s+/).map(v => v.trim()).filter(Boolean),
            metadata: {
              sourceMailbox: config.user,
              attachmentNames: (mail.attachments || []).map(a => a.filename).slice(0, 10),
            },
          })

          if (message) {
            state.recorded += 1
            const thread = await prisma.communicationThread.findUnique({
              where: { id: message.threadId },
            })

            await publishNotificationEvent({
              eventType: 'communication.email.reply_received',
              entityType: thread?.entityType || 'email_thread',
              entityId: thread?.entityId || thread?.id || message.threadId,
              roles: recipientsForMailbox(profile),
              title: `New email reply · ${profile}`,
              body: `${mail.fromName || mail.fromEmail}: ${mail.subject || 'No subject'}`,
              actionUrl: actionUrl(thread?.entityType, thread?.entityId),
              metadata: {
                communicationThreadId: message.threadId,
                mailbox: profile,
                fromEmail: mail.fromEmail,
                subject: mail.subject,
              },
              idempotencyKey: `email-reply-notice:${message.id}`,
              excludeActor: false,
            }).catch(error => console.error('[email inbox] could not publish reply notification', error))
          }
          seen.push(mail.uid)
        } catch (error) {
          state.errors.push(error instanceof Error ? error.message : 'message processing failed')
        }
      }

      if (seen.length) {
        await markSalesInboxUidsSeen(config, seen).catch(error => {
          state.errors.push(error instanceof Error ? error.message : 'mark seen failed')
        })
      }
    } catch (error) {
      state.errors.push(error instanceof Error ? error.message : 'IMAP fetch failed')
    }
  }

  return result
}
