/**
 * Which bank or cash account a payment went through, as the screens show it
 * for reconciliation. The account is the one chosen on the payment; older
 * payments, and cash or M-Pesa ones recorded without a choice, went to the
 * default the books used for their method (the same rule as the cashbook,
 * lib/accounting/cashbook-entries.ts), shown as "(default)".
 */
type Pay = { id?: string; method?: string; bankAccountId?: string | null }
type Bank = { id: string; name?: string; bankName?: string; accountNo?: string; active?: boolean }
type Line = { matchedEntryId?: string; date?: string; reference?: string; month?: string; bankAccountId?: string }

/** Methods that move no money (a credit or deposit applied): no bank. */
const NO_MONEY = new Set(['customer_credit', 'vendor_credit', 'store_credit', 'credit_note', 'deposit_apply', 'withholding_vat', 'withholding_tax'])

export function moneyMoved(p: Pay): boolean {
  return !NO_MONEY.has(String(p.method ?? ''))
}

/** The account the money went through: chosen, else the books' default for the method. */
export function effectivePaymentBankId(p: Pay): string {
  if (p.bankAccountId) return String(p.bankAccountId)
  const m = String(p.method ?? '')
  if (m === 'mpesa' || m === 'mpesa_company') return 'mpesa'
  if (m === 'cash' || m === 'petty_cash') return 'cash'
  return 'ncba'
}

/** "NCBA Current Account ••7890"; the last four digits tell two accounts at one bank apart. */
export function bankAccountLabel(bank: Bank | undefined, fallbackId: string): string {
  if (!bank) return fallbackId
  const digits = String(bank.accountNo ?? '').replace(/\D/g, '')
  const tail = digits.length >= 4 ? ` ••${digits.slice(-4)}` : ''
  return `${bank.name || bank.bankName || fallbackId}${tail}`
}

export function paymentBank(p: Pay, banks: Bank[]): { id: string; label: string; isDefault: boolean } | null {
  if (!moneyMoved(p)) return null
  const id = effectivePaymentBankId(p)
  return { id, label: bankAccountLabel(banks.find(b => b.id === id), id), isDefault: !p.bankAccountId }
}

/** The cashbook entries a payment shows as (lib/accounting/cashbook-entries.ts). */
export function cashbookEntryIdsForPayment(invoiceId: string, paymentId: string): string[] {
  return [`inv-pay-${invoiceId}-${paymentId}`, `bill-pay-${invoiceId}-${paymentId}`, `bill-refund-${invoiceId}-${paymentId}`]
}

/** The bank statement line a payment is matched to in bank reconciliation, if any. */
export function reconciledStatementLine<T extends Line>(lines: T[], invoiceId: string, paymentId: string): T | null {
  const ids = new Set(cashbookEntryIdsForPayment(invoiceId, paymentId))
  return lines.find(l => l.matchedEntryId && ids.has(l.matchedEntryId)) ?? null
}

/** Several active accounts of one kind (two M-Pesa, two cash floats): the payment must say which. */
export function accountChoiceRequired(method: string, banks: Bank[]): boolean {
  const active = banks.filter(b => b.active !== false)
  const isMpesa = (b: Bank) => /m-?pesa/i.test(`${b.name ?? ''} ${b.bankName ?? ''}`)
  const isCash = (b: Bank) => /cash/i.test(`${b.bankName ?? ''}`) || String(b.accountNo ?? '').toUpperCase() === 'CASH'
  if (method === 'mpesa') return active.filter(isMpesa).length > 1
  if (method === 'cash') return active.filter(isCash).length > 1
  return false
}
