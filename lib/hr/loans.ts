/** Staff loan repayment rules shared by payroll creation and payroll posting. */

export interface LoanLike {
  id: string
  issueDate: Date | string
  monthlyDeduction: number
  outstanding: number
}

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/** What this month's payroll should recover across the employee's open loans (oldest loan first). */
export function plannedLoanDeduction(loans: LoanLike[], periodEnd: Date): number {
  let total = 0
  for (const loan of loans) {
    if (new Date(loan.issueDate).getTime() > periodEnd.getTime()) continue
    total += Math.min(Math.max(0, loan.monthlyDeduction), Math.max(0, loan.outstanding))
  }
  return money(total)
}

export interface LoanAllocation { id: string; amount: number; outstandingAfter: number; cleared: boolean }

/**
 * Spread the amount actually deducted from a payslip across the open loans, oldest first,
 * never more than a loan's monthly instalment or its outstanding balance.
 */
export function allocateLoanRepayment(loans: LoanLike[], deducted: number): LoanAllocation[] {
  let remaining = money(deducted)
  const out: LoanAllocation[] = []
  const ordered = [...loans].sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime())
  for (const loan of ordered) {
    if (remaining <= 0.004) break
    const take = money(Math.min(remaining, Math.max(0, loan.monthlyDeduction), Math.max(0, loan.outstanding)))
    if (take <= 0) continue
    const after = money(loan.outstanding - take)
    out.push({ id: loan.id, amount: take, outstandingAfter: after, cleared: after <= 0.005 })
    remaining = money(remaining - take)
  }
  return out
}
