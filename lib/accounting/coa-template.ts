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

/** Canonical zero-balance CoA used only when both blob and Prisma CoA are empty. */
export function buildZeroBalanceCoaTemplate(): CoaTemplateAccount[] {
  const a: CoaTemplateAccount[] = []
  a.push(...productCodes('11', 'Inventory - Opening', 'Raw Materials'))
  a.push(...productCodes('12', 'Inventory - Opening', 'Work in Progress'))
  a.push(...productCodes('13', 'Inventory - Opening', 'Finished Products'))
  a.push(...productCodes('14', 'Inventory - Closing', 'Raw Materials'))
  a.push(...productCodes('15', 'Inventory - Closing', 'Work in Progress'))
  a.push(...productCodes('16', 'Inventory - Closing', 'Finished Products'))

  a.push(
    { code: '1150', name: 'VAT Input', type: 'asset', group: 'Receivables - Tax', subGroup: 'VAT', balance: 0, notes: 'Input VAT recoverable on vendor bills' },
    { code: '1701', name: 'Computer & Accessories', type: 'asset', group: 'PPE - Cost', subGroup: 'Cost', balance: 0 },
    { code: '1702', name: 'Furniture & Fittings', type: 'asset', group: 'PPE - Cost', subGroup: 'Cost', balance: 0 },
    { code: '1703', name: 'Office Equipment', type: 'asset', group: 'PPE - Cost', subGroup: 'Cost', balance: 0 },
    { code: '1704', name: 'Software', type: 'asset', group: 'PPE - Cost', subGroup: 'Cost', balance: 0 },
    { code: '1800', name: 'Accounts Receivable (Products)', type: 'asset', group: 'Receivables - Product', subGroup: 'Product', balance: 0, isDynamic: true, dynamicKey: 'ar' },
    { code: '1805', name: 'Outstanding Receipts', type: 'asset', group: 'Receivables - Clearing', subGroup: 'Outstanding', balance: 0, notes: 'Unallocated customer receipts awaiting invoice application' },
    { code: '2201', name: 'ABSA Bank', type: 'asset', group: 'Cash at Bank', subGroup: 'Cash at Bank', balance: 0 },
    { code: '2202', name: 'Equity Bank', type: 'asset', group: 'Cash at Bank', subGroup: 'Cash at Bank', balance: 0 },
    { code: '2211', name: 'Petty Cash / Mobile Money', type: 'asset', group: 'Cash in Hand', subGroup: 'Cash in Hand', balance: 0 },
    { code: '3000', name: 'Accounts Payable (Products)', type: 'liability', group: 'Payables - Product', subGroup: 'Product', balance: 0, isDynamic: true, dynamicKey: 'ap' },
    { code: '3005', name: 'Outstanding Payments', type: 'liability', group: 'Payables - Clearing', subGroup: 'Outstanding', balance: 0, notes: 'Unallocated vendor payments awaiting bill application' },
    { code: '3100', name: 'Customer Deposits', type: 'liability', group: 'Customer Liabilities', subGroup: 'Deposits', balance: 0, notes: 'Layby / deposit cash held until goods collected' },
    { code: '3102', name: 'Customer Credits', type: 'liability', group: 'Customer Liabilities', subGroup: 'Credits', balance: 0, notes: 'Credit notes, cancelled paid-invoice credits, and buy-back store credit' },
    { code: '3105', name: 'Employee Reimbursements Payable', type: 'liability', group: 'Accruals', subGroup: 'Accruals', balance: 0 },
    { code: '3201', name: 'Accruals', type: 'liability', group: 'Accruals', subGroup: 'Accruals', balance: 0 },
    { code: '3301', name: 'Output VAT Payable (16%)', type: 'liability', group: 'Statutory Liabilities', subGroup: 'Current Liabilities', balance: 0 },
    { code: '4001', name: 'Share Capital', type: 'equity', group: 'Equity', subGroup: 'Equity', balance: 0 },
    { code: '4002', name: 'Retained Earnings', type: 'equity', group: 'Equity', subGroup: 'Equity', balance: 0 },
    { code: '4003', name: 'Current Year P&L', type: 'equity', group: 'Equity', subGroup: 'Equity', balance: 0, isDynamic: true, dynamicKey: 'net_profit' },
    { code: '5000', name: 'Sales — Products (Invoices)', type: 'revenue', group: 'Revenue - Products', subGroup: 'Product', balance: 0, isDynamic: true, dynamicKey: 'revenue' },
    { code: '5001', name: 'Laptops', type: 'revenue', group: 'Revenue - Products', subGroup: 'Product', balance: 0 },
    { code: '5105', name: 'Interest Income', type: 'revenue', group: 'Other Income', subGroup: 'Finance', balance: 0 },
    { code: '6001', name: 'Cost of Goods Sold', type: 'expense', group: 'Direct Expenses', subGroup: 'COGS', balance: 0 },
    { code: '6101', name: 'Laptops', type: 'expense', group: 'Local Purchases', subGroup: 'Local Purchases', balance: 0 },
    // Debit when a buy-back is added as 3102 credit instead of paid in cash.
    { code: '6108', name: 'Trade-in Purchases', type: 'expense', group: 'Local Purchases', subGroup: 'Trade-in', balance: 0, notes: 'Buy-back amount when settled as store credit instead of cash' },
    { code: '6401', name: 'Bank Charges', type: 'expense', group: 'Finance Costs', subGroup: 'Bank', balance: 0 },
    { code: '1200', name: 'Inventory', type: 'asset', group: 'Inventory - Closing', subGroup: 'Finished Products', balance: 0 },
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
