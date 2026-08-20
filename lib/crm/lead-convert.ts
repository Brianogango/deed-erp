/** Shared helpers for CRM lead → opportunity conversion. */

import { emailDomain, isFreeMailDomain } from '@/lib/crm/sales-inbox-leads'

export function clip(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (!text) return null
  return text.length <= max ? text : text.slice(0, max)
}

export function splitContactName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim() || 'Contact'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  const firstName = clip(parts[0] || trimmed, 80) || 'Contact'
  const rest = parts.slice(1).join(' ')
  const lastName = clip(rest || '—', 80) || '—'
  return { firstName, lastName }
}

export function salesQuoteHref(opts: {
  customerId: string
  customerName?: string | null
  opportunityId?: string | null
}): string {
  const params = new URLSearchParams()
  params.set('new', '1')
  params.set('customerId', opts.customerId)
  if (opts.customerName?.trim()) params.set('customerName', opts.customerName.trim())
  if (opts.opportunityId) params.set('opportunityId', opts.opportunityId)
  return `/sales?${params.toString()}`
}

export type LeadIdentity = {
  clientId?: string | null
  name: string
  companyName?: string | null
  email?: string | null
  phone?: string | null
}

/** RFQ subjects used as lead titles must not become new customer names. */
export function looksLikeEnquiryTitle(name: string): boolean {
  const text = String(name || '').trim()
  if (text.length > 80) return true
  return /(?:\bRFQ\b|\bquote\b|\bquotation\b|\benquiry\b|\binquiry\b|[×x]\s*\d|\b\d+\s*(?:gb|tb|ssd|hdd|ram)\b)/i.test(text)
}

export function corporateEmailDomain(email?: string | null): string | null {
  const domain = emailDomain(email)
  if (!domain || isFreeMailDomain(domain)) return null
  return domain
}

/**
 * Customer record name: company when we have one, otherwise the person.
 * Never use a long inbound subject line as the Contacts-module name.
 */
export function leadCustomerDisplayName(lead: LeadIdentity): string {
  const company = String(lead.companyName || '').trim()
  if (company) return company
  const name = String(lead.name || '').trim()
  if (name && !looksLikeEnquiryTitle(name)) return name
  const local = String(lead.email || '').split('@')[0] || ''
  const fromLocal = local.replace(/[._+-]+/g, ' ').replace(/\d+/g, ' ').trim()
  if (fromLocal) {
    return fromLocal.replace(/\b\w/g, c => c.toUpperCase())
  }
  return name || 'Customer'
}
