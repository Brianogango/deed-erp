export type BudgetActualInput = {
  plannedAmount: number
  debit: number
  credit: number
  accountType: string
}

const money = (value: number) => Math.round(Number(value || 0) * 100) / 100

export function signedActual(input: Omit<BudgetActualInput, 'plannedAmount'>): number {
  const type = String(input.accountType || '').toLowerCase()
  return money(type === 'revenue' || type === 'income'
    ? input.credit - input.debit
    : input.debit - input.credit)
}

export function budgetVariance(input: BudgetActualInput) {
  const planned = money(input.plannedAmount)
  const actual = signedActual(input)
  return {
    planned,
    actual,
    variance: money(planned - actual),
    achievementPct: planned === 0 ? null : money((actual / planned) * 100),
  }
}
