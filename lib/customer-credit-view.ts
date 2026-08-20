/**
 * Customer store-credit wallet (3102) — buy-backs "Add as credit",
 * sales/RMA credit notes, and cancelled paid invoices.
 * Distinct from Contact.creditLimit (how much they may owe).
 */

export type CustomerCreditLike = {
  id?: string
  ref?: string
  customerId?: string
  customerName?: string
  sourceType?: 'invoice' | 'buyback'
  sourceInvoiceRef?: string
  sourceBuyBackRef?: string
  amount?: number
  balance?: number
  status?: string
  createdAt?: string
  notes?: string
}

export function isOpenCustomerCredit(status?: string | null): boolean {
  return status === 'available' || status === 'partially_used'
}

export function customerCreditBalance(
  credits: CustomerCreditLike[] | null | undefined,
  customerId?: string | null,
): number {
  if (!customerId) return 0
  return (credits ?? [])
    .filter(c => c.customerId === customerId && isOpenCustomerCredit(c.status))
    .reduce((sum, c) => sum + Math.max(0, Number(c.balance) || 0), 0)
}

export function creditBalancesByCustomer(
  credits: CustomerCreditLike[] | null | undefined,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const credit of credits ?? []) {
    if (!credit.customerId || !isOpenCustomerCredit(credit.status)) continue
    const amount = Math.max(0, Number(credit.balance) || 0)
    if (amount <= 0) continue
    map.set(credit.customerId, (map.get(credit.customerId) ?? 0) + amount)
  }
  return map
}

export function creditsForCustomer(
  credits: CustomerCreditLike[] | null | undefined,
  customerId?: string | null,
): CustomerCreditLike[] {
  if (!customerId) return []
  return (credits ?? [])
    .filter(c => c.customerId === customerId)
    .slice()
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
}

export function customerCreditSourceLabel(credit: CustomerCreditLike): string {
  if (credit.sourceType === 'buyback' || credit.sourceBuyBackRef) {
    return credit.sourceBuyBackRef ? `Buy-back ${credit.sourceBuyBackRef}` : 'Buy-back'
  }
  if (credit.sourceInvoiceRef) return `Invoice ${credit.sourceInvoiceRef}`
  const notes = String(credit.notes ?? '').trim()
  return notes || 'Credit note'
}

export function customerCreditStatusLabel(status?: string | null): string {
  switch (status) {
    case 'available': return 'Available'
    case 'partially_used': return 'Part used'
    case 'used': return 'Used'
    case 'void': return 'Void'
    default: return status || '—'
  }
}

export function totalOpenStoreCredit(credits: CustomerCreditLike[] | null | undefined): number {
  return (credits ?? [])
    .filter(c => isOpenCustomerCredit(c.status))
    .reduce((sum, c) => sum + Math.max(0, Number(c.balance) || 0), 0)
}
