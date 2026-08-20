/**
 * Find likely duplicate CRM contacts (clients) by normalized email / phone,
 * and soft-merge extras onto one surviving customer.
 */

import 'server-only'
import prisma from '@/lib/prisma'
import { broadcastContacts } from '@/lib/contact-prisma'
import {
  isEnquiryTitledContact,
  isObviousDuplicatePair,
  normalizeContactName,
  pickKeepContact,
} from '@/lib/crm/duplicate-contact-policy'
import { findExistingClientForLead } from '@/lib/crm/lead-client-resolve'
import { normalizeEmail, normalizePhoneE164, phoneMatchKey } from '@/lib/crm/inbox/normalize'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

export interface DuplicateContactMember {
  id: string
  name: string
  email: string | null
  phone: string | null
  phoneAlt: string | null
  companyName: string | null
  clientType: string | null
  createdAt: string
  leadCount: number
}

export interface DuplicateContactGroup {
  key: string
  kind: 'email' | 'phone' | 'name'
  members: DuplicateContactMember[]
}

const CLIENT_ID_FIELDS: Array<[string, string]> = [
  ['lead', 'clientId'],
  ['opportunity', 'clientId'],
  ['quote', 'clientId'],
  ['invoice', 'clientId'],
  ['saleOrder', 'clientId'],
  ['deliveryNote', 'clientId'],
  ['repair', 'clientId'],
  ['posTransaction', 'clientId'],
  ['kilimallOrder', 'clientId'],
  ['creditNote', 'clientId'],
  ['outboundRelease', 'clientId'],
  ['purchaseOrder', 'clientId'],
  ['customerAsset', 'customerId'],
  ['reconfigurationWorkOrder', 'linkedClientId'],
]

const BLOB_CUSTOMER_KEYS = [
  'deed_saleOrders',
  'deed_invoices',
  'deed_quotes',
  'deed_deliveries',
  'deed_repairs_v2',
  'deed_opportunities',
  'deed_posOrders',
  'deed_customerCredits',
  'deed_outboundReleases',
  'deed_contactPersons',
  'deed_purchaseOrders',
  'deed_buyBacks',
]

const BLOB_ID_FIELDS = [
  'customerId',
  'clientId',
  'partnerId',
  'referredById',
  'companyId',
  'linkedClientId',
] as const

export async function findDuplicateContactGroups(opts?: {
  limit?: number
}): Promise<DuplicateContactGroup[]> {
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 40))
  const clients = await prisma.client.findMany({
    where: { isActive: true },
    take: 5000,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      phoneAlt: true,
      companyName: true,
      clientType: true,
      createdAt: true,
      _count: { select: { leads: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const byEmail = new Map<string, typeof clients>()
  const byPhone = new Map<string, typeof clients>()
  const byName = new Map<string, typeof clients>()

  for (const c of clients) {
    const email = normalizeEmail(c.email)
    if (email) {
      const list = byEmail.get(email) || []
      list.push(c)
      byEmail.set(email, list)
    }
    for (const raw of [c.phone, c.phoneAlt]) {
      const key = phoneMatchKey(normalizePhoneE164(raw) || raw)
      if (!key || key.length < 7) continue
      const list = byPhone.get(key) || []
      if (!list.some(x => x.id === c.id)) list.push(c)
      byPhone.set(key, list)
    }
    const name = normalizeContactName(c.name)
    if (name.length >= 3) {
      const list = byName.get(name) || []
      if (!list.some(x => x.id === c.id)) list.push(c)
      byName.set(name, list)
    }
  }

  const groups: DuplicateContactGroup[] = []
  const seenIds = new Set<string>()

  for (const [email, members] of byEmail) {
    if (members.length < 2) continue
    const ids = members.map(m => m.id).sort().join(',')
    if (seenIds.has(`e:${ids}`)) continue
    seenIds.add(`e:${ids}`)
    groups.push({
      key: `email:${email}`,
      kind: 'email',
      members: members.map(toMember),
    })
  }

  for (const [phone, members] of byPhone) {
    if (members.length < 2) continue
    const ids = members.map(m => m.id).sort().join(',')
    if (seenIds.has(`p:${ids}`) || seenIds.has(`e:${ids}`)) continue
    let covered = false
    for (const g of groups) {
      const gIds = g.members.map(m => m.id).sort().join(',')
      if (gIds === ids) { covered = true; break }
    }
    if (covered) continue
    seenIds.add(`p:${ids}`)
    groups.push({
      key: `phone:${phone}`,
      kind: 'phone',
      members: members.map(toMember),
    })
  }

  for (const [name, members] of byName) {
    if (members.length < 2) continue
    const ids = members.map(m => m.id).sort().join(',')
    let covered = false
    for (const g of groups) {
      const gIds = g.members.map(m => m.id).sort().join(',')
      if (gIds === ids) { covered = true; break }
    }
    if (covered) continue
    groups.push({
      key: `name:${name}`,
      kind: 'name',
      members: members.map(toMember),
    })
  }

  groups.sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key))
  return groups.slice(0, limit)
}

function toMember(m: {
  id: string
  name: string
  email: string | null
  phone: string | null
  phoneAlt: string | null
  companyName: string | null
  clientType: string
  createdAt: Date
  _count: { leads: number }
}): DuplicateContactMember {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    phone: m.phone,
    phoneAlt: m.phoneAlt,
    companyName: m.companyName,
    clientType: m.clientType,
    createdAt: m.createdAt.toISOString(),
    leadCount: m._count.leads,
  }
}

