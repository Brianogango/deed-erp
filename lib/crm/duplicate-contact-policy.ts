/**
 * Rules for which CRM client records are safe to auto-merge.
 * Enquiry-titled Contacts-module rows (inbound RFQ subjects) are the
 * conversion duplicates; two established customers with different names
 * that merely share a switchboard number are not.
 */

import { looksLikeEnquiryTitle } from '@/lib/crm/lead-convert'

export type DuplicatePolicyMember = {
  id: string
  name: string
  companyName?: string | null
  createdAt: string
  leadCount?: number
}

export function normalizeContactName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function isEnquiryTitledContact(name: string | null | undefined): boolean {
  return looksLikeEnquiryTitle(String(name || ''))
}

function companyOrName(member: DuplicatePolicyMember): string {
  const company = normalizeContactName(member.companyName)
  if (company && !isEnquiryTitledContact(member.companyName)) return company
  return normalizeContactName(member.name)
}

/**
 * True when merging `merge` into `keep` is the RFQ-duplicate case or the
 * same customer stored twice, not two different people on one shared phone.
 */
export function isObviousDuplicatePair(
  keep: DuplicatePolicyMember,
  merge: DuplicatePolicyMember,
): boolean {
  if (keep.id === merge.id) return false
  if (isEnquiryTitledContact(keep.name) || isEnquiryTitledContact(merge.name)) return true
  const keepName = normalizeContactName(keep.name)
  const mergeName = normalizeContactName(merge.name)
  if (keepName && mergeName && keepName === mergeName) return true
  const keepCompany = companyOrName(keep)
  const mergeCompany = companyOrName(merge)
  if (keepCompany && mergeCompany && keepCompany === mergeCompany) return true
  return false
}

/**
 * Prefer a real customer name over an RFQ subject, then more linked leads,
 * then the older row.
 */
export function pickKeepContact(members: DuplicatePolicyMember[]): DuplicatePolicyMember | null {
  if (members.length === 0) return null
  return [...members].sort((a, b) => {
    const aTitle = isEnquiryTitledContact(a.name) ? 1 : 0
    const bTitle = isEnquiryTitledContact(b.name) ? 1 : 0
    if (aTitle !== bTitle) return aTitle - bTitle
    const leadDelta = (b.leadCount || 0) - (a.leadCount || 0)
    if (leadDelta) return leadDelta
    return String(a.createdAt).localeCompare(String(b.createdAt))
  })[0] || null
}
