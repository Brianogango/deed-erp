import 'server-only'

import { randomUUID } from 'crypto'
import path from 'path'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { getObject, putObject } from '@/lib/infra/object-store'
import { validateFileContent } from '@/lib/file-validation'
import { normalizeClientRole } from '@/lib/auth/access'
import { publishNotificationEvent } from '@/lib/notifications/service'
import {
  ACTION_ROLES, DOCUMENT_KINDS, DOCUMENT_RULES, OPEN_STATUSES, STANDARD_TERMS_DAYS,
  approvalCheck, canDecide, clientCreditStatus, documentChecklist, nextRef, nextStatus, reviewDueFrom,
  type CreditAction, type CreditFacilityStatus,
} from './credit-facility-rules'

export type Actor = { id: string; name?: string | null; role: string }

export class CreditFacilityError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

const money = (v: unknown) => (v == null ? null : Number(v))
const isoDay = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null)
const roleOf = (actor: Actor) => normalizeClientRole(actor.role)

/** Fully paid customer invoices — the payment policy's "successful transactions". */
export async function paidTransactionCount(clientId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM invoices
    WHERE client_id = ${clientId}::uuid AND document_type = 'customer_invoice'
      AND status::text NOT IN ('draft', 'cancelled', 'void', 'rejected')
      AND total_amount > 0 AND amount_paid >= total_amount`
  return Number(rows[0]?.n ?? 0)
}

type AppRow = Prisma.CreditFacilityApplicationGetPayload<{ include: { documents: true } }>

async function userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((v): v is string => Boolean(v)))]
  if (!wanted.length) return new Map()
  const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, username: true, employee: { select: { firstName: true, lastName: true } } } })
  return new Map(users.map(u => [u.id, [u.employee?.firstName, u.employee?.lastName].filter(Boolean).join(' ') || u.username]))
}

/** The application as the screens use it, with its checklist and approval check. */
export async function toScreen(app: AppRow, opts: { withChecks?: boolean } = {}) {
  const client = await prisma.client.findUnique({
    where: { id: app.clientId },
    select: { id: true, name: true, email: true, phone: true, kraPin: true, creditLimit: true, paymentTermsDays: true, creditStatus: true, creditReviewDue: true },
  })
  const names = await userNames([app.requestedById, app.recommendedById, app.decidedById, ...app.documents.map(d => d.uploadedById), ...app.documents.map(d => d.reviewedById)])
  const documents = app.documents
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(d => ({
      id: d.id, kind: d.kind, name: d.name, contentType: d.contentType, size: d.size, status: d.status,
      expiresOn: isoDay(d.expiresOn), note: d.note, uploadedVia: d.uploadedVia,
      uploadedBy: d.uploadedById ? names.get(d.uploadedById) ?? null : null,
      reviewedBy: d.reviewedById ? names.get(d.reviewedById) ?? null : null,
      createdAt: d.createdAt.toISOString(),
    }))
  const paidTransactions = opts.withChecks ? await paidTransactionCount(app.clientId) : app.paidTransactions ?? null
  const decisionLimit = money(app.approvedLimit) ?? money(app.recommendedLimit) ?? Number(app.requestedLimit)
  const decisionTerms = app.approvedTermsDays ?? app.recommendedTermsDays ?? app.requestedTermsDays
  return {
    id: app.id,
    ref: app.ref,
    clientId: app.clientId,
    client: client && {
      id: client.id, name: client.name, email: client.email, phone: client.phone, kraPin: client.kraPin,
      creditLimit: Number(client.creditLimit), paymentTermsDays: client.paymentTermsDays,
      creditStatus: client.creditStatus, creditReviewDue: isoDay(client.creditReviewDue),
    },
    status: app.status as CreditFacilityStatus,
    requestedLimit: Number(app.requestedLimit),
    requestedTermsDays: app.requestedTermsDays,
    form: app.form,
    assessment: app.assessment,
    riskClass: app.riskClass,
    recommendedLimit: money(app.recommendedLimit),
    recommendedTermsDays: app.recommendedTermsDays,
    approvedLimit: money(app.approvedLimit),
    approvedTermsDays: app.approvedTermsDays,
    conditions: app.conditions,
    decisionNote: app.decisionNote,
    requestedBy: app.requestedById ? names.get(app.requestedById) ?? null : null,
    requestedById: app.requestedById,
    recommendedBy: app.recommendedById ? names.get(app.recommendedById) ?? null : null,
    decidedBy: app.decidedById ? names.get(app.decidedById) ?? null : null,
    decidedAt: app.decidedAt?.toISOString() ?? null,
    reviewDue: isoDay(app.reviewDue),
    portalLink: app.portalToken ? { url: portalUrl(app.portalToken), expiresAt: app.portalExpiresAt?.toISOString() ?? null, expired: !app.portalExpiresAt || app.portalExpiresAt < new Date() } : null,
    events: app.events,
    documents,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    ...(opts.withChecks ? {
      paidTransactions,
      checklist: documentChecklist(documents),
      approval: approvalCheck({
        approvedLimit: decisionLimit,
        approvedTermsDays: decisionTerms,
        riskClass: app.riskClass,
        documents,
        paidTransactions: paidTransactions ?? 0,
      }),
    } : {}),
  }
}

export async function loadApplication(id: string): Promise<AppRow> {
  const app = await prisma.creditFacilityApplication.findUnique({ where: { id }, include: { documents: true } })
  if (!app) throw new CreditFacilityError('Credit application not found', 404)
  return app
}

export async function listApplications(filter: { clientId?: string | null; status?: string | null }) {
  const where: Prisma.CreditFacilityApplicationWhereInput = {}
  if (filter.clientId) where.clientId = filter.clientId
  if (filter.status === 'open') where.status = { in: OPEN_STATUSES }
  else if (filter.status) where.status = filter.status
  const rows = await prisma.creditFacilityApplication.findMany({ where, include: { documents: true }, orderBy: { updatedAt: 'desc' }, take: 200 })
  return Promise.all(rows.map(r => toScreen(r)))
}

const event = (actor: Actor, action: string, note?: string | null) =>
  ({ at: new Date().toISOString(), by: actor.id, byName: actor.name ?? null, action, ...(note ? { note } : {}) })

const appendEvent = (events: unknown, e: ReturnType<typeof event>) =>
  [...(Array.isArray(events) ? events : []), e] as Prisma.InputJsonValue

/** Tell every open contacts screen that the customer's credit changed. */
async function contactsChanged() {
  await import('@/lib/server-store').then(m => m.notifyStoreKeysChanged(['deed_contacts'])).catch(() => null)
}

export async function createApplication(actor: Actor, input: { clientId: string; requestedLimit?: number; requestedTermsDays?: number; note?: string }) {
  const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true, name: true } })
  if (!client) throw new CreditFacilityError('Customer not found', 404)
  const open = await prisma.creditFacilityApplication.findFirst({ where: { clientId: client.id, status: { in: OPEN_STATUSES } }, select: { ref: true } })
  if (open) throw new CreditFacilityError(`${client.name} already has an open credit application (${open.ref})`, 409)
  const year = new Date().getFullYear()
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await prisma.creditFacilityApplication.findFirst({ where: { ref: { startsWith: `CA/${year}/` } }, orderBy: { ref: 'desc' }, select: { ref: true } })
    try {
      const created = await prisma.creditFacilityApplication.create({
        data: {
          ref: nextRef(year, last?.ref),
          clientId: client.id,
          requestedLimit: Math.max(0, Number(input.requestedLimit) || 0),
          requestedTermsDays: Math.max(0, Math.trunc(Number(input.requestedTermsDays) || STANDARD_TERMS_DAYS)),
          requestedById: actor.id,
          events: [event(actor, 'created', input.note)] as Prisma.InputJsonValue,
        },
        include: { documents: true },
      })
      return created
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }
  throw new CreditFacilityError('Could not number the application — try again', 409)
}

const FINANCE_ROLES = new Set(['finance_officer', 'director'])

/** Edit the form (anyone working the application) or the assessment (finance). */
export async function updateApplication(actor: Actor, id: string, patch: Record<string, unknown>) {
  const app = await loadApplication(id)
  if (!OPEN_STATUSES.includes(app.status as CreditFacilityStatus)) throw new CreditFacilityError('A decided application can no longer be edited', 409)
  const finance = FINANCE_ROLES.has(roleOf(actor))
  const data: Prisma.CreditFacilityApplicationUpdateInput = {}
  if (patch.form && typeof patch.form === 'object') data.form = patch.form as Prisma.InputJsonValue
  if (patch.requestedLimit != null) data.requestedLimit = Math.max(0, Number(patch.requestedLimit) || 0)
  if (patch.requestedTermsDays != null) data.requestedTermsDays = Math.max(0, Math.trunc(Number(patch.requestedTermsDays) || 0))
  const financeFields = ['assessment', 'riskClass', 'recommendedLimit', 'recommendedTermsDays', 'conditions']
  if (financeFields.some(k => patch[k] !== undefined)) {
    if (!finance) throw new CreditFacilityError('Only Finance can record the credit check', 403)
    if (patch.assessment && typeof patch.assessment === 'object') data.assessment = patch.assessment as Prisma.InputJsonValue
    if (patch.riskClass !== undefined) {
      const r = patch.riskClass ? String(patch.riskClass) : null
      if (r && !['low', 'medium', 'high'].includes(r)) throw new CreditFacilityError('Risk must be low, medium or high')
      data.riskClass = r
    }
    if (patch.recommendedLimit !== undefined) data.recommendedLimit = patch.recommendedLimit == null || patch.recommendedLimit === '' ? null : Math.max(0, Number(patch.recommendedLimit) || 0)
    if (patch.recommendedTermsDays !== undefined) data.recommendedTermsDays = patch.recommendedTermsDays == null || patch.recommendedTermsDays === '' ? null : Math.max(0, Math.trunc(Number(patch.recommendedTermsDays) || 0))
    if (patch.conditions !== undefined) data.conditions = patch.conditions ? String(patch.conditions).slice(0, 4000) : null
  }
  return prisma.creditFacilityApplication.update({ where: { id }, data, include: { documents: true } })
}

export async function runAction(actor: Actor, id: string, action: CreditAction, body: { note?: string; approvedLimit?: number; approvedTermsDays?: number; conditions?: string }) {
  const role = roleOf(actor)
  if (!ACTION_ROLES[action]) throw new CreditFacilityError('Unknown action')
  if (!ACTION_ROLES[action].includes(role)) throw new CreditFacilityError('You are not allowed to do this', 403)
  const app = await loadApplication(id)
  const to = nextStatus(action, app.status)
  if (!to) throw new CreditFacilityError(`Cannot ${action.replace('_', ' ')} an application that is ${app.status.replace('_', ' ')}`, 409)
  const note = body.note ? String(body.note).slice(0, 2000) : null
  if (['request_info', 'decline', 'suspend', 'revoke'].includes(action) && !note) throw new CreditFacilityError('Add a note saying why')

  const data: Prisma.CreditFacilityApplicationUpdateInput = { status: to, events: appendEvent(app.events, event(actor, action, note)) }
  let clientUpdate: Prisma.ClientUpdateInput | null = null

  if (action === 'recommend' || action === 'approve') {
    const limit = Number(body.approvedLimit ?? app.recommendedLimit ?? app.requestedLimit) || 0
    const terms = Math.trunc(Number(body.approvedTermsDays ?? app.recommendedTermsDays ?? app.requestedTermsDays) || 0)
    const paid = await paidTransactionCount(app.clientId)
    const check = approvalCheck({ approvedLimit: limit, approvedTermsDays: terms, riskClass: app.riskClass, documents: app.documents.map(d => ({ kind: d.kind, status: d.status, expiresOn: d.expiresOn })), paidTransactions: paid })
    if (check.blockers.length) throw new CreditFacilityError(`Not ready: ${check.blockers.join('; ')}`, 409)
    if (body.conditions !== undefined) data.conditions = body.conditions ? String(body.conditions).slice(0, 4000) : null
    data.paidTransactions = paid
    if (action === 'recommend') {
      data.recommendedLimit = limit
      data.recommendedTermsDays = terms
      data.recommendedById = actor.id
    } else {
      if (!canDecide(role, check.level)) {
        throw new CreditFacilityError(check.policyException
          ? `The customer has ${paid} paid transaction(s); the payment policy asks for 3 — only a director can approve credit now. Recommend it instead.`
          : 'Limits above KES 100,000 are approved by a director — recommend it instead.', 403)
      }
      if (app.requestedById === actor.id && role !== 'director') throw new CreditFacilityError('The person who requested the credit cannot approve it', 403)
      const decidedAt = new Date()
      data.approvedLimit = limit
      data.approvedTermsDays = terms
      data.decidedById = actor.id
      data.decidedAt = decidedAt
      data.decisionNote = note
      data.reviewDue = new Date(reviewDueFrom(decidedAt))
      clientUpdate = { creditLimit: limit, paymentTermsDays: terms, creditStatus: 'approved', creditReviewDue: new Date(reviewDueFrom(decidedAt)) }
    }
  } else if (action === 'decline') {
    data.decidedById = actor.id
    data.decidedAt = new Date()
    data.decisionNote = note
  } else if (['suspend', 'reinstate', 'revoke'].includes(action)) {
    const status = clientCreditStatus(to)
    if (status) clientUpdate = { creditStatus: status }
    if (action === 'revoke') data.decisionNote = note
  }

  const updated = await prisma.$transaction(async tx => {
    const row = await tx.creditFacilityApplication.update({ where: { id }, data, include: { documents: true } })
    if (clientUpdate) await tx.client.update({ where: { id: app.clientId }, data: clientUpdate })
    return row
  })
  if (clientUpdate) await contactsChanged()
  await notifyCreditAction(updated, action, actor).catch(err => console.error('[credit-facility] notify failed:', err))
  return updated
}

async function notifyCreditAction(app: AppRow, action: CreditAction, actor: Actor) {
  const client = await prisma.client.findUnique({ where: { id: app.clientId }, select: { name: true } })
  const who = client?.name ?? 'Customer'
  const actionUrl = `/contacts?id=${app.clientId}&contactTab=credit`
  const base = { entityType: 'credit_application', entityId: app.id, actorUserId: actor.id || null, actionUrl }
  if (action === 'submit') {
    await publishNotificationEvent({ ...base, eventType: 'credit.application.submitted', roles: ['finance_officer'], title: `Credit application to review — ${who}`, body: `${app.ref}: KES ${Number(app.requestedLimit).toLocaleString('en-KE')} on ${app.requestedTermsDays} days requested.`, idempotencyKey: `credit-submitted:${app.id}:${app.updatedAt.getTime()}` })
  } else if (action === 'recommend') {
    await publishNotificationEvent({ ...base, eventType: 'credit.application.recommended', roles: ['director'], title: `Credit approval needed — ${who}`, body: `${app.ref}: Finance recommends KES ${Number(app.recommendedLimit).toLocaleString('en-KE')} on ${app.recommendedTermsDays} days.`, idempotencyKey: `credit-recommended:${app.id}:${app.updatedAt.getTime()}` })
  } else if (['approve', 'decline', 'request_info'].includes(action) && app.requestedById) {
    const title = action === 'approve' ? `Credit approved — ${who}` : action === 'decline' ? `Credit declined — ${who}` : `More information needed — ${who}`
    const body = action === 'approve'
      ? `${app.ref}: KES ${Number(app.approvedLimit).toLocaleString('en-KE')} on ${app.approvedTermsDays} days.${app.conditions ? ` Conditions: ${app.conditions}` : ''}`
      : `${app.ref}: ${app.decisionNote ?? (Array.isArray(app.events) ? (app.events.at(-1) as { note?: string })?.note ?? '' : '')}`
    await publishNotificationEvent({ ...base, eventType: `credit.application.${action}`, userIds: [app.requestedById], title, body, idempotencyKey: `credit-${action}:${app.id}:${app.updatedAt.getTime()}` })
  }
}

// ── Documents ─────────────────────────────────────────────────────────────

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const ALLOWED_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

const safeStem = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'document'

export async function addDocument(actor: Actor | null, id: string, file: { name: string; type: string; bytes: Buffer }, kind: string, via: 'staff' | 'client' = 'staff') {
  if (!DOCUMENT_KINDS.has(kind)) throw new CreditFacilityError('Unknown document type')
  if (!ALLOWED_DOCUMENT_TYPES.has(file.type)) throw new CreditFacilityError('Upload a PDF, image, Word or Excel file')
  if (file.bytes.length > MAX_DOCUMENT_BYTES) throw new CreditFacilityError('Files must be 10 MB or smaller')
  const content = validateFileContent(file.bytes, file.type)
  if (!content.ok) throw new CreditFacilityError(content.error || 'The file does not match its type')
  const app = await loadApplication(id)
  if (!OPEN_STATUSES.includes(app.status as CreditFacilityStatus) && app.status !== 'approved') throw new CreditFacilityError('Documents can no longer be added to this application', 409)
  const docId = randomUUID()
  const key = `credit-applications/${app.id}/${docId}${path.extname(safeStem(file.name))}`
  await putObject({ bucket: 'uploads', key, body: file.bytes, contentType: file.type })
  await prisma.creditFacilityDocument.create({
    data: { id: docId, applicationId: app.id, kind, name: file.name.slice(0, 255), contentType: file.type, size: file.bytes.length, objectKey: key, uploadedById: actor?.id ?? null, uploadedVia: via },
  })
  await prisma.creditFacilityApplication.update({ where: { id: app.id }, data: { events: appendEvent(app.events, { ...event(actor ?? { id: '', name: 'Client', role: '' }, 'document_added'), note: `${kind}: ${file.name}` } as ReturnType<typeof event>) } })
  return loadApplication(app.id)
}

export async function reviewDocument(actor: Actor, id: string, docId: string, patch: { status?: string; expiresOn?: string | null; note?: string | null }) {
  if (!FINANCE_ROLES.has(roleOf(actor))) throw new CreditFacilityError('Only Finance can verify documents', 403)
  const doc = await prisma.creditFacilityDocument.findFirst({ where: { id: docId, applicationId: id } })
  if (!doc) throw new CreditFacilityError('Document not found', 404)
  const data: Prisma.CreditFacilityDocumentUpdateInput = { reviewedById: actor.id, reviewedAt: new Date() }
  if (patch.status !== undefined) {
    if (!['received', 'verified', 'rejected'].includes(String(patch.status))) throw new CreditFacilityError('Unknown document status')
    data.status = String(patch.status)
  }
  if (patch.expiresOn !== undefined) {
    const d = patch.expiresOn ? new Date(patch.expiresOn) : null
    if (d && Number.isNaN(d.getTime())) throw new CreditFacilityError('Invalid expiry date')
    data.expiresOn = d
  }
  if (patch.note !== undefined) data.note = patch.note ? String(patch.note).slice(0, 1000) : null
  await prisma.creditFacilityDocument.update({ where: { id: docId }, data })
  return loadApplication(id)
}

export async function removeDocument(actor: Actor, id: string, docId: string) {
  const app = await loadApplication(id)
  const doc = app.documents.find(d => d.id === docId)
  if (!doc) throw new CreditFacilityError('Document not found', 404)
  if (doc.status === 'verified' && !FINANCE_ROLES.has(roleOf(actor))) throw new CreditFacilityError('A verified document can only be removed by Finance', 403)
  if (!OPEN_STATUSES.includes(app.status as CreditFacilityStatus)) throw new CreditFacilityError('Documents of a decided application are kept', 409)
  // The file is kept in storage; only the link to the application is removed.
  await prisma.creditFacilityDocument.delete({ where: { id: docId } })
  await prisma.creditFacilityApplication.update({ where: { id }, data: { events: appendEvent(app.events, { ...event(actor, 'document_removed'), note: `${doc.kind}: ${doc.name}` } as ReturnType<typeof event>) } })
  return loadApplication(id)
}

export async function readDocument(id: string, docId: string) {
  const doc = await prisma.creditFacilityDocument.findFirst({ where: { id: docId, applicationId: id } })
  if (!doc) throw new CreditFacilityError('Document not found', 404)
  const bytes = await getObject('uploads', doc.objectKey)
  if (!bytes) throw new CreditFacilityError('The file is missing from storage', 404)
  return { doc, bytes }
}

// ── Client link (portal) ──────────────────────────────────────────────────

/** How long a client link stays open. */
export const PORTAL_LINK_DAYS = 30
/** Statuses in which the client can still fill in and upload. */
const CLIENT_EDITABLE = new Set(['draft', 'sent', 'info_requested'])
/** A client can add at most this many files to one application. */
const MAX_CLIENT_DOCUMENTS = 40

const appBaseUrl = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://erp.deed.co.ke').replace(/\/+$/, '')
export const portalUrl = (token: string) => `${appBaseUrl()}/portal/credit/${token}`

/**
 * Give the application a client link (a fresh one when the old one expired or
 * `renew` is set), move a draft to "sent", and optionally email the link with
 * the blank forms attached.
 */
export async function issuePortalLink(actor: Actor, id: string, opts: { email?: string | null; renew?: boolean } = {}) {
  const role = roleOf(actor)
  if (!ACTION_ROLES.mark_sent.includes(role)) throw new CreditFacilityError('You are not allowed to do this', 403)
  const app = await loadApplication(id)
  if (!CLIENT_EDITABLE.has(app.status)) throw new CreditFacilityError('The client can no longer change this application', 409)
  const live = app.portalToken && app.portalExpiresAt && app.portalExpiresAt > new Date()
  const token = live && !opts.renew ? app.portalToken! : (await import('crypto')).randomBytes(24).toString('base64url')
  const expires = live && !opts.renew ? app.portalExpiresAt! : new Date(Date.now() + PORTAL_LINK_DAYS * 86_400_000)
  const url = portalUrl(token)

  let emailed: string | null = null
  const to = String(opts.email ?? '').trim()
  if (to) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new CreditFacilityError('That email address does not look right')
    const client = await prisma.client.findUnique({ where: { id: app.clientId }, select: { name: true } })
    const { sendEmail } = await import('@/lib/integrations/email')
    const { readFile } = await import('fs/promises')
    const forms = await Promise.all([
      ['Deed Technologies Credit Application Form.pdf', 'deed-credit-application-form.pdf'],
      ['Deed Technologies Payment Policy Acceptance Form.pdf', 'deed-payment-policy-acceptance-form.pdf'],
    ].map(async ([filename, file]) => ({ filename, content: await readFile(path.join(process.cwd(), 'public', 'credit-forms', file)).catch(() => null), contentType: 'application/pdf' })))
    const result = await sendEmail({
      to,
      replyTo: 'finance@deed.co.ke',
      subject: `Deed Technologies credit application — ${client?.name ?? ''}`.trim(),
      html: `<p>Dear ${client?.name ?? 'Partner'},</p>
<p>Thank you for choosing Deed Technologies. To apply for credit terms, please complete the credit application and upload the required documents using this secure link:</p>
<p><a href="${url}">${url}</a></p>
<p>The link is valid until ${expires.toISOString().slice(0, 10)}. The signed application form and payment policy acceptance form are attached — please print, sign, stamp and upload them with the other documents.</p>
<p>All information is treated confidentially and used solely for internal purposes. For queries, contact finance@deed.co.ke.</p>
<p>Deed Technologies</p>`,
      text: `Complete your Deed Technologies credit application here: ${url} (valid until ${expires.toISOString().slice(0, 10)}).`,
      attachments: forms.filter(f => f.content).map(f => ({ filename: f.filename, content: f.content as Buffer, contentType: f.contentType })),
    })
    if (!result.success) throw new CreditFacilityError(`The link was not emailed: ${result.error ?? 'email failed'}`, 502)
    emailed = to
  }

  const note = emailed ? `link emailed to ${emailed}` : 'client link created'
  const updated = await prisma.creditFacilityApplication.update({
    where: { id },
    data: {
      portalToken: token,
      portalExpiresAt: expires,
      ...(app.status === 'draft' ? { status: 'sent' } : {}),
      events: appendEvent(app.events, event(actor, 'link_sent', note)),
    },
    include: { documents: true },
  })
  return { app: updated, url, expiresAt: expires.toISOString(), emailed }
}

/** The application behind a client link, if the link is valid. */
export async function applicationForToken(token: string): Promise<AppRow> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw new CreditFacilityError('This link is not valid', 404)
  const app = await prisma.creditFacilityApplication.findUnique({ where: { portalToken: token }, include: { documents: true } })
  if (!app) throw new CreditFacilityError('This link is not valid', 404)
  if (!app.portalExpiresAt || app.portalExpiresAt < new Date()) throw new CreditFacilityError('This link has expired — please ask Deed Technologies for a new one', 410)
  return app
}

/** What the client sees: their form, the checklist and the names of files they sent — no internal review. */
export async function toPortalView(app: AppRow) {
  const client = await prisma.client.findUnique({ where: { id: app.clientId }, select: { name: true, email: true, phone: true, kraPin: true } })
  return {
    ref: app.ref,
    customer: client?.name ?? '',
    status: app.status,
    editable: CLIENT_EDITABLE.has(app.status),
    requestedLimit: Number(app.requestedLimit),
    requestedTermsDays: app.requestedTermsDays,
    form: app.form,
    prefill: { registeredName: client?.name ?? '', email: client?.email ?? '', telephone: client?.phone ?? '', taxPin: client?.kraPin ?? '' },
    infoRequest: app.status === 'info_requested'
      ? ((Array.isArray(app.events) ? [...app.events].reverse().find((e: any) => e?.action === 'request_info') : null) as { note?: string } | null)?.note ?? null
      : null,
    documents: app.documents
      .filter(d => d.status !== 'rejected' || d.uploadedVia === 'client')
      .map(d => ({ id: d.id, kind: d.kind, name: d.name, status: d.status === 'rejected' ? 'rejected' : 'received', uploadedVia: d.uploadedVia, createdAt: d.createdAt.toISOString(), note: d.status === 'rejected' ? d.note : null })),
    expiresAt: app.portalExpiresAt?.toISOString() ?? null,
  }
}

const portalActor = (app: AppRow, name?: string | null): Actor => ({ id: '', name: name ? `${name} (client)` : 'Client', role: 'client' })

/** The client saves the form (any time before submitting). */
export async function portalSaveForm(token: string, input: { form?: unknown; requestedLimit?: unknown; requestedTermsDays?: unknown }) {
  const app = await applicationForToken(token)
  if (!CLIENT_EDITABLE.has(app.status)) throw new CreditFacilityError('This application has been submitted and can no longer be changed', 409)
  if (!input.form || typeof input.form !== 'object' || Array.isArray(input.form)) throw new CreditFacilityError('Nothing to save')
  const json = JSON.stringify(input.form)
  if (json.length > 100_000) throw new CreditFacilityError('The form is too large')
  const data: Prisma.CreditFacilityApplicationUpdateInput = { form: JSON.parse(json) as Prisma.InputJsonValue }
  if (input.requestedLimit != null && Number(input.requestedLimit) > 0) data.requestedLimit = Math.min(1e11, Number(input.requestedLimit))
  if (input.requestedTermsDays != null && Number(input.requestedTermsDays) > 0) data.requestedTermsDays = Math.min(365, Math.trunc(Number(input.requestedTermsDays)))
  return prisma.creditFacilityApplication.update({ where: { id: app.id }, data, include: { documents: true } })
}

export async function portalAddDocument(token: string, file: { name: string; type: string; bytes: Buffer }, kind: string) {
  const app = await applicationForToken(token)
  if (!CLIENT_EDITABLE.has(app.status)) throw new CreditFacilityError('This application has been submitted — send further documents to finance@deed.co.ke', 409)
  if (app.documents.length >= MAX_CLIENT_DOCUMENTS) throw new CreditFacilityError('Too many files on this application — please contact finance@deed.co.ke')
  return addDocument(null, app.id, file, kind, 'client')
}

export async function portalRemoveDocument(token: string, docId: string) {
  const app = await applicationForToken(token)
  if (!CLIENT_EDITABLE.has(app.status)) throw new CreditFacilityError('This application has been submitted and can no longer be changed', 409)
  const doc = app.documents.find(d => d.id === docId)
  if (!doc || doc.uploadedVia !== 'client' || doc.status === 'verified') throw new CreditFacilityError('That file cannot be removed', 404)
  await prisma.creditFacilityDocument.delete({ where: { id: docId } })
  await prisma.creditFacilityApplication.update({ where: { id: app.id }, data: { events: appendEvent(app.events, { ...event(portalActor(app), 'document_removed'), note: `${doc.kind}: ${doc.name}` }) } })
  return loadApplication(app.id)
}

/** What the client must provide before submitting. */
export function portalSubmitBlockers(form: Record<string, any>, docs: Array<{ kind: string; status: string }>): string[] {
  const out: string[] = []
  const need = (v: unknown) => typeof v === 'string' ? v.trim() !== '' : v != null && v !== ''
  for (const [key, label] of [['registeredName', 'Registered business name'], ['physicalAddress', 'Physical address'], ['email', 'Email address'], ['taxPin', 'Tax PIN'], ['incorporationNumber', 'Certificate of incorporation number'], ['natureOfBusiness', 'Nature of business'], ['businessType', 'Type of business']] as const) {
    if (!need(form[key])) out.push(label)
  }
  const directors = Array.isArray(form.directors) ? form.directors : []
  if (!directors.some((d: any) => need(d?.fullName) && need(d?.idNumber))) out.push('At least one director (name and ID / passport number)')
  const banks = Array.isArray(form.banks) ? form.banks : []
  if (!banks.some((b: any) => need(b?.bankName) && need(b?.accountNumber))) out.push('At least one bank account')
  const refs = Array.isArray(form.tradeReferences) ? form.tradeReferences : []
  if (refs.filter((r: any) => need(r?.supplierName) && (need(r?.email) || need(r?.phone))).length < 2) out.push('Two trade / supplier references with a contact')
  const signers = Array.isArray(form.declarationSignatories) ? form.declarationSignatories : []
  if (!signers.some((s: any) => need(s?.fullName) && need(s?.title))) out.push('An authorised signatory for the declaration')
  if (!form.declarationAccepted) out.push('Confirm the customer declaration')
  if (!form.policyAccepted) out.push('Accept the payment policy')
  for (const rule of DOCUMENT_RULES) {
    if (!rule.required) continue
    if (!docs.some(d => d.kind === rule.kind && d.status !== 'rejected')) out.push(`Upload: ${rule.label}`)
  }
  return out
}

/** The client submits: the application goes to Finance. */
export async function portalSubmit(token: string) {
  const app = await applicationForToken(token)
  if (!CLIENT_EDITABLE.has(app.status)) throw new CreditFacilityError('This application has already been submitted', 409)
  const form = (app.form ?? {}) as Record<string, any>
  const blockers = portalSubmitBlockers(form, app.documents)
  if (blockers.length) throw new CreditFacilityError(`Still needed: ${blockers.join('; ')}`, 409)
  const signer = (Array.isArray(form.declarationSignatories) ? form.declarationSignatories : []).find((s: any) => s?.fullName)?.fullName ?? null
  const actor = portalActor(app, signer)
  const updated = await prisma.creditFacilityApplication.update({
    where: { id: app.id },
    data: { status: 'submitted', events: appendEvent(app.events, event(actor, 'submit', 'submitted by the client through the link')) },
    include: { documents: true },
  })
  await notifyCreditAction(updated, 'submit', { id: app.requestedById ?? '', name: actor.name, role: 'client' }).catch(err => console.error('[credit-facility] notify failed:', err))
  return updated
}
