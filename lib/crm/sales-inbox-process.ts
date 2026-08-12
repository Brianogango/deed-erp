import 'server-only'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { buildNotifyRows, type AppNotification } from '@/lib/in-app-notifications'
import {
  draftLeadFromInboundEmail,
  pickRoundRobinOwner,
  pickStickyOwnerFromPriorLeads,
  type ParsedInboundEmail,
} from '@/lib/crm/sales-inbox-leads'
import {
  fetchSalesInboxEmails,
  markSalesInboxUidsSeen,
  resolveSalesImapConfig,
} from '@/lib/crm/sales-inbox-imap'
import { storeLeadEmailAttachments } from '@/lib/crm/lead-attachments'
import { notifyInboundLeadCreated } from '@/lib/crm/sales-inbox-notifications'
import { resolveSalesInboxPipelineConfig } from '@/lib/crm/inbox/config'
import {
  decideInboundEmailPipeline,
  pipelineAuditNote,
  type ExistingLeadRef,
} from '@/lib/crm/inbox/pipeline'
import { normalizeEmail, normalizePhoneE164, phoneMatchKey, resolveThreadId } from '@/lib/crm/inbox/normalize'
import type { ContactCandidate } from '@/lib/crm/inbox/contact-resolve'

const RR_KEY = 'deed_salesLeadRoundRobin'
const SALES_ROLES = ['sales_rep', 'sales'] as const

export interface SalesInboxProcessResult {
  configured: boolean
  autoAssign: boolean
  mode: string
  fetched: number
  created: number
  skipped: number
  reviewQueued: number
  duplicates: number
  linked: number
  nonSales: number
  errors: string[]
  createdLeads: Array<{
    id: string
    name: string
    email: string | null
    ownerId: string | null
    stage?: string
    disposition?: string
    decision?: string
  }>
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

async function findThreadLead(threadId: string): Promise<ExistingLeadRef | null> {
  if (!threadId) return null
  try {
    const lead = await prisma.lead.findFirst({
      where: { inboundThreadId: threadId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        stage: true,
        inboundThreadId: true,
        email: true,
        name: true,
        companyName: true,
        clientId: true,
      },
    })
    return lead
  } catch {
    // Column may not exist until migration — fall back to message-id only.
    return null
  }
}

async function loadContactCandidates(email: string | null, phone: string | null): Promise<ContactCandidate[]> {
  const or: Array<Record<string, unknown>> = []
  if (email) or.push({ email: { equals: email, mode: 'insensitive' } })
  const phoneKey = phoneMatchKey(phone)
  if (phoneKey) {
    or.push({ phone: { contains: phoneKey.slice(-7) } })
    or.push({ phoneAlt: { contains: phoneKey.slice(-7) } })
  }
  if (or.length === 0) return []
  try {
    const rows = await prisma.client.findMany({
      where: { isActive: true, OR: or as any },
      take: 25,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        phoneAlt: true,
        companyName: true,
        website: true,
      },
    })
    return rows
  } catch {
    return []
  }
}

