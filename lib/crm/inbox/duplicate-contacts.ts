/**
 * Find likely duplicate CRM contacts (clients) by normalized email / phone.
 */

import 'server-only'
import prisma from '@/lib/prisma'
import { normalizeEmail, normalizePhoneE164, phoneMatchKey } from '@/lib/crm/inbox/normalize'

export interface DuplicateContactMember {
  id: string
  name: string
  email: string | null
  phone: string | null
  phoneAlt: string | null
  companyName: string | null
  createdAt: string
  leadCount: number
}

export interface DuplicateContactGroup {
  key: string
  kind: 'email' | 'phone'
  members: DuplicateContactMember[]
}

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
      createdAt: true,
      _count: { select: { leads: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const byEmail = new Map<string, typeof clients>()
  const byPhone = new Map<string, typeof clients>()

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
      members: members.map(m => ({
        id: m.id,
        name: m.name,
        email: m.email,
        phone: m.phone,
        phoneAlt: m.phoneAlt,
        companyName: m.companyName,
        createdAt: m.createdAt.toISOString(),
        leadCount: m._count.leads,
      })),
    })
  }

  for (const [phone, members] of byPhone) {
    if (members.length < 2) continue
    const ids = members.map(m => m.id).sort().join(',')
    if (seenIds.has(`p:${ids}`) || seenIds.has(`e:${ids}`)) continue
    // Skip if already covered as an email group with same set
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
      members: members.map(m => ({
        id: m.id,
        name: m.name,
        email: m.email,
        phone: m.phone,
        phoneAlt: m.phoneAlt,
        companyName: m.companyName,
        createdAt: m.createdAt.toISOString(),
        leadCount: m._count.leads,
      })),
    })
  }

  groups.sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key))
  return groups.slice(0, limit)
}

/**
 * Soft-merge: keep primary, deactivate secondary, re-point leads to primary.
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

  const enrich: Record<string, string> = {}
  if (!keep.phone && merge.phone) enrich.phone = merge.phone.slice(0, 20)
  if (!keep.phoneAlt && merge.phoneAlt) enrich.phoneAlt = merge.phoneAlt.slice(0, 20)
  if (!keep.email && merge.email) enrich.email = merge.email.slice(0, 150)
  if (!keep.companyName && merge.companyName) enrich.companyName = merge.companyName.slice(0, 200)

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `client-merge:${[opts.keepId, opts.mergeId].sort().join(':')}`,
    )
    if (Object.keys(enrich).length) {
      await tx.client.update({ where: { id: keep.id }, data: enrich })
    }
    await tx.lead.updateMany({
      where: { clientId: merge.id },
      data: { clientId: keep.id },
    })
    await tx.opportunity.updateMany({
      where: { clientId: merge.id },
      data: { clientId: keep.id },
    })
    await tx.client.update({
      where: { id: merge.id },
      data: {
        isActive: false,
        notes: `${merge.notes || ''}\n\n[Merged into ${keep.id} at ${new Date().toISOString()}]`.slice(0, 5000),
      },
    })
  })

  return { ok: true, keepId: keep.id, mergedId: merge.id }
}
