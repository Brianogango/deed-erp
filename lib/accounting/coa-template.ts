/**
 * Zero-balance Chart of Accounts template for bootstrap when deed_accounts
 * is missing in production. Never includes demo opening balances.
 * KES-only — no multi-currency accounts.
 */

export type CoaAccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

export type CoaTemplateAccount = {
  code: string
  name: string
  type: CoaAccountType
  group: string
  subGroup: string
  balance: 0
  isDynamic?: boolean
  dynamicKey?: string
  notes?: string
}

const PRODUCTS = [
  'Laptops', 'Accessories', 'Desktop / Combo', 'Monitors', 'Servers', 'Storage',
  'Power Backup Solutions', 'Printers', 'Software Licenses', 'Parts and Components',
  'Printer Consumables', 'Networking Equipment', 'Consumer Electronics',
]

function productCodes(prefix: string, group: string, subGroup: string): CoaTemplateAccount[] {
  return PRODUCTS.map((name, i) => ({
    code: `${prefix}${String(i + 1).padStart(2, '0')}`,
    name,
    type: 'asset' as const,
    group,
    subGroup,
    balance: 0 as const,
  }))
}

/** Official Deed CoA (2025) revenue product grid: 5001-5013. */
function productRevenueRows(): CoaTemplateAccount[] {
  return PRODUCTS.map((name, i) => ({
    code: `50${String(i + 1).padStart(2, '0')}`,
    name,
    type: 'revenue' as const,
    group: 'Revenue - Products',
    subGroup: 'Product',
    balance: 0 as const,
  }))
}

/** Official purchase grids: 61xx local, 62xx import. */
function purchaseRows(prefix: '61' | '62', group: string): CoaTemplateAccount[] {
  return PRODUCTS.map((name, i) => ({
    code: `${prefix}${String(i + 1).padStart(2, '0')}`,
    name: prefix === '62' ? `${name} (Import)` : name,
    type: 'expense' as const,
    group,
    subGroup: group,
    balance: 0 as const,
  }))
}

const OPERATING_EXPENSES: CoaTemplateAccount[] = [
  'Advertisement and Promotion',
  'Auditors Remuneration',
  'Computer Expenses',
  'Printing and Stationery',
  'Repairs and Maintenance',
  'Water and Electricity',
  'Fuel and Transport',
  'Rent and Service Charge',
  'Legal Expenses',
  'Telephone and Internet',
  'Subsistence and Accommodation',
  'Bad Debts Written Off',
  'Provision for Bad and Doubtful Debts',
  'Gifts and Donations',
  'Loss on Disposal of Assets',
  'Management Fees',
  'Depreciation and Amortization',
  'Office Expenses',
  'Courier and Delivery',
  'Discount Allowed',
  'Expensed Assets',
].map((name, i) => ({
  code: `65${String(i + 1).padStart(2, '0')}`,
  name,
  type: 'expense' as const,
  group: 'Operating Expenses',
  subGroup: 'Operating and Administrative',
  balance: 0 as const,
}))

const EMPLOYMENT_EXPENSES: CoaTemplateAccount[] = [
  'Salaries',
  'Wages',
  'Commission',
  'Staff Bonus',
  'Training Expenses',
  'Contribution to Pension Fund (NSSF)',
  'Leave Encashment',
  'Any Other Employment Costs',
  'Affordable Housing Levy (Employer)',
].map((name, i) => ({
  code: `66${String(i + 1).padStart(2, '0')}`,
  name,
  type: 'expense' as const,
  group: 'Employment Expenses',
  subGroup: 'Employment Expenses',
  balance: 0 as const,
}))

const FINANCIAL_EXPENSES: CoaTemplateAccount[] = [
  'Interest Expense',
  'Commitment Fees',
  'Bank Charges',
  'Insurance',
  'Realized and Unrealized Exchange Loss',
].map((name, i) => ({
  code: `67${String(i + 1).padStart(2, '0')}`,
  name,
  type: 'expense' as const,
  group: 'Financial Expenses',
  subGroup: 'Financial Expenses',
  balance: 0 as const,
}))

