/**
 * Live CoA role → code/label map (Finance Phase 1).
 *
 * Do NOT renumber production accounts. Guide concepts resolve through these roles.
 * Labels match historical posting strings in invoice-journals (not always full CoA names).
 */

export type CoaRole =
  | 'ar'
  | 'ap'
  | 'output_vat'
  | 'customer_deposits'
  | 'customer_credits'
  | 'inventory'
  | 'cogs'
  | 'grni'
  | 'revenue_products'
  | 'bank_absa'
  | 'bank_equity'
  | 'cash_mobile'
  | 'employee_reimbursements'
  | 'outstanding_receipts'
  | 'outstanding_payments'
  | 'input_vat'
  | 'bank_charges'
  | 'interest_income'
  | 'salary_expense'
  | 'employer_nssf_expense'
  | 'employer_housing_levy_expense'
  | 'net_payroll_payable'
  | 'paye_payable'
  | 'nssf_payable'
  | 'shif_payable'
  | 'housing_levy_payable'
  | 'pension_payable'
  | 'other_payroll_deductions'
  | 'employee_advances'

/** Canonical live codes — keep stable. */
export const COA_ROLE_CODES: Record<CoaRole, string> = {
  ar: '1800',
  ap: '3000',
  output_vat: '3301',
  customer_deposits: '3100',
  customer_credits: '3102',
  inventory: '1200',
  cogs: '6001',
  grni: '3201',
  revenue_products: '5000',
  bank_absa: '2201',
  bank_equity: '2202',
  cash_mobile: '2211',
  employee_reimbursements: '3105',
  outstanding_receipts: '1805',
  outstanding_payments: '3005',
  input_vat: '1150',
  bank_charges: '6401',
  interest_income: '5105',
  salary_expense: '6201',
  employer_nssf_expense: '6202',
  employer_housing_levy_expense: '6203',
  net_payroll_payable: '3110',
  paye_payable: '3305',
  nssf_payable: '3306',
  shif_payable: '3307',
  housing_levy_payable: '3308',
  pension_payable: '3309',
  other_payroll_deductions: '3311',
  employee_advances: '1810',
}

/**
 * Labels used on journal lines today.
 * Prefer these over CoA template display names so dual-write refs stay consistent.
 */
export const COA_ROLE_LABELS: Record<CoaRole, string> = {
  ar: '1800 - Accounts Receivable',
  ap: '3000 - Accounts Payable',
  output_vat: '3301 - Output VAT Payable',
  customer_deposits: '3100 - Customer Deposits',
  customer_credits: '3102 - Customer Credits',
  inventory: '1200 - Inventory',
  cogs: '6001 - Cost of Goods Sold',
  grni: '3201 - Accruals',
  revenue_products: '5000',
  bank_absa: '2201 - ABSA Bank',
  bank_equity: '2202 - Equity Bank',
  cash_mobile: '2211 - Petty Cash / Mobile Money',
  employee_reimbursements: '3105 - Employee Reimbursements Payable',
  outstanding_receipts: '1805 - Outstanding Receipts',
  outstanding_payments: '3005 - Outstanding Payments',
  input_vat: '1150 - VAT Input',
  bank_charges: '6401 - Bank Charges',
  interest_income: '5105 - Interest Income',
  salary_expense: '6201 - Salaries and Wages',
  employer_nssf_expense: '6202 - Employer NSSF Expense',
  employer_housing_levy_expense: '6203 - Employer Housing Levy Expense',
  net_payroll_payable: '3110 - Net Payroll Payable',
  paye_payable: '3305 - PAYE Payable',
  nssf_payable: '3306 - NSSF Payable',
  shif_payable: '3307 - SHIF Payable',
  housing_levy_payable: '3308 - Affordable Housing Levy Payable',
  pension_payable: '3309 - Pension Payable',
  other_payroll_deductions: '3311 - Other Payroll Deductions Payable',
  employee_advances: '1810 - Employee Salary Advances',
}

export function labelForRole(role: CoaRole): string {
  return COA_ROLE_LABELS[role]
}

export function codeForRole(role: CoaRole): string {
  return COA_ROLE_CODES[role]
}

/** Resolve payment method → bank/cash role (customer receipts / vendor payouts). */
export function cashAccountRoleForMethod(method?: string): CoaRole {
  switch (String(method || '').toLowerCase()) {
    case 'bank_transfer':
    case 'bank':
      return 'bank_absa'
    case 'mpesa':
    case 'cash':
    default:
      return 'cash_mobile'
  }
}

/** Map cashbook / blob bank account id → CoA cash role. */
export function cashAccountRoleForBankId(bankAccountId?: string): CoaRole {
  const id = String(bankAccountId || '').toLowerCase()
  if (id.includes('equity')) return 'bank_equity'
  if (id.includes('mpesa') || id.includes('petty') || id.includes('cash')) return 'cash_mobile'
  if (id.includes('absa') || id.includes('ncba') || id.includes('im') || id.includes('i&m')) {
    return 'bank_absa'
  }
  return 'bank_absa'
}
