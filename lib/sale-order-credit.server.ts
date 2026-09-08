import 'server-only'
import prisma from '@/lib/prisma'
import { assertQuoteNotExpired } from '@/lib/sale-order-expiry'
import { loadAppState } from '@/lib/server-store'
import { evaluateCustomerCreditGate, type CreditSalesDocument } from '@/lib/customer-credit-gate'

export { assertQuoteNotExpired }

/** Prisma `DocumentStatus` values that can still carry an unpaid residual. */
const OPEN_INVOICE_STATUSES = [
  'approved',
  'invoiced',
  'pending_approval',
  'dispatched',
  'delivered',
  'partially_paid',
  'paid',
] as const

const CREDIT_OVERRIDE_ROLES = new Set(['director', 'finance_officer'])

export type SaleOrderCreditCheck =
  | { ok: true }
  | { ok: false; status: 403 | 409; error: string }

/**
 * Hard gate for sale-order confirm and customer-invoice create.
 * Overdue invoices do not block quotation create/save.
 * Credit-limit overage still blocks every document type unless Finance/Director.
 */
export async function assertSaleOrderCreditOnConfirm(opts: {
  clientId: string | null | undefined
  orderTotal: number
  role: string
  document?: CreditSalesDocument
}): Promise<SaleOrderCreditCheck> {
  const clientId = opts.clientId
  if (!clientId) return { ok: true }

  const canOverride = CREDIT_OVERRIDE_ROLES.has(opts.role)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [client, openInvoices, state] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientId },
      select: { creditLimit: true, name: true },
    }),
    prisma.invoice.findMany({
      where: {
        clientId,
        status: { in: [...OPEN_INVOICE_STATUSES] },
      },
      select: { totalAmount: true, amountPaid: true, dueDate: true, status: true },
    }),
    loadAppState(['deed_customerCredits']),
  ])

  if (!client) return { ok: true }

  let overdueBalance = 0
  let overdueCount = 0
  let outstanding = 0
  for (const inv of openInvoices) {
    const residual = Math.max(0, Number(inv.totalAmount ?? 0) - Number(inv.amountPaid ?? 0))
    outstanding += residual
    if (inv.dueDate && new Date(inv.dueDate) < today && residual > 0) {
      overdueBalance += residual
      overdueCount += 1
    }
  }

  // Net available/partially-used store credit against outstanding before
  // comparing to the limit — the client-side check already does this, and
  // without it the server can reject an order the customer's real balance
  // would cover (a false-positive block, not a security gap, but real
  // friction that forces an unnecessary Finance/Director override).
  const credits = Array.isArray(state?.deed_customerCredits) ? state.deed_customerCredits as any[] : []
  const availableCredit = credits
    .filter(c => c?.customerId === clientId && ['available', 'partially_used'].includes(c?.status))
    .reduce((sum, c) => sum + Math.max(0, Number(c?.balance) || 0), 0)
  outstanding = Math.max(0, outstanding - availableCredit)
  overdueBalance = Math.max(0, overdueBalance - availableCredit)

  const gate = evaluateCustomerCreditGate({
    overdueBalance,
    overdueCount: overdueBalance > 0 ? overdueCount : 0,
    creditLimit: Number(client.creditLimit ?? 0),
    outstandingBalance: outstanding,
    newOrderTotal: opts.orderTotal,
    document: opts.document ?? 'order',
  })

  if (!gate.ok && !canOverride) {
    const action = opts.document === 'invoice' ? 'invoice' : 'confirm'
    const error = gate.isLocked && (opts.document ?? 'order') !== 'quote'
      ? `${gate.message.replace(/Clear outstanding bills to unlock\.$/, `Clear overdue invoices or ask Finance/Director to ${action}.`)}`
      : `${gate.message.replace(/\.$/, '')}. Ask Finance/Director to ${action}, or reduce the order.`
    return { ok: false, status: 409, error }
  }

  return { ok: true }
}
