import 'server-only'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { buildNotifyRows, type AppNotification } from '@/lib/in-app-notifications'
import {
  draftLeadFromInboundEmail,
  pickRoundRobinOwner,
  pickStickyOwnerFromPriorLeads,
  shouldSkipInboundEmail,
} from '@/lib/crm/sales-inbox-leads'
import {
  fetchSalesInboxEmails,
  markSalesInboxUidsSeen,
  resolveSalesImapConfig,
  salesInboxConfigured,
} from '@/lib/crm/sales-inbox-imap'
import { storeLeadEmailAttachments } from '@/lib/crm/lead-attachments'

const RR_KEY = 'deed_salesLeadRoundRobin'
const SALES_ROLES = ['sales_rep', 'sales'] as const

export interface SalesInboxProcessResult {
  configured: boolean
  autoAssign: boolean
  fetched: number
  created: number
  skipped: number
  duplicates: number
  errors: string[]
  createdLeads: Array<{ id: string; name: string; email: string | null; ownerId: string | null }>
}

function readAutoAssignFlag(systemSettingsRaw: unknown): boolean {
  if (!systemSettingsRaw || typeof systemSettingsRaw !== 'object') return true
  const v = (systemSettingsRaw as Record<string, unknown>).crmAutoAssignLeads
  if (v === undefined || v === null) return true
  return Boolean(v)
}

function readLastOwnerId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const id = (raw as Record<string, unknown>).lastOwnerId
  return typeof id === 'string' && id ? id : null
}

/**
 * Poll sales@ IMAP, create CRM leads, round-robin assign sales reps when enabled.
 */
