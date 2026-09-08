export type CreditSalesDocument = 'quote' | 'order' | 'invoice'

export type CustomerCreditGateInput = {
  overdueBalance: number
  overdueCount: number
  creditLimit: number
  outstandingBalance: number
  newOrderTotal: number
  document: CreditSalesDocument
  formatMoney?: (amount: number) => string
}

export type CustomerCreditGateResult = {
  ok: boolean
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

  return {
    ok: !(blockOverdue && isLocked) && !creditLimitExceeded,
    isLocked,
    creditLimitExceeded,
    creditAvailable,
    message,
  }
}