async function recordInboundEmail(opts: {
  mailbox: string
  mail: ParsedInboundEmail
  threadId: string
  decision: string
  status: string
  reason: string
  classification?: string | null
  confidence?: number | null
  classifierVersion: string
  leadId?: string | null
  clientId?: string | null
  dryRun?: boolean
}): Promise<'ok' | 'duplicate' | 'unavailable'> {
  if (opts.dryRun) return 'ok'
  try {
    await prisma.salesInboundEmail.create({
      data: {
        provider: 'IMAP',
        mailbox: opts.mailbox.slice(0, 200),
        providerMessageId: opts.mail.messageId.slice(0, 500),
        providerThreadId: opts.threadId.slice(0, 500),
        internetMessageId: opts.mail.messageId.slice(0, 500),
        fromEmail: normalizeEmail(opts.mail.fromEmail),
        fromName: (opts.mail.fromName || '').slice(0, 200) || null,
        subject: (opts.mail.subject || '').slice(0, 500) || null,
        receivedAt: opts.mail.dateIso ? new Date(opts.mail.dateIso) : null,
        processingStatus: opts.status.slice(0, 40),
        processingReason: opts.reason.slice(0, 200),
        classification: opts.classification?.slice(0, 60) || null,
        confidence: opts.confidence ?? null,
        classifierVersion: opts.classifierVersion.slice(0, 40),
        leadId: opts.leadId || null,
        clientId: opts.clientId || null,
        decision: opts.decision.slice(0, 40),
        processedAt: new Date(),
        rawMeta: {
          hasAttachments: (opts.mail.attachments ?? []).length > 0,
          attachmentNames: (opts.mail.attachments ?? []).map(a => a.filename).slice(0, 10),
        },
      },
    })
    return 'ok'
  } catch (err: any) {
    if (err?.code === 'P2002') return 'duplicate'
    // Table missing until migration applied
    if (String(err?.message || '').includes('sales_inbound_emails') || err?.code === 'P2021') {
      return 'unavailable'
    }
    throw err
  }
}

/**
 * Poll sales@ IMAP through the foolproof pipeline:
 * idempotency → normalize → hard exclude → thread → classify → contact → create/review/ignore.
 */
