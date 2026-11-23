import type { Contact } from '@/lib/store'

/**
 * How we pay a supplier.
 *
 * The contact record has carried bankName / bankAccount / bankBranch since the
 * `clients` table was written, and the contact detail panel rendered all three
 * — but no form ever offered an input for them, so every vendor's payment
 * panel read "—". Most suppliers here are paid by M-Pesa anyway, which the
 * bank columns could not express at all.
 *
 * The labels live here rather than in each screen so the form's dropdown and
 * the panel that reads it back can never drift apart.
 */
export type PayBy = NonNullable<Contact['payBy']>

export const PAY_BY_OPTIONS: ReadonlyArray<{ value: PayBy; label: string }> = [
  { value: 'bank', label: 'Bank transfer' },
  { value: 'mpesa', label: 'M-Pesa' },
]

export const PAY_BY_LABELS: Record<string, string> = Object.fromEntries(
  PAY_BY_OPTIONS.map(o => [o.value, o.label]),
)

/** Anything on file that tells Finance how to pay this contact. */
export function hasPaymentDetails(contact: Partial<Contact>): boolean {
  return Boolean(
    contact.bankName || contact.bankAccount || contact.bankBranch
    || contact.mpesaPaybill || contact.mpesaAccount,
  )
}

/**
 * The payment instruction in one line, for a bill or a payment run.
 *
 * Follows `payBy` when it is set; otherwise falls back to whichever rail has
 * details on file, preferring M-Pesa because a Paybill is the faster payment.
 */
export function paymentInstruction(contact: Partial<Contact>): string {
  const mpesa = String(contact.mpesaPaybill ?? '').trim()
  const mpesaAccount = String(contact.mpesaAccount ?? '').trim()
  const bank = String(contact.bankName ?? '').trim()
  const account = String(contact.bankAccount ?? '').trim()

  const byMpesa = mpesa
    ? `M-Pesa ${mpesa}${mpesaAccount ? ` · acct ${mpesaAccount}` : ''}`
    : ''
  const byBank = bank || account
    ? [bank || 'Bank', account].filter(Boolean).join(' · ')
    : ''

  if (contact.payBy === 'mpesa') return byMpesa || byBank || 'No payment details on file'
  if (contact.payBy === 'bank') return byBank || byMpesa || 'No payment details on file'
  return byMpesa || byBank || 'No payment details on file'
}