/** Canonical zero-balance CoA used only when both blob and Prisma CoA are empty. */
export function buildZeroBalanceCoaTemplate(): CoaTemplateAccount[] {
  const a: CoaTemplateAccount[] = []
  a.push(...productCodes('11', 'Inventory - Opening', 'Raw Materials'))
  a.push(...productCodes('12', 'Inventory - Opening', 'Work in Progress'))
  a.push(...productCodes('13', 'Inventory - Opening', 'Finished Products'))
  a.push(...productCodes('14', 'Inventory - Closing', 'Raw Materials'))
  a.push(...productCodes('15', 'Inventory - Closing', 'Work in Progress'))
  a.push(...productCodes('16', 'Inventory - Closing', 'Finished Products'))

  const revenueProducts = productRevenueRows()
  const localPurchases = purchaseRows('61', 'Local Purchases')
  const importPurchases = purchaseRows('62', 'Import Purchases')

  a.push(
    { code: '1150', name: 'VAT Input', type: 'asset', group: 'Receivables - Tax', subGroup: 'VAT', balance: 0, notes: 'Input VAT recoverable on vendor bills' },
    { code: '1200', name: 'Inventory', type: 'asset', group: 'Inventory - Closing', subGroup: 'Finished Products', balance: 0 },
    // PPE cost + accumulated depreciation + intangibles
    { code: '1701', name: 'Computer & Accessories', type: 'asset', group: 'PPE - Cost', subGroup: 'Cost', balance: 0 },
    { code: '1702', name: 'Furniture & Fittings', type: 'asset', group: 'PPE - Cost', subGroup: 'Cost', balance: 0 },
    { code: '1703', name: 'Office Equipment', type: 'asset', group: 'PPE - Cost', subGroup: 'Cost', balance: 0 },
    { code: '1704', name: 'Software', type: 'asset', group: 'PPE - Cost', subGroup: 'Cost', balance: 0 },
    { code: '1705', name: 'Goodwill', type: 'asset', group: 'PPE - Cost', subGroup: 'Cost', balance: 0 },
    { code: '1751', name: 'Accum. Depr. Computer & Accessories', type: 'asset', group: 'Accumulated Depreciation', subGroup: 'Accum. Depr.', balance: 0, notes: 'Contra asset' },
    { code: '1752', name: 'Accum. Depr. Furniture & Fittings', type: 'asset', group: 'Accumulated Depreciation', subGroup: 'Accum. Depr.', balance: 0, notes: 'Contra asset' },
    { code: '1753', name: 'Accum. Depr. Office Equipment', type: 'asset', group: 'Accumulated Depreciation', subGroup: 'Accum. Depr.', balance: 0, notes: 'Contra asset' },
    { code: '1754', name: 'Accum. Depr. Software', type: 'asset', group: 'Accumulated Depreciation', subGroup: 'Accum. Depr.', balance: 0, notes: 'Contra asset' },
    // Receivables (consolidated dynamic AR + clearing + advances)
    { code: '1800', name: 'Accounts Receivable (Products)', type: 'asset', group: 'Receivables - Product', subGroup: 'Product', balance: 0, isDynamic: true, dynamicKey: 'ar' },
    { code: '1931', name: 'Employee Salary Advances', type: 'asset', group: 'Receivables - Other', subGroup: 'Other Debtors', balance: 0 },
    { code: '1933', name: 'Outstanding Receipts', type: 'asset', group: 'Receivables - Other', subGroup: 'Other Debtors', balance: 0, notes: 'Unallocated customer receipts awaiting invoice application' },
    // Cash & banks
    { code: '2201', name: 'ABSA Bank', type: 'asset', group: 'Cash at Bank', subGroup: 'Cash at Bank', balance: 0 },
    { code: '2202', name: 'Equity Bank', type: 'asset', group: 'Cash at Bank', subGroup: 'Cash at Bank', balance: 0 },
    { code: '2210', name: 'M-Pesa Paybill', type: 'asset', group: 'Cash at Bank', subGroup: 'Mobile Money', balance: 0 },
    { code: '2211', name: 'Petty Cash / Mobile Money', type: 'asset', group: 'Cash in Hand', subGroup: 'Cash in Hand', balance: 0 },
    // Payables (consolidated dynamic AP + clearing + accruals)
    { code: '3000', name: 'Accounts Payable (Products)', type: 'liability', group: 'Payables - Product', subGroup: 'Product', balance: 0, isDynamic: true, dynamicKey: 'ap' },
    { code: '3100', name: 'Customer Deposits', type: 'liability', group: 'Customer Liabilities', subGroup: 'Deposits', balance: 0, notes: 'Layby / deposit cash held until goods collected' },
    { code: '3201', name: 'Accruals', type: 'liability', group: 'Accruals', subGroup: 'Accruals', balance: 0 },
    { code: '3202', name: 'Outstanding Payments', type: 'liability', group: 'Payables - Clearing', subGroup: 'Outstanding', balance: 0, notes: 'Unallocated vendor payments awaiting bill application' },
    // Statutory & payroll liabilities
    { code: '3301', name: 'Output VAT Payable (16%)', type: 'liability', group: 'Statutory Liabilities', subGroup: 'Current Liabilities', balance: 0 },
    { code: '3302', name: 'PAYE Payable', type: 'liability', group: 'Statutory Liabilities', subGroup: 'Payroll', balance: 0 },
    { code: '3303', name: 'NSSF Payable', type: 'liability', group: 'Statutory Liabilities', subGroup: 'Payroll', balance: 0 },
    { code: '3304', name: 'NHIF / SHIF Payable', type: 'liability', group: 'Statutory Liabilities', subGroup: 'Payroll', balance: 0 },
    { code: '3305', name: 'Affordable Housing Levy Payable', type: 'liability', group: 'Statutory Liabilities', subGroup: 'Payroll', balance: 0 },
    { code: '3306', name: 'Pension Payable', type: 'liability', group: 'Statutory Liabilities', subGroup: 'Payroll', balance: 0 },
    { code: '3310', name: 'Net Payroll Payable', type: 'liability', group: 'Payroll Liabilities', subGroup: 'Employees', balance: 0 },
    { code: '3311', name: 'Other Payroll Deductions Payable', type: 'liability', group: 'Payroll Liabilities', subGroup: 'Other Deductions', balance: 0 },
    { code: '3312', name: 'Employee Reimbursements Payable', type: 'liability', group: 'Accruals', subGroup: 'Accruals', balance: 0 },
    { code: '3313', name: 'Customer Credits', type: 'liability', group: 'Customer Liabilities', subGroup: 'Credits', balance: 0, notes: 'Credit notes, cancelled paid-invoice credits, and buy-back store credit' },
    // Non-current liabilities
    { code: '3401', name: 'Bank Loan', type: 'liability', group: 'Non-Current Liabilities', subGroup: 'Non-Current Liabilities', balance: 0 },
    { code: '3402', name: 'Directors Account', type: 'liability', group: 'Non-Current Liabilities', subGroup: 'Non-Current Liabilities', balance: 0 },
    // Equity
    { code: '4001', name: 'Share Capital', type: 'equity', group: 'Equity', subGroup: 'Equity', balance: 0 },
    { code: '4002', name: 'Retained Earnings', type: 'equity', group: 'Equity', subGroup: 'Equity', balance: 0 },
    { code: '4003', name: 'Current Year P&L', type: 'equity', group: 'Equity', subGroup: 'Equity', balance: 0, isDynamic: true, dynamicKey: 'net_profit' },
    { code: '4004', name: 'Opening Balance Equity', type: 'equity', group: 'Equity', subGroup: 'Equity', balance: 0, notes: 'Offsetting account for opening stock and opening balances' },
    // Revenue
    { code: '5000', name: 'Sales — Products (Invoices)', type: 'revenue', group: 'Revenue - Products', subGroup: 'Product', balance: 0, isDynamic: true, dynamicKey: 'revenue' },
    ...revenueProducts,
    { code: '5101', name: 'On-Demand IT', type: 'revenue', group: 'Revenue - Services', subGroup: 'Solutions and Services', balance: 0 },
    { code: '5102', name: 'IT Consultancy', type: 'revenue', group: 'Revenue - Services', subGroup: 'Solutions and Services', balance: 0 },
    { code: '5103', name: 'Managed IT Infrastructure', type: 'revenue', group: 'Revenue - Services', subGroup: 'Solutions and Services', balance: 0 },
    { code: '5104', name: 'Server Administration', type: 'revenue', group: 'Revenue - Services', subGroup: 'Solutions and Services', balance: 0 },
    { code: '5105', name: 'Cloud Solutions', type: 'revenue', group: 'Revenue - Services', subGroup: 'Solutions and Services', balance: 0 },
    { code: '5106', name: 'Data Backup', type: 'revenue', group: 'Revenue - Services', subGroup: 'Solutions and Services', balance: 0 },
    { code: '5107', name: 'Data Recovery', type: 'revenue', group: 'Revenue - Services', subGroup: 'Solutions and Services', balance: 0 },
    { code: '5108', name: 'Power Backup', type: 'revenue', group: 'Revenue - Services', subGroup: 'Solutions and Services', balance: 0 },
    { code: '5109', name: 'Enterprise OEM Software Services', type: 'revenue', group: 'Revenue - Services', subGroup: 'Solutions and Services', balance: 0 },
    { code: '5110', name: 'Security Solutions', type: 'revenue', group: 'Revenue - Services', subGroup: 'Solutions and Services', balance: 0 },
    { code: '5121', name: 'Hardware Support', type: 'revenue', group: 'Revenue - Services', subGroup: 'Expert Repair Services', balance: 0 },
    { code: '5122', name: 'Software Support', type: 'revenue', group: 'Revenue - Services', subGroup: 'Expert Repair Services', balance: 0 },
    { code: '5099', name: 'Sales Returns & Refunds', type: 'revenue', group: 'Revenue - Products', subGroup: 'Product', balance: 0, notes: 'Contra revenue — debit entries reduce revenue' },
    // Other income
    { code: '5200', name: 'Sales Discounts & Loyalty Redemptions', type: 'revenue', group: 'Revenue - Contra', subGroup: 'Discounts', balance: 0, notes: 'Contra-revenue for approved sales discounts and POS loyalty redemptions' },
    { code: '5201', name: 'Dividends and Interest', type: 'revenue', group: 'Other Income', subGroup: 'Other Income', balance: 0 },
    { code: '5202', name: 'Commission', type: 'revenue', group: 'Other Income', subGroup: 'Other Income', balance: 0 },
    { code: '5203', name: 'Profit / Surplus on Disposal of Assets', type: 'revenue', group: 'Other Income', subGroup: 'Other Income', balance: 0 },
    { code: '5204', name: 'Bad Debts Recovered', type: 'revenue', group: 'Other Income', subGroup: 'Other Income', balance: 0 },
    { code: '5205', name: 'Discount Received', type: 'revenue', group: 'Other Income', subGroup: 'Other Income', balance: 0 },
    { code: '5206', name: 'Realized Exchange Gain', type: 'revenue', group: 'Other Income', subGroup: 'Finance', balance: 0 },
    // Expenditure
    { code: '6001', name: 'Cost of Goods Sold', type: 'expense', group: 'Direct Expenses', subGroup: 'COGS', balance: 0 },
    ...localPurchases,
    // Debit when a buy-back is added as 3313 credit instead of paid in cash.
    { code: '6114', name: 'Trade-in Purchases', type: 'expense', group: 'Local Purchases', subGroup: 'Trade-in', balance: 0, notes: 'Buy-back amount when settled as store credit instead of cash' },
    ...importPurchases,
    { code: '6301', name: "Solutions and Expert Repair Services' Costs", type: 'expense', group: 'Direct Expenses', subGroup: 'Direct Expenses', balance: 0 },
    { code: '6302', name: 'Direct Salaries', type: 'expense', group: 'Direct Expenses', subGroup: 'Direct Expenses', balance: 0 },
    { code: '6303', name: 'Direct Wages', type: 'expense', group: 'Direct Expenses', subGroup: 'Direct Expenses', balance: 0 },
    { code: '6304', name: 'Direct Commission', type: 'expense', group: 'Direct Expenses', subGroup: 'Direct Expenses', balance: 0 },
    { code: '6305', name: 'Inventory Adjustment', type: 'expense', group: 'Direct Expenses', subGroup: 'Inventory', balance: 0, notes: 'Stock count / reconfiguration inventory adjustment' },
    { code: '6306', name: 'Inventory Write-off', type: 'expense', group: 'Direct Expenses', subGroup: 'Inventory', balance: 0, notes: 'Damaged / obsolete stock write-off' },
    { code: '6307', name: 'Purchase Price Difference', type: 'expense', group: 'Direct Expenses', subGroup: 'Inventory', balance: 0, notes: 'GRN vs vendor-bill purchase price variance' },
    { code: '6401', name: 'Selling and Delivery', type: 'expense', group: 'Other Direct Expenses', subGroup: 'Other Direct Expenses', balance: 0 },
    { code: '6402', name: 'Packaging Expenses', type: 'expense', group: 'Other Direct Expenses', subGroup: 'Other Direct Expenses', balance: 0 },
    ...OPERATING_EXPENSES,
    { code: '6595', name: 'Cash Over/Short', type: 'expense', group: 'Operating Expenses', subGroup: 'Operating and Administrative', balance: 0 },
    { code: '6599', name: 'Other Operating Expenses', type: 'expense', group: 'Operating Expenses', subGroup: 'Operating and Administrative', balance: 0 },
    ...EMPLOYMENT_EXPENSES,
    ...FINANCIAL_EXPENSES,
  )
  return a
}

export function coaTemplateToBlobAccounts(rows: CoaTemplateAccount[]) {
  return rows.map((r, i) => ({
    id: `coa-bootstrap-${r.code}`,
    code: r.code,
    name: r.name,
    type: r.type,
    group: r.group,
    subGroup: r.subGroup,
    isActive: true,
    balance: 0,
    isDynamic: r.isDynamic ?? false,
    dynamicKey: r.dynamicKey,
    notes: r.notes,
  }))
}