export async function processSalesInboxLeads(opts?: {
  limit?: number
  includeRecentSeen?: boolean
  lookbackHours?: number
  dryRun?: boolean
}): Promise<SalesInboxProcessResult> {
  const pipelineConfig = resolveSalesInboxPipelineConfig()
  const result: SalesInboxProcessResult = {
    configured: false,
    autoAssign: true,
    mode: pipelineConfig.mode,
    fetched: 0,
    created: 0,
    skipped: 0,
    reviewQueued: 0,
    duplicates: 0,
    linked: 0,
    nonSales: 0,
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
    where: { isActive: true, role: { in: [...SALES_ROLES] } },
    select: { id: true, username: true, email: true },
    orderBy: { username: 'asc' },
  })
  const salesRepIds = salesReps.map(u => u.id)
  const salesRepById = new Map(salesReps.map(u => [u.id, u]))

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
    const messageId = mail.messageId.slice(0, 500)
    const threadId = resolveThreadId({
      providerThreadId: mail.providerThreadId,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      messageId: mail.messageId,
    })

    // Idempotency: sales_inbound_emails unique + lead inboundMessageId
    let alreadyProcessed = false
    try {
      const prior = await prisma.salesInboundEmail.findFirst({
        where: {
          provider: 'IMAP',
          mailbox: config.mailbox,
          providerMessageId: messageId,
        },
        select: { id: true },
      })
      if (prior) alreadyProcessed = true
    } catch {
      /* table may be missing */
    }
    if (!alreadyProcessed) {
      const existingLead = await prisma.lead.findFirst({
        where: { inboundMessageId: messageId },
        select: { id: true },
      })
      if (existingLead) alreadyProcessed = true
    }

    const threadLead = await findThreadLead(threadId)
    const draftPreview = draftLeadFromInboundEmail(mail)
    const candidates = await loadContactCandidates(
      normalizeEmail(mail.fromEmail),
      null,
    )

    const decision = decideInboundEmailPipeline({
      mail,
      alreadyProcessed,
      threadLead,
      contactCandidates: candidates,
      config: pipelineConfig,
    })

    if (decision.decision === 'ALREADY_PROCESSED') {
      result.duplicates += 1
      seenUids.push(mail.uid)
      continue
    }

    if (decision.decision === 'HARD_FILTERED' || decision.decision === 'NON_SALES') {
      if (decision.decision === 'HARD_FILTERED') result.skipped += 1
      else result.nonSales += 1
      await recordInboundEmail({
        mailbox: config.mailbox,
        mail,
        threadId,
        decision: decision.decision,
        status: decision.processingStatus,
        reason: decision.processingReason,
        classification: decision.classification?.classification,
        confidence: decision.classification?.confidence,
        classifierVersion: pipelineConfig.classifierVersion,
        dryRun: opts?.dryRun,
      })
      seenUids.push(mail.uid)
      continue
    }

    if (decision.decision === 'LINK_EXISTING_LEAD' && decision.shouldLinkLeadId) {
      result.linked += 1
      if (!opts?.dryRun) {
        try {
          const existing = await prisma.lead.findUnique({
            where: { id: decision.shouldLinkLeadId },
            select: { notes: true },
          })
          const append = `\n\n---\nFollow-up email ${mail.dateIso || ''}\nSubject: ${mail.subject}\n${(mail.textBody || '').slice(0, 1500)}`
          await prisma.lead.update({
            where: { id: decision.shouldLinkLeadId },
            data: {
              notes: `${existing?.notes || ''}${append}`.slice(0, 20000),
              inboundThreadId: threadId,
            },
          })
        } catch (err) {
          result.errors.push(err instanceof Error ? err.message : 'thread link failed')
        }
      }
      await recordInboundEmail({
        mailbox: config.mailbox,
        mail,
        threadId,
        decision: decision.decision,
        status: decision.processingStatus,
        reason: decision.processingReason,
        classification: decision.classification?.classification,
        confidence: decision.classification?.confidence,
        classifierVersion: pipelineConfig.classifierVersion,
        leadId: decision.shouldLinkLeadId,
        dryRun: opts?.dryRun,
      })
      seenUids.push(mail.uid)
      continue
    }

    if (decision.decision === 'SHADOW_RECORDED') {
      result.nonSales += 1
      await recordInboundEmail({
        mailbox: config.mailbox,
        mail,
        threadId,
        decision: decision.decision,
        status: decision.processingStatus,
        reason: decision.processingReason,
        classification: decision.classification?.classification,
        confidence: decision.classification?.confidence,
        classifierVersion: pipelineConfig.classifierVersion,
        dryRun: opts?.dryRun,
      })
      seenUids.push(mail.uid)
      continue
    }

    // CREATE lead (auto or needs_review)
    if (!decision.shouldCreateLead) {
      result.skipped += 1
      seenUids.push(mail.uid)
      continue
    }

    const needsReview = decision.decision === 'REVIEW_REQUIRED'
    const stage = needsReview ? 'needs_review' : 'new'
    const draft = draftLeadFromInboundEmail(mail)
    const title = decision.leadTitle || draft.name
    draft.name = title
    draft.companyName = decision.companyName || draft.companyName
    draft.notes = `${pipelineAuditNote(decision)}\n\n${draft.notes}`

    let ownerId: string | null = null
    if (result.autoAssign && decision.shouldNotifyAssign && !needsReview) {
      const prior = await prisma.lead.findMany({
        where: {
          ownerId: { not: null },
          OR: [{ email: { not: null } }, { companyName: { not: null } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { ownerId: true, email: true, companyName: true },
      })
      const sticky = pickStickyOwnerFromPriorLeads(prior, draft, salesRepIds)
      if (sticky) ownerId = sticky
      else {
        ownerId = pickRoundRobinOwner(salesRepIds, lastOwnerId)
        if (ownerId) lastOwnerId = ownerId
      }
    }

    if (opts?.dryRun) {
      result.created += 1
      if (needsReview) result.reviewQueued += 1
      result.createdLeads.push({
        id: 'dry-run',
        name: draft.name,
        email: draft.email,
        ownerId,
        stage,
        disposition: needsReview ? 'review' : 'accept',
        decision: decision.decision,
      })
      seenUids.push(mail.uid)
      continue
    }

    try {
      const clientId = decision.contact.matched?.id || null
      // Safe enrich missing phone only (Invariant: no silent overwrite)
      if (clientId && decision.contact.enrich.phone) {
        try {
          await prisma.client.update({
            where: { id: clientId },
            data: { phone: decision.contact.enrich.phone.slice(0, 20) },
          })
        } catch { /* ignore enrich failure */ }
      }

      const lead = await prisma.lead.create({
        data: {
          name: draft.name,
          companyName: draft.companyName,
          email: draft.email,
          phone: decision.identity.phone ? normalizePhoneE164(decision.identity.phone)?.slice(0, 20) : null,
          source: draft.source,
          stage,
          ownerId,
          clientId,
          notes: draft.notes,
          inboundMessageId: draft.inboundMessageId,
          inboundThreadId: threadId,
          emailSubject: draft.emailSubject,
          emailSnippet: draft.emailSnippet,
          emailBody: draft.emailBody,
          emailReceivedAt: draft.emailReceivedAt ? new Date(draft.emailReceivedAt) : null,
          emailAttachments: [],
        },
      })

      result.created += 1
      if (needsReview) result.reviewQueued += 1
      result.createdLeads.push({
        id: lead.id,
        name: lead.name,
        email: lead.email,
        ownerId,
        stage,
        disposition: needsReview ? 'review' : 'accept',
        decision: decision.decision,
      })

      await recordInboundEmail({
        mailbox: config.mailbox,
        mail,
        threadId,
        decision: decision.decision,
        status: decision.processingStatus,
        reason: decision.processingReason,
        classification: decision.classification?.classification,
        confidence: decision.classification?.confidence,
        classifierVersion: pipelineConfig.classifierVersion,
        leadId: lead.id,
        clientId,
      })

      try {
        const stored = await storeLeadEmailAttachments(lead.id, draft.attachments)
        if (stored.length > 0) {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { emailAttachments: stored },
          })
        }
      } catch (attErr) {
        result.errors.push(attErr instanceof Error ? attErr.message : 'attachment store failed')
      }

      if (ownerId && decision.shouldNotifyAssign) {
        const owner = salesRepById.get(ownerId)
        const notif: Omit<AppNotification, 'id' | 'createdAt' | 'read' | 'readAt'> = {
          userId: ownerId,
          type: 'system',
          title: 'New inbound lead',
          body: `${lead.name}${lead.companyName ? ` · ${lead.companyName}` : ''}`,
          module: 'crm',
          path: `/crm?tab=leads&leadId=${lead.id}`,
          icon: '📧',
          entityKey: `lead:${lead.id}`,
        }
        const rows = buildNotifyRows([ownerId], notif)
        const existing = Array.isArray(state.deed_notifications) ? state.deed_notifications as AppNotification[] : []
        state.deed_notifications = [...rows, ...existing].slice(0, 500)
        try {
          await notifyInboundLeadCreated({
            lead: {
              id: lead.id,
              name: lead.name,
              companyName: lead.companyName,
              email: lead.email,
              emailSubject: lead.emailSubject,
            },
            ownerEmail: owner?.email || null,
            ownerName: owner?.username || null,
          })
        } catch (notifyErr) {
          result.errors.push(notifyErr instanceof Error ? notifyErr.message : 'notify failed')
        }
      }

      seenUids.push(mail.uid)
    } catch (err: any) {
      if (err?.code === 'P2002') {
        result.duplicates += 1
        seenUids.push(mail.uid)
      } else {
        result.errors.push(err instanceof Error ? err.message : 'lead create failed')
      }
    }
  }

  if (!opts?.dryRun && seenUids.length > 0) {
    try {
      await markSalesInboxUidsSeen(config, seenUids)
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : 'mark seen failed')
    }
  }

  if (!opts?.dryRun && lastOwnerId) {
    try {
      await saveStoreKeys({ [RR_KEY]: { lastOwnerId } })
    } catch { /* ignore */ }
    if (Array.isArray(state.deed_notifications)) {
      try {
        await saveStoreKeys({ deed_notifications: state.deed_notifications })
      } catch { /* ignore */ }
    }
  }

  return result
}

export { salesInboxConfigured } from '@/lib/crm/sales-inbox-imap'
