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
