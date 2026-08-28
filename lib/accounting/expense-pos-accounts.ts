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
  const map: Record<string, string> = {
    courier: '6420 - Courier & Delivery',
    office_supplies: '6405 - Office Supplies',
    water: '6415 - Utilities - Water',
    printing: '6410 - Printing & Stationery',
    transport: '6400 - Transport & Fuel',
    meals: '6430 - Meals & Entertainment',
    utilities: '6415 - Utilities',
    software: '6440 - Software & Subscriptions',
    hardware: '1510 - Equipment & Hardware',
    maintenance: '6450 - Maintenance & Repairs',
    other: '6499 - Other Operating Expenses',
  }
  return map[category ?? 'other'] ?? '6499 - Other Operating Expenses'
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
