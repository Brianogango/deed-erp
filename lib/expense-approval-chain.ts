import { rolesFromThresholds, type ApprovalThreshold } from '@/lib/sales-approval-rules'

export type ExpenseApprovalStep = {
  role: string
  status: 'pending' | 'approved' | 'rejected'
  by?: string
  at?: string
}

const EXPENSE_AMOUNT_THRESHOLD = 50_000

/** Default ladder when no DB `expense` approval rule is active. */
export function defaultExpenseApproverRoles(amount: number): string[] {
  if (amount > EXPENSE_AMOUNT_THRESHOLD) return ['finance_officer', 'director']
  return ['finance_officer']
}

/** Build sequential approval chain from amount + optional DB thresholds. */
export function buildExpenseApprovalChain(
  amount: number,
  thresholds?: ApprovalThreshold[] | null,
): ExpenseApprovalStep[] {
  let roles = defaultExpenseApproverRoles(amount)
  if (Array.isArray(thresholds) && thresholds.length > 0) {
    const fromDb = rolesFromThresholds(thresholds, amount)
    if (fromDb && fromDb.length > 0) roles = fromDb
  }
  const unique = [...new Set(roles.filter(Boolean))]
  if (unique.length === 0) unique.push('finance_officer')
  return unique.map(role => ({ role, status: 'pending' as const }))
}

export function expenseChainIsComplete(chain?: ExpenseApprovalStep[]) {
  return Boolean(chain?.length) && (chain ?? []).every(s => s.status === 'approved')
}

export function currentPendingExpenseStep(chain?: ExpenseApprovalStep[]) {
  return chain?.find(s => s.status === 'pending')
}

export function canUserApproveExpenseStep(userRole: string | undefined, chain?: ExpenseApprovalStep[]) {
  if (!userRole) return false
  const pending = currentPendingExpenseStep(chain)
  if (!pending) return false
  return pending.role === userRole
}

/**
 * Expense review authority used consistently by queue, modal and store.
 *
 * - Director is the break-glass approver and may action any pending expense step.
 * - Finance Officer may action only a Finance Officer step.
 * - A legacy expense with no chain may still be reviewed by Director/Finance.
 * - Other roles cannot post expense approvals because the server posting endpoint
 *   is intentionally sealed to Finance/Director.
 */
export function canUserReviewExpense(
  userRole: string | undefined,
  chain?: ExpenseApprovalStep[],
) {
  if (!userRole) return false
  if (!chain?.length) return userRole === 'director' || userRole === 'finance_officer'
  if (!currentPendingExpenseStep(chain)) return false
  if (userRole === 'director') return true
  return userRole === 'finance_officer' && canUserApproveExpenseStep(userRole, chain)
}

export function advanceExpenseApproval(params: {
  chain: ExpenseApprovalStep[]
  approved: boolean
  reviewerRole: string
  reviewerName: string
  reviewedAt?: string
}): ExpenseApprovalStep[] {
  const at = params.reviewedAt ?? new Date().toISOString()
  const idx = params.chain.findIndex(s => s.status === 'pending')
  if (idx === -1) return params.chain

  return params.chain.map((step, i) => {
    if (i !== idx) return step
    return {
      ...step,
      status: params.approved ? 'approved' : 'rejected',
      by: params.reviewerName,
      at,
    }
  })
}