export function rewriteCustomerIdsInRecords(
  records: unknown,
  fromId: string,
  toId: string,
): unknown {
  if (!Array.isArray(records)) return records
  return records.map(item => {
    if (!item || typeof item !== 'object') return item
    const row = { ...(item as Record<string, unknown>) }
    for (const field of BLOB_ID_FIELDS) {
      if (row[field] === fromId) row[field] = toId
    }
    return row
  })
}

async function rewriteCustomerIdsInBlobs(fromId: string, toId: string): Promise<void> {
  const state = await loadAppState(BLOB_CUSTOMER_KEYS)
  const next: Record<string, string> = {}
  for (const key of BLOB_CUSTOMER_KEYS) {
    const current = state[key]
    if (!Array.isArray(current)) continue
    const rewritten = rewriteCustomerIdsInRecords(current, fromId, toId)
    if (JSON.stringify(rewritten) !== JSON.stringify(current)) {
      next[key] = JSON.stringify(rewritten)
    }
  }
  if (Object.keys(next).length) await saveStoreKeys(next)
}

async function reassignClientForeignKeys(tx: any, mergeId: string, keepId: string): Promise<void> {
  for (const [model, field] of CLIENT_ID_FIELDS) {
    if (typeof tx[model]?.updateMany !== 'function') continue
    await tx[model].updateMany({
      where: { [field]: mergeId },
      data: { [field]: keepId },
    })
  }
  if (typeof tx.repair?.updateMany === 'function') {
    await tx.repair.updateMany({
      where: { referredById: mergeId },
      data: { referredById: keepId },
    })
  }
}

async function moveContactPeople(tx: any, mergeId: string, keepId: string): Promise<void> {
  if (typeof tx.contactPerson?.findMany !== 'function') return
  const [keepPeople, mergePeople] = await Promise.all([
    tx.contactPerson.findMany({ where: { clientId: keepId } }),
    tx.contactPerson.findMany({ where: { clientId: mergeId } }),
  ])
  const kept = [...(keepPeople || [])]
  for (const person of mergePeople || []) {
    const email = normalizeEmail(person.email)
    const phone = phoneMatchKey(person.phone)
    const duplicate = kept.find((row: { email?: string | null; phone?: string | null }) => (
      (email && normalizeEmail(row.email) === email)
      || (phone && phoneMatchKey(row.phone) === phone)
    ))
    if (duplicate) {
      if (typeof tx.contactPerson.delete === 'function') {
        await tx.contactPerson.delete({ where: { id: person.id } })
      }
      continue
    }
    await tx.contactPerson.update({
      where: { id: person.id },
      data: { clientId: keepId },
    })
    kept.push({ ...person, clientId: keepId })
  }
}

/**
 * Soft-merge: keep primary, deactivate secondary, re-point related rows.
 * Does not overwrite primary email/phone with conflicting secondary values.
 */
