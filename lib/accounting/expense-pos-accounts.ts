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

/** Historical cashbook bank labels used by expense/POS blob journals. */
export function bankAccountLabelForId(bankAccountId?: string, method?: string): string {
  const id = bankAccountId
    || (method === 'mpesa' || method === 'mpesa_company'
      ? 'mpesa'
      : method === 'cash' || method === 'petty_cash'
        ? 'cash'
        : 'ncba')
  if (id === 'mpesa') return '2210 - M-Pesa Paybill'
  if (id === 'cash') return '2211 - Petty Cash'
  if (id === 'equity') return '2202 - Equity Bank'
  if (id === 'kcb') return '2203 - KCB Bank'
  return '2201 - NCBA Bank'
}

export function bankAccountIdForPaymentMethod(method?: string, bankAccountId?: string): string {
  if (bankAccountId) return bankAccountId
  if (method === 'mpesa' || method === 'mpesa_company') return 'mpesa'
  if (method === 'cash' || method === 'petty_cash') return 'cash'
  return 'ncba'
}
