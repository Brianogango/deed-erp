import 'server-only'
import prisma from '@/lib/prisma'
import { assertQuoteNotExpired } from '@/lib/sale-order-expiry'
import { loadAppState } from '@/lib/server-store'

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
 * Hard gate for quotation → sale confirmation.
 * - Overdue open invoices: blocked unless Finance/Director
 * - Credit limit exceeded: blocked unless Finance/Director
 */
export async function assertSaleOrderCreditOnConfirm(opts: {
  clientId: string | null | undefined
  orderTotal: number
  role: string
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

  if (overdueBalance > 0 && !canOverride) {
    return {
      ok: false,
      status: 409,
      error: `Account locked — ${overdueCount} overdue invoice${overdueCount > 1 ? 's' : ''} totalling KES ${overdueBalance.toLocaleString('en-KE')}. Clear overdue invoices or ask Finance/Director to confirm.`,
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

  const creditLimit = Number(client.creditLimit ?? 0)
  if (creditLimit > 0) {
    const projected = outstanding + Math.max(0, Number(opts.orderTotal) || 0)
    if (projected > creditLimit && !canOverride) {
      const available = Math.max(0, creditLimit - outstanding)
      return {
        ok: false,
        status: 409,
        error: `Credit limit of KES ${creditLimit.toLocaleString('en-KE')} exceeded (available KES ${available.toLocaleString('en-KE')}). Ask Finance/Director to confirm, or reduce the order.`,
      }
    }
  }

  return { ok: true }
}