export async function mergeDuplicateContacts(opts: {
  keepId: string
  mergeId: string
}): Promise<{ ok: true; keepId: string; mergedId: string } | { ok: false; error: string }> {
  if (opts.keepId === opts.mergeId) return { ok: false, error: 'Same contact' }
  const [keep, merge] = await Promise.all([
    prisma.client.findUnique({ where: { id: opts.keepId } }),
    prisma.client.findUnique({ where: { id: opts.mergeId } }),
  ])
  if (!keep || !merge) return { ok: false, error: 'Contact not found' }
  if (!keep.isActive) return { ok: false, error: 'Keep contact is inactive' }

  const enrich: Record<string, unknown> = {}
  if (!keep.phone && merge.phone) enrich.phone = merge.phone.slice(0, 20)
  if (!keep.phoneAlt && merge.phoneAlt) enrich.phoneAlt = merge.phoneAlt.slice(0, 20)
  if (!keep.email && merge.email) enrich.email = merge.email.slice(0, 150)
  if (!keep.companyName && merge.companyName && !isEnquiryTitledContact(merge.companyName)) {
    enrich.companyName = merge.companyName.slice(0, 200)
  }
  if (isEnquiryTitledContact(keep.name)) {
    const realName = [keep.companyName, merge.companyName, merge.name]
      .map(value => String(value || '').trim())
      .find(value => value && !isEnquiryTitledContact(value))
    if (realName) enrich.name = realName.slice(0, 200)
  }

  const mergeCredit = Number(merge.creditBalance || 0)
  const mergePoints = Number(merge.loyaltyPoints || 0)
  if (mergeCredit > 0) {
    enrich.creditBalance = Number(keep.creditBalance || 0) + mergeCredit
  }
  if (mergePoints > 0) {
    enrich.loyaltyPoints = Number(keep.loyaltyPoints || 0) + mergePoints
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `client-merge:${[opts.keepId, opts.mergeId].sort().join(':')}`,
    )
    if (Object.keys(enrich).length) {
      await tx.client.update({ where: { id: keep.id }, data: enrich })
    }
    await reassignClientForeignKeys(tx, merge.id, keep.id)
    await moveContactPeople(tx, merge.id, keep.id)
    await tx.client.update({
      where: { id: merge.id },
      data: {
        isActive: false,
        creditBalance: 0,
        notes: `${merge.notes || ''}\n\n[Merged into ${keep.id} at ${new Date().toISOString()}]`.slice(0, 5000),
      },
    })
  })

  try {
    await rewriteCustomerIdsInBlobs(merge.id, keep.id)
  } catch (error) {
    console.error('[crm] Failed to rewrite blob customer ids after merge:', error)
  }
  void broadcastContacts(prisma)

  return { ok: true, keepId: keep.id, mergedId: merge.id }
}

function resolvePlannedKeep(planned: Map<string, string>, id: string): string {
  let current = id
  const seen = new Set<string>()
  while (planned.has(current) && !seen.has(current)) {
    seen.add(current)
    current = planned.get(current) as string
  }
  return current
}

function planMerge(planned: Map<string, string>, mergeId: string, keepId: string, limit: number): void {
  if (planned.size >= limit) return
  const keep = resolvePlannedKeep(planned, keepId)
  const merge = resolvePlannedKeep(planned, mergeId)
  if (!keep || !merge || keep === merge) return
  if (planned.has(merge)) return
  planned.set(merge, keep)
}

export async function mergeObviousDuplicateContacts(opts?: {
  limit?: number
  dryRun?: boolean
}): Promise<{ merged: number; skipped: number; dryRun: boolean }> {
  const limit = Math.min(400, Math.max(1, opts?.limit ?? 200))
  const dryRun = Boolean(opts?.dryRun)
  const planned = new Map<string, string>()

  const enquiryRows = await prisma.client.findMany({
    where: { isActive: true },
    take: 5000,
    select: {
      id: true,
      name: true,
      companyName: true,
      clientType: true,
      email: true,
      phone: true,
      phoneAlt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  for (const row of enquiryRows) {
    if (planned.size >= limit) break
    if (!isEnquiryTitledContact(row.name)) continue
    const match = await findExistingClientForLead(prisma, {
      name: row.name,
      companyName: row.companyName,
      email: row.email,
      phone: row.phone || row.phoneAlt,
    }, { excludeId: row.id })
    if (!match || match.id === row.id) continue
    const keepMatch = !isEnquiryTitledContact(match.name)
    planMerge(
      planned,
      keepMatch ? row.id : match.id,
      keepMatch ? match.id : row.id,
      limit,
    )
  }

  const groups = await findDuplicateContactGroups({ limit: 100 })
  for (const group of groups) {
    if (planned.size >= limit) break
    const keep = pickKeepContact(group.members)
    if (!keep) continue
    for (const member of group.members) {
      if (member.id === keep.id) continue
      if (!isObviousDuplicatePair(keep, member)) continue
      planMerge(planned, member.id, keep.id, limit)
    }
  }

  if (dryRun) {
    return { merged: planned.size, skipped: 0, dryRun: true }
  }

  let merged = 0
  let skipped = 0
  for (const [mergeId, keepId] of planned) {
    const result = await mergeDuplicateContacts({
      keepId: resolvePlannedKeep(planned, keepId),
      mergeId,
    })
    if (result.ok) merged += 1
    else skipped += 1
  }
  return { merged, skipped, dryRun: false }
}
