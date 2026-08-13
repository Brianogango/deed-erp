/** Shared helpers for CRM lead → opportunity conversion. */

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
