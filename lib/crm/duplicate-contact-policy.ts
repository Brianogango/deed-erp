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
  clientType?: string | null
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

export function isOrganizationContactName(name: string | null | undefined): boolean {
  return /\b(ltd|limited|plc|llc|inc|corp|hospital|school|university|college|company|group|enterprises|services|kenya|bank|church|parish|clinic|ministr(?:y|ies)|county|government)\b/i
    .test(String(name || ''))
}

/**
 * True when merging `merge` into `keep` is the RFQ-duplicate case or the
 * same organisation stored twice, not two different people on one shared phone.
 */
export function isObviousDuplicatePair(
  keep: DuplicatePolicyMember,
  merge: DuplicatePolicyMember,
): boolean {
  if (keep.id === merge.id) return false
  if (isEnquiryTitledContact(keep.name) || isEnquiryTitledContact(merge.name)) return true
  const keepName = normalizeContactName(keep.name)
  const mergeName = normalizeContactName(merge.name)
  const sameName = Boolean(keepName && mergeName && keepName === mergeName)
  const keepCompany = companyOrName(keep)
  const mergeCompany = companyOrName(merge)
  const sameCompany = Boolean(keepCompany && mergeCompany && keepCompany === mergeCompany)
  if ((sameName || sameCompany) && (
    keep.clientType === 'company'
    || merge.clientType === 'company'
    || isOrganizationContactName(keep.name)
    || isOrganizationContactName(merge.name)
    || isOrganizationContactName(keep.companyName)
    || isOrganizationContactName(merge.companyName)
  )) return true
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
