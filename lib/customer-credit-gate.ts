export type CreditSalesDocument = 'quote' | 'order' | 'invoice'

type CustomerCreditGateInput = {
  overdueBalance: number
  overdueCount: number
  creditLimit: number
  outstandingBalance: number
  newOrderTotal: number
  document: CreditSalesDocument
  formatMoney?: (amount: number) => string
  /** Corporate customer without approved credit: pays on receipt (payment policy). */
  payOnReceipt?: boolean
}

type CustomerCreditGateResult = {
  ok: boolean
  /** Blocked because a pay-on-receipt customer still owes money. */
  payOnReceiptBlocked?: boolean
  isLocked: boolean
  creditLimitExceeded: boolean
  creditAvailable: number
  message: string
}

function defaultMoney(amount: number): string {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`
}

/**
 * Overdue invoices lock sale-order confirm and invoice create.
 * Quotations stay writable so sales can still price and send an offer.
 * Credit-limit overage still blocks every document type.
 */
export function evaluateCustomerCreditGate(input: CustomerCreditGateInput): CustomerCreditGateResult {
  const formatMoney = input.formatMoney ?? defaultMoney
  const overdueBalance = Math.max(0, Number(input.overdueBalance) || 0)
  const overdueCount = Math.max(0, Math.trunc(Number(input.overdueCount) || 0))
  const outstandingBalance = Math.max(0, Number(input.outstandingBalance) || 0)
  const newOrderTotal = Math.max(0, Number(input.newOrderTotal) || 0)
  const creditLimit = Math.max(0, Number(input.creditLimit) || 0)

  const isLocked = overdueBalance > 0
  const creditAvailable = creditLimit > 0 ? Math.max(0, creditLimit - outstandingBalance) : -1
  const creditLimitExceeded = creditLimit > 0 && (outstandingBalance + newOrderTotal) > creditLimit
  const blockOverdue = input.document !== 'quote'

  let message = ''
  if (isLocked && blockOverdue) {
    message = `Account locked — ${overdueCount} overdue invoice${overdueCount === 1 ? '' : 's'} totalling ${formatMoney(overdueBalance)}. Clear outstanding bills to unlock.`
  } else if (creditLimitExceeded) {
    message = `Credit limit of ${formatMoney(creditLimit)} exceeded. Available: ${formatMoney(creditAvailable)}. Outstanding after credits: ${formatMoney(outstandingBalance)}.`
  } else if (isLocked) {
    message = `Customer has ${overdueCount} overdue invoice${overdueCount === 1 ? '' : 's'} totalling ${formatMoney(overdueBalance)}. Quotation can be saved; confirming a sale order or creating an invoice stays blocked until overdue invoices are cleared.`
  }

  // Payment policy: a corporate customer without approved credit pays on
  // receipt — nothing new is confirmed or invoiced while money is owed.
  if (input.payOnReceipt && blockOverdue && outstandingBalance > 0) {
    return {
      ok: false,
      payOnReceiptBlocked: true,
      isLocked,
      creditLimitExceeded: false,
      creditAvailable: 0,
      message: `Pays on receipt (no approved credit) — ${formatMoney(outstandingBalance)} is still unpaid. Collect it first, or apply for credit (Contacts → Credit).`,
    }
  }

  return {
    ok: !(blockOverdue && isLocked) && !creditLimitExceeded,
    isLocked,
    creditLimitExceeded,
    creditAvailable,
    message,
  }
}

/** Credit standings under which a corporate customer pays on receipt. */
const PAY_ON_RECEIPT_STANDINGS = new Set(['none', 'suspended', 'revoked'])

/**
 * Does this customer pay on receipt? Corporate customers do until credit is
 * approved (or while it is suspended / revoked). Individuals are not covered
 * by the corporate credit policy. An unknown standing (an old cached record)
 * is not treated as pay-on-receipt; the server decides from the database.
 */
export function isPayOnReceipt(customer: { type?: string | null; clientType?: string | null; creditStatus?: string | null } | null | undefined): boolean {
  if (!customer || !customer.creditStatus) return false
  const kind = customer.type ?? (customer.clientType === 'individual' ? 'individual' : 'company')
  return kind === 'company' && PAY_ON_RECEIPT_STANDINGS.has(customer.creditStatus)
}
