/**
 * Keep customer identity on quotes / sale orders (proformas) / invoices in sync
 * when a contact or linked document customer is edited.
 */

type CustomerIdentity = {
  name: string
  email?: string
  phone?: string
  address?: string
}

export function formatCustomerAddress(parts: {
  address?: string | null
  city?: string | null
  country?: string | null
}): string | undefined {
  const line = [parts.address, parts.city, parts.country]
    .map(s => String(s ?? '').trim())
    .filter(Boolean)
    .join(', ')
  return line || undefined
}

export function shouldSyncQuoteCustomer(status: string | null | undefined): boolean {
  return status !== 'rejected' && status !== 'expired'
}

export function shouldSyncSaleOrderCustomer(status: string | null | undefined): boolean {
  return status !== 'cancelled'
}

/** Identity fields may update on draft and posted invoices (for reprints); skip cancelled. */
export function shouldSyncInvoiceCustomer(status: string | null | undefined): boolean {
  return status !== 'cancelled'
}

export function quoteMatchesCustomer(
  quote: { companyId?: string | null; clientId?: string | null },
  contactId: string,
): boolean {
  return quote.companyId === contactId || quote.clientId === contactId
}

export function applyCustomerToQuote<T extends {
  companyName: string
  contactPersonEmail?: string
  contactPersonPhone?: string
}>(quote: T, identity: CustomerIdentity): T {
  return {
    ...quote,
    companyName: identity.name,
    ...(identity.email !== undefined ? { contactPersonEmail: identity.email || undefined } : {}),
    ...(identity.phone !== undefined ? { contactPersonPhone: identity.phone || undefined } : {}),
  }
}

export function applyCustomerToSaleOrder<T extends {
  customerName: string
  customerId?: string
  invoiceAddress?: string
}>(so: T, identity: CustomerIdentity & { customerId?: string }): T {
  return {
    ...so,
    customerName: identity.name,
    ...(identity.customerId ? { customerId: identity.customerId } : {}),
    ...(identity.address !== undefined ? { invoiceAddress: identity.address || undefined } : {}),
  }
}

export function applyCustomerToInvoice<T extends {
  partnerName: string
  partnerId?: string
  invoiceAddress?: string
}>(inv: T, identity: CustomerIdentity & { customerId?: string }): T {
  return {
    ...inv,
    partnerName: identity.name,
    ...(identity.customerId ? { partnerId: identity.customerId } : {}),
    ...(identity.address !== undefined ? { invoiceAddress: identity.address || undefined } : {}),
  }
}