export async function processSalesInboxLeads(opts?: {
  limit?: number
  includeRecentSeen?: boolean
  lookbackHours?: number
  dryRun?: boolean
}): Promise<SalesInboxProcessResult> {
  const result: SalesInboxProcessResult = {
    configured: false,
    autoAssign: true,
    fetched: 0,
    created: 0,
    skipped: 0,
    duplicates: 0,
    errors: [],
    createdLeads: [],
  }

  const config = resolveSalesImapConfig()
  if (!config) {
    result.errors.push('Sales IMAP not configured (set SALES_IMAP_PASS or SALES_SMTP_PASS)')
    return result
  }
  result.configured = true

  const state = await loadAppState(['deed_systemSettings', RR_KEY, 'deed_notifications'])
  result.autoAssign = readAutoAssignFlag(state.deed_systemSettings)
  let lastOwnerId = readLastOwnerId(state[RR_KEY])

  const salesReps = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: [...SALES_ROLES] },
    },
    select: { id: true, username: true },
    orderBy: { username: 'asc' },
  })
  const salesRepIds = salesReps.map(u => u.id)

  let messages
  try {
    messages = await fetchSalesInboxEmails({
      config,
      limit: opts?.limit,
      includeRecentSeen: opts?.includeRecentSeen,
      lookbackHours: opts?.lookbackHours,
    })
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : 'IMAP fetch failed')
    return result
  }

  result.fetched = messages.length
  const seenUids: number[] = []

  for (const mail of messages) {
    const skip = shouldSkipInboundEmail(mail)
    if (skip.skip) {
      result.skipped += 1
      seenUids.push(mail.uid)
      continue
    }

    const existing = await prisma.lead.findFirst({
      where: { inboundMessageId: mail.messageId.slice(0, 500) },
      select: { id: true },
    })
    if (existing) {
      result.duplicates += 1
      seenUids.push(mail.uid)
      continue
    }

    const draft = draftLeadFromInboundEmail(mail)
    let ownerId: string | null = null
    if (result.autoAssign) {
      // Same organization/domain always keeps the same owner when possible.
      const prior = await prisma.lead.findMany({
        where: {
          ownerId: { not: null },
          OR: [
            { email: { not: null } },
            { companyName: { not: null } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { ownerId: true, email: true, companyName: true },
      })
      const sticky = pickStickyOwnerFromPriorLeads(prior, draft, salesRepIds)
      if (sticky) {
        ownerId = sticky
      } else {
        ownerId = pickRoundRobinOwner(salesRepIds, lastOwnerId)
        if (ownerId) lastOwnerId = ownerId
      }
    }

    if (opts?.dryRun) {
      result.created += 1
      result.createdLeads.push({
        id: 'dry-run',
        name: draft.name,
        email: draft.email,
        ownerId,
      })
      seenUids.push(mail.uid)
      continue
    }

    try {
      const lead = await prisma.lead.create({
        data: {
          name: draft.name,
          companyName: draft.companyName,
          email: draft.email,
          source: draft.source,
          stage: 'new',
          ownerId,
          notes: draft.notes,
          inboundMessageId: draft.inboundMessageId,
          emailSubject: draft.emailSubject,
          emailSnippet: draft.emailSnippet,
          emailBody: draft.emailBody,
          emailReceivedAt: draft.emailReceivedAt ? new Date(draft.emailReceivedAt) : null,
          emailAttachments: [],
        },
        select: { id: true, name: true, email: true, ownerId: true },
      })

      let attachmentMeta: Awaited<ReturnType<typeof storeLeadEmailAttachments>> = []
      try {
        attachmentMeta = await storeLeadEmailAttachments(lead.id, draft.attachments)
        if (attachmentMeta.length > 0) {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { emailAttachments: attachmentMeta },
          })
        }
      } catch (attErr) {
        result.errors.push(
          `${mail.messageId}: attachments ${attErr instanceof Error ? attErr.message : 'store failed'}`,
        )
      }

      result.created += 1
      result.createdLeads.push(lead)
      seenUids.push(mail.uid)

      if (ownerId) {
        try {
          const existingNotifs = Array.isArray(state.deed_notifications)
            ? state.deed_notifications as AppNotification[]
            : []
          const subjectBit = draft.emailSubject ? ` · ${draft.emailSubject}` : ''
          const attBit = attachmentMeta.length > 0 ? ` · ${attachmentMeta.length} attachment(s)` : ''
          const { next } = buildNotifyRows(existingNotifs, {
            recipients: [ownerId],
            type: 'assignment',
            title: 'New inbound sales lead',
            body: `${lead.name}${lead.email ? ` · ${lead.email}` : ''}${subjectBit}${attBit}`,
            module: 'crm',
            path: '/crm?tab=leads',
            entityKey: `lead:${lead.id}:inbound`,
            icon: '📬',
          }, () => randomUUID())
          state.deed_notifications = next
        } catch {
          /* notification is best-effort */
        }
      }

      // Sticky assignments intentionally do not advance the round-robin cursor.
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'lead create failed'
      // Unique violation → treat as duplicate
      if (typeof err === 'object' && err && 'code' in err && (err as { code?: string }).code === 'P2002') {
        result.duplicates += 1
        seenUids.push(mail.uid)
      } else {
        result.errors.push(`${mail.messageId}: ${msg}`)
      }
    }
  }

  if (!opts?.dryRun) {
    const saves: Record<string, string> = {}
    if (result.autoAssign && lastOwnerId) {
      saves[RR_KEY] = JSON.stringify({ lastOwnerId, updatedAt: new Date().toISOString() })
    }
    if (Array.isArray(state.deed_notifications) && result.created > 0) {
      saves.deed_notifications = JSON.stringify(state.deed_notifications)
    }
    if (Object.keys(saves).length > 0) {
      await saveStoreKeys(saves)
    }
    try {
      await markSalesInboxUidsSeen(config, seenUids)
    } catch (err) {
      result.errors.push(err instanceof Error ? `mark-seen: ${err.message}` : 'mark-seen failed')
    }
  }

  return result
}

export { salesInboxConfigured }

/** Stable id helper for tests. */
export function newEntityId() {
  return randomUUID()
}
