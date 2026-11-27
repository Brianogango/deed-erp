/**
 * What the contact form sends when it saves. Fields that do not apply to the
 * contact's type are dropped (a person has no trading name; a company has no
 * ID number). Payment details are kept for both: an individual vendor is
 * paid by M-Pesa or bank like any company.
 */
type Values = {
  name: string; country?: string; type?: string
  tradingName?: string; registrationNumber?: string; industry?: string; postalAddress?: string
  jobTitle?: string; idNumber?: string; companyId?: string
  bankName?: string; bankAccount?: string; bankBranch?: string
  creditLimit?: number; isCustomer?: boolean; isVendor?: boolean
}

export function contactSavePayload<T extends Values>(
  form: T,
  opts: { canSetCreditTerms: boolean; creditLimit: number; forceCustomer?: boolean; forceVendor?: boolean },
): T {
  const payload: T = {
    ...form,
    name: form.name.trim(),
    country: (form.country ?? '').trim() || 'Kenya',
    ...(form.type === 'company' && opts.canSetCreditTerms ? { creditLimit: opts.creditLimit } : {}),
    ...(opts.forceCustomer ? { isCustomer: true } : {}),
    ...(opts.forceVendor ? { isVendor: true } : {}),
  }
  if (form.type === 'individual') {
    payload.tradingName = undefined
    payload.registrationNumber = undefined
    payload.industry = undefined
    payload.postalAddress = undefined
  } else {
    payload.jobTitle = undefined
    payload.idNumber = undefined
    payload.companyId = undefined
  }
  return payload
}
