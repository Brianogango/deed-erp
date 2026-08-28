import { cashAccountRoleForBankId, labelForRole } from '@/lib/accounting/coa-roles'

/**
 * Expense / POS account label helpers (Finance Phase 7).
 * Labels match historical store.tsx journal strings for dual-write parity.
 */

export type ExpenseCategoryKey =
  | 'courier'
  | 'office_supplies'
  | 'water'
  | 'printing'
  | 'transport'
  | 'meals'
  | 'utilities'
  | 'software'
  | 'hardware'
  | 'maintenance'
  | 'other'
  | string

export function expenseAccountForCategory(category?: ExpenseCategoryKey): string {
  // Official Deed CoA (2025) operating-expense block.
  const map: Record<string, string> = {
    courier: '6519 - Courier and Delivery',
    office_supplies: '6518 - Office Expenses',
    water: '6506 - Water and Electricity',
    printing: '6504 - Printing and Stationery',
    transport: '6507 - Fuel and Transport',
    meals: '6511 - Subsistence and Accommodation',
    utilities: '6506 - Water and Electricity',
    software: '6503 - Computer Expenses',
    hardware: '6521 - Expensed Assets',
    maintenance: '6505 - Repairs and Maintenance',
    other: '6599 - Other Operating Expenses',
  }
  return map[category ?? 'other'] ?? '6599 - Other Operating Expenses'
}

/**
 * Resolve cashbook/POS tender ids onto the canonical live CoA.
 *
 * The strict posting engine resolves by account code. Legacy UI labels used
 * 2210 for M-Pesa and 2203 for KCB even though those codes are not guaranteed
 * in the canonical CoA, causing otherwise-valid POS/expense journals to fail.
 */
export function bankAccountLabelForId(bankAccountId?: string, method?: string): string {
  const id = bankAccountId
    || (method === 'mpesa' || method === 'mpesa_company'
      ? 'mpesa'
      : method === 'cash' || method === 'petty_cash'
        ? 'cash'
        : 'ncba')
  return labelForRole(cashAccountRoleForBankId(id))
}

export function bankAccountIdForPaymentMethod(method?: string, bankAccountId?: string): string {
  if (bankAccountId) return bankAccountId
  if (method === 'mpesa' || method === 'mpesa_company') return 'mpesa'
  if (method === 'cash' || method === 'petty_cash') return 'cash'
  return 'ncba'
}
