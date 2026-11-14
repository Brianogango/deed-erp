import { type BankAccount, type Account, type AccountType, type JournalEntry, type Invoice } from './finance'
import { type SystemSettings, type CompanySettings } from './settings'
import { DEFAULT_PRICING_MARGIN_POLICY } from '@/lib/pricing/margin-policy'
import { type Contact, type Company, type ContactPerson, type Opportunity, type Quote, type CustomerContract, type OpportunityActivity, type SaleOrder } from './sales'
import { type Department, type Employee, type Contract, type LeaveBalance, type LeaveRequest, type HRDocument, type PayrollRun, type Payslip, type EmployeeAssetAssignment, type JobPosting, type Candidate, type TrainingProgram, type EmployeeTraining, type RefSOP } from './hr'
import { type WorkflowApproval } from './core'
import { type Product, type SerialNumber, type RefurbishmentJob, type BulkStockLevel } from './inventory'
import { type PurchaseOrder, type Receipt, type StockTransfer } from './purchasing'
import { type Rider, type DeliveryJob, type Delivery } from './delivery'
import { type Warranty, type RepairOrder, type OutsourceVendor, type OutsourceJob, type OutsourcePayment } from './repairs'
import { type SOP, type SOPActual } from './sop'
import { type Expense } from './expenses'

/** Starting values for the store: default chart of accounts, departments, bank accounts and settings; every other list starts empty. */

// Default bank accounts — each row carries its own M-Pesa paybill/account pair
// so invoice PDFs never mix e.g. I&M transfer details with NCBA paybill 880100.
export const DEFAULT_BANK_ACCOUNTS: BankAccount[] = [
  {
    id: 'ncba', name: 'NCBA Current Account', bankName: 'NCBA Bank Kenya PLC',
    accountNo: '1005157785', currency: 'KES', openingBalance: 0, openingDate: '2025-01-01', active: true,
    mpesaPaybill: '880100', mpesaAccount: '468778',
  },
  {
    id: 'absa', name: 'ABSA Current Account', bankName: 'ABSA Bank Kenya PLC',
    accountNo: '2043953071', currency: 'KES', openingBalance: 0, openingDate: '2025-01-01', active: true,
    mpesaPaybill: '303030', mpesaAccount: '2043953071',
  },
  {
    id: 'im', name: 'I&M Current Account', bankName: 'I & M Bank',
    accountNo: '00105512776350', currency: 'KES', openingBalance: 0, openingDate: '2025-01-01', active: true,
    mpesaPaybill: '542542', mpesaAccount: '391572',
  },
  {
    id: 'equity', name: 'Equity Bank Account', bankName: 'Equity Bank Kenya',
    accountNo: '0020284195905', currency: 'KES', openingBalance: 0, openingDate: '2025-01-01', active: true,
    mpesaPaybill: '247247', mpesaAccount: '0020284195905',
  },
  {
    id: 'credit', name: 'Credit Bank Current', bankName: 'Credit Bank',
    accountNo: '0131006000351', currency: 'KES', openingBalance: 0, openingDate: '2025-01-01', active: true,
    mpesaPaybill: '972700', mpesaAccount: '0131006000351',
  },
  // Ledger / cashbook sink for M-Pesa receipts — excluded from PDF bank pickers.
  {
    id: 'mpesa', name: 'M-Pesa Paybill', bankName: 'Safaricom M-Pesa',
    accountNo: '880100', currency: 'KES', openingBalance: 0, openingDate: '2025-01-01', active: true,
    mpesaPaybill: '880100', mpesaAccount: '468778',
  },
  { id: 'cash', name: 'Petty Cash Float', bankName: 'Cash', accountNo: 'CASH', currency: 'KES', openingBalance: 0, openingDate: '2025-01-01', active: true },
]

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  multiUserRoles: true, enforceDeptAccess: true, auditLogs: true, fiscalYearStart: 'January',
  crmLeads: true, crmLeadScoring: false, crmTags: true, crmSourceTracking: true,
  crmPipelineStages: ['Inquiry Received', 'Assigned', 'Contacted', 'Qualified', 'Needs Confirmed', 'Quote Sent', 'Follow-up', 'Won', 'Lost'],
  crmEnforceNextActivity: true, crmAutoAssignLeads: true, crmAutoFollowUpAfterQuote: true,
  salesQuotationTemplates: true, salesOptionalProducts: true, salesDigitalSignature: false,
  salesOnlineAcceptance: false, salesPricelists: true, salesDiscountControl: true, salesConfirmedQuotesToOrders: true,
  salesLockConfirmed: true,
  salesMinMarginPercent: 10,
  salesRequireSpecialPricingApproval: false,
  salesRequireCreditOverrideApproval: false,
  invProductsMasterOnly: true, invNoDirectStockEdits: true, invMultiStepRoutes: true,
  invStorageLocations: ['Incoming', 'Workshop', 'Ready for Sale', 'Faulty / Scrap'],
  invSerialNumbers: true, invLots: false, invAutomatedValuation: true, invCostingMethod: 'average',
  invDefaultMinStock: 5, invDefaultWarrantyMonths: 6,
  reconfigurationEnabled: true, reconfigurationMinMarginPct: 10,
  invCategorySaleMarkupPct: {},
  pricingMarginPolicy: DEFAULT_PRICING_MARGIN_POLICY,
  purPurchaseAgreements: false, purVendorPricelists: true, purRequireApprovalHighValue: false,
  purHighValueThreshold: 50000, purEnforceRFQFlow: true, purStoreLeadTimes: true,
  purDefaultPaymentTermsDays: 30,
  accCreditPayOnReceiptEnforced: false,
  repRepairOrders: true, repWarrantyTracking: true, repPartsConsumption: true,
  repEnforceFlow: true, repOnlyAssignedTechSeesJob: true, repAdminAssignsJobs: true,
  diagnosisFeeKes: 1000, diagnosisFeeRegularKes: 1000, diagnosisFeeHighEndKes: 1000,
  accCustomerInvoices: true, accVendorBills: true, accCreditNotes: true, accVatEnabled: true,
  accBankJournals: true, accMpesaJournals: true, accReconciliation: true,
  accLockDates: true, accApprovalForRefunds: true,
  accAdminOfficerInvoiceLimitKes: 1000000,
  hrAttendance: false, hrLeaves: true, hrRestrictSalaryInfo: true, hrRoleBasedVisibility: true,
  posSessionControl: true, posCashControl: true, posReceiptPrinting: true,
  posLoyaltyKesPerPoint: 2000,
  secDisableProductDeletion: true, secDisableStockManipulation: true, secDisableInvoiceEditAfterValidation: true,
  secPortalRequirePhoneVerification: true,
}

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  name:          'Deed Technologies LTD',
  legalName:     'Deed Technologies Limited',
  address:       'Sanlam House, Kenyatta Avenue',
  streetAddress: 'Sanlam House, Kenyatta Avenue, 1st Floor, Suite 103',
  city:          'Nairobi',
  county:        'Nairobi',
  postalCode:    '00100',
  country:       'Kenya',
  language:      'English (Kenya)',
  timezone:      'Africa/Nairobi',
  phone:         '0113407964',
  email:         'info@deed.africa',
  website:       'http://deed.africa',
  kraPin:        'P051999898X',
  vatRate:       16,
  mpesaPaybill:  '880100',
  mpesaAccount:  '468778',
  logoUrl:       '',
  currency:      'KES',
  functionalCurrency: 'KES',
  invoiceFooter: 'Thank you for your business.',
  printTemplate: 'standard',
  printFont: 'lato',
  printBackground: 'blank',
  printPrimaryColor: '#1B2762',
  printSecondaryColor: '#00AEEF',
  printTagline: '',
  printPaperFormat: 'a4',
  partnerHiddenCategories: [],
}

// ─── Seed Data ────────────────────────────────────────────────────────────────

// Chart of Accounts — Kenya IFRS-aligned, accrual basis
// Revenue seed balances represent YTD (Jan–Apr 2026) actuals
// Expense seed balances represent YTD actuals
// Balance Sheet seed balances are as at 16 Apr 2026
// BS is designed to balance:
//   Total Assets (static 6,233,000 + dynamic AR) = Total Liabilities (static 1,213,900 + dynamic AP) + Total Equity (4,200,000 + current year P/L 65,100)
// ── Chart of Accounts builder ─────────────────────────────────────────────────
// Generates the full Deed Technologies Ltd COA (3-level hierarchy)
export function buildSeedAccounts(): Account[] {
  let n = 1
  const mk = (
    code: string, name: string, type: AccountType,
    group: string, subGroup: string, balance = 0,
    extra: Partial<Account> = {},
  ): Account => ({ id: `coa${n++}`, code, name, type, group, subGroup, isActive: true, balance, ...extra })

  const PRODUCTS = [
    'Laptops', 'Accessories', 'Desktop / Combo', 'Monitors', 'Servers', 'Storage',
    'Power Backup Solutions', 'Printers', 'Software Licenses', 'Parts and Components',
    'Printer Consumables', 'Networking Equipment', 'Consumer Electronics',
  ]
  const SOLUTIONS = [
    'On-Demand IT', 'IT Consultancy', 'Managed IT Infrastructure', 'Server Administration',
    'Cloud Solutions', 'Data Backup', 'Data Recovery', 'Power Backup',
    'Enterprise OEM Software Services', 'Security Solutions',
  ]

  const a: Account[] = []
  const p = (arr: Account[]) => { arr.forEach(x => a.push(x)) }

  // ── OPENING STOCK (Current Asset) ────────────────────────────────────────────
  PRODUCTS.forEach((name, i) => p([mk(`11${String(i+1).padStart(2,'0')}`, name, 'asset', 'Inventory - Opening', 'Raw Materials')]))
  PRODUCTS.forEach((name, i) => p([mk(`12${String(i+1).padStart(2,'0')}`, name, 'asset', 'Inventory - Opening', 'Work in Progress')]))
  PRODUCTS.forEach((name, i) => p([mk(`13${String(i+1).padStart(2,'0')}`, name, 'asset', 'Inventory - Opening', 'Finished Products')]))

  // ── CLOSING STOCK (Current Asset — appears on Balance Sheet as Inventory) ────
  PRODUCTS.forEach((name, i) => p([mk(`14${String(i+1).padStart(2,'0')}`, name, 'asset', 'Inventory - Closing', 'Raw Materials')]))
  PRODUCTS.forEach((name, i) => p([mk(`15${String(i+1).padStart(2,'0')}`, name, 'asset', 'Inventory - Closing', 'Work in Progress')]))
  PRODUCTS.forEach((name, i) => {
    const bal = name === 'Laptops' ? 480_000
      : name === 'Accessories' ? 124_000
      : name === 'Networking Equipment' ? 156_000
      : name === 'Servers' ? 120_000 : 0
    p([mk(`16${String(i+1).padStart(2,'0')}`, name, 'asset', 'Inventory - Closing', 'Finished Products', bal)])
  })

  // ── PROPERTY, PLANT & EQUIPMENT ──────────────────────────────────────────────
  a.push(mk('1701', 'Computer & Accessories',  'asset', 'PPE - Cost',             'Cost', 840_000))
  a.push(mk('1702', 'Furniture & Fittings',    'asset', 'PPE - Cost',             'Cost', 180_000))
  a.push(mk('1703', 'Office Equipment',        'asset', 'PPE - Cost',             'Cost', 2_400_000))
  a.push(mk('1704', 'Software',               'asset', 'PPE - Cost',             'Cost', 85_000))
  a.push(mk('1751', 'Computer & Accessories',  'asset', 'Accumulated Depreciation','Accum. Depr.', -280_000, { notes: 'Contra account' }))
  a.push(mk('1752', 'Furniture & Fittings',    'asset', 'Accumulated Depreciation','Accum. Depr.', -45_000,  { notes: 'Contra account' }))
  a.push(mk('1753', 'Office Equipment',        'asset', 'Accumulated Depreciation','Accum. Depr.', -320_000, { notes: 'Contra account' }))
  a.push(mk('1754', 'Software',               'asset', 'Accumulated Depreciation','Accum. Depr.', -21_000,  { notes: 'Contra account' }))

  // ── RECEIVABLES (DEBTORS) ────────────────────────────────────────────────────
  // Consolidated dynamic AR (computed from outstanding customer invoices)
  a.push(mk('1800', 'Accounts Receivable (Products)', 'asset', 'Receivables - Product', 'Product', 0,
    { isDynamic: true, dynamicKey: 'ar', notes: 'Computed from outstanding customer invoices' }))
  PRODUCTS.forEach((name, i) => p([mk(`18${String(i+1).padStart(2,'0')}`, name, 'asset', 'Receivables - Product', 'Product')]))
  SOLUTIONS.forEach((name, i) => p([mk(`19${String(i+1).padStart(2,'0')}`, name, 'asset', 'Receivables - Services', 'Solutions and Services')]))
  a.push(mk('1921', 'Hardware Support',         'asset', 'Receivables - Repair', 'Expert Repair Services'))
  a.push(mk('1922', 'Software Support',         'asset', 'Receivables - Repair', 'Expert Repair Services'))
  a.push(mk('1931', 'Advances',                 'asset', 'Receivables - Other',  'Other Debtors'))
  a.push(mk('1932', 'Other Debtors (Receivables)', 'asset', 'Receivables - Other', 'Other Debtors'))

  // ── PREPAYMENTS ──────────────────────────────────────────────────────────────
  PRODUCTS.forEach((name, i) => {
    const bal = name === 'Laptops' ? 45_000 : name === 'Accessories' ? 18_000 : 0
    p([mk(`20${String(i+1).padStart(2,'0')}`, name, 'asset', 'Prepayments - Product', 'Product', bal)])
  })
  SOLUTIONS.forEach((name, i) => p([mk(`21${String(i+1).padStart(2,'0')}`, name, 'asset', 'Prepayments - Services', 'Solutions and Services')]))
  a.push(mk('2121', 'Hardware Support',         'asset', 'Prepayments - Repair', 'Expert Repair Services'))
  a.push(mk('2122', 'Software Support',         'asset', 'Prepayments - Repair', 'Expert Repair Services'))
  a.push(mk('2131', 'Other Prepayments',        'asset', 'Prepayments - Other',  'Other Prepayments'))

  // ── CASH & CASH EQUIVALENTS ───────────────────────────────────────────────────
  a.push(mk('2201', 'ABSA Bank',                'asset', 'Cash at Bank',  'Cash at Bank', 1_640_000))
  a.push(mk('2202', 'Equity Bank',              'asset', 'Cash at Bank',  'Cash at Bank', 490_000))
  a.push(mk('2211', 'Petty Cash / Mobile Money','asset', 'Cash in Hand',  'Cash in Hand', 385_000))

  // ── PAYABLES (CREDITORS) ─────────────────────────────────────────────────────
  // Consolidated dynamic AP (computed from outstanding vendor bills)
  a.push(mk('3000', 'Accounts Payable (Products)', 'liability', 'Payables - Product', 'Product', 0,
    { isDynamic: true, dynamicKey: 'ap', notes: 'Computed from outstanding vendor bills' }))
  PRODUCTS.forEach((name, i) => p([mk(`30${String(i+1).padStart(2,'0')}`, name, 'liability', 'Payables - Product', 'Product')]))
  SOLUTIONS.forEach((name, i) => p([mk(`31${String(i+1).padStart(2,'0')}`, name, 'liability', 'Payables - Services', 'Solutions and Services')]))
  a.push(mk('3121', 'Hardware Support',         'liability', 'Payables - Repair', 'Expert Repair Services'))
  a.push(mk('3122', 'Software Support',         'liability', 'Payables - Repair', 'Expert Repair Services'))
  a.push(mk('3131', 'Other Creditors (Payables)', 'liability', 'Payables - Other', 'Other Creditors'))

  // ── ACCRUALS ─────────────────────────────────────────────────────────────────
  a.push(mk('3201', 'Accruals',                 'liability', 'Accruals', 'Accruals'))

  // ── STATUTORY & OTHER CURRENT LIABILITIES ────────────────────────────────────
  a.push(mk('3301', 'Output VAT Payable (16%)', 'liability', 'Statutory Liabilities', 'Current Liabilities', 89_000))
  a.push(mk('3302', 'PAYE Payable — KRA',       'liability', 'Statutory Liabilities', 'Current Liabilities', 48_600))
  a.push(mk('3303', 'NSSF Payable',             'liability', 'Statutory Liabilities', 'Current Liabilities', 24_300))
  a.push(mk('3304', 'NHIF / SHIF Payable',      'liability', 'Statutory Liabilities', 'Current Liabilities', 12_000))

  // ── NON-CURRENT LIABILITIES ───────────────────────────────────────────────────
  a.push(mk('3401', 'Bank Loan',                'liability', 'Non-Current Liabilities', 'Non-Current Liabilities', 800_000))
  a.push(mk('3402', 'Directors Account',        'liability', 'Non-Current Liabilities', 'Non-Current Liabilities', 396_000))

  // ── EQUITY ───────────────────────────────────────────────────────────────────
  a.push(mk('4001', 'Share Capital',            'equity', 'Equity', 'Equity', 3_000_000))
  a.push(mk('4002', 'Retained Earnings',        'equity', 'Equity', 'Equity', 1_140_000))
  a.push(mk('4003', 'Current Year P&L',         'equity', 'Equity', 'Equity', 0,
    { isDynamic: true, dynamicKey: 'net_profit', notes: 'Computed from P&L statement' }))

  // ── REVENUE ──────────────────────────────────────────────────────────────────
  a.push(mk('5000', 'Sales — Products (Invoices)', 'revenue', 'Revenue - Products', 'Product', 0,
    { isDynamic: true, dynamicKey: 'revenue', notes: 'Computed from customer invoices' }))
  PRODUCTS.forEach((name, i) => p([mk(`50${String(i+1).padStart(2,'0')}`, name, 'revenue', 'Revenue - Products', 'Product')]))
  SOLUTIONS.forEach((name, i) => p([mk(`51${String(i+1).padStart(2,'0')}`, name, 'revenue', 'Revenue - Solutions', 'Solutions and Services')]))
  a.push(mk('5121', 'Hardware Support', 'revenue', 'Revenue - Repair', 'Expert Repair Services', 180_600))
  a.push(mk('5122', 'Software Support', 'revenue', 'Revenue - Repair', 'Expert Repair Services', 36_000))
  a.push(mk('5099', 'Sales Returns & Refunds', 'revenue', 'Revenue - Products', 'Product', 0, { notes: 'Contra account — debit entries reduce revenue' }))

  // ── OTHER INCOME ─────────────────────────────────────────────────────────────
  a.push(mk('5201', 'Dividends and Interest',         'revenue', 'Other Income', 'Other Income', 8_400))
  a.push(mk('5202', 'Commission',                     'revenue', 'Other Income', 'Other Income', 4_000))
  a.push(mk('5203', 'Profit / Surplus on Disposal of Assets', 'revenue', 'Other Income', 'Other Income'))
  a.push(mk('5204', 'Bad Debts Recovered',            'revenue', 'Other Income', 'Other Income'))
  a.push(mk('5205', 'Discount Received',              'revenue', 'Other Income', 'Other Income'))

  // ── LOCAL PURCHASES ───────────────────────────────────────────────────────────
  PRODUCTS.forEach((name, i) => {
    const bal = name === 'Laptops' ? 120_000 : name === 'Accessories' ? 35_000
      : name === 'Networking Equipment' ? 28_700 : 0
    p([mk(`61${String(i+1).padStart(2,'0')}`, name, 'expense', 'Local Purchases', 'Local Purchases', bal)])
  })

  // ── IMPORT PURCHASES ──────────────────────────────────────────────────────────
  PRODUCTS.forEach((name, i) => {
    const bal = name === 'Laptops' ? 24_800 : name === 'Servers' ? 0 : 0
    p([mk(`62${String(i+1).padStart(2,'0')}`, name, 'expense', 'Import Purchases', 'Import Purchases', bal)])
  })

  // ── DIRECT EXPENSES ───────────────────────────────────────────────────────────
  a.push(mk('6301', "Solutions and Expert Repair Services' Costs", 'expense', 'Direct Expenses', 'Direct Expenses'))
  a.push(mk('6302', 'Direct Salaries',     'expense', 'Direct Expenses', 'Direct Expenses', 0, { isDynamic: true, dynamicKey: 'salaries', notes: 'Computed from payroll journals' }))
  a.push(mk('6303', 'Direct Wages',        'expense', 'Direct Expenses', 'Direct Expenses'))
  a.push(mk('6304', 'Direct Commission',   'expense', 'Direct Expenses', 'Direct Expenses'))

  // ── OTHER DIRECT EXPENSES ─────────────────────────────────────────────────────
  a.push(mk('6401', 'Selling and Delivery',   'expense', 'Other Direct Expenses', 'Other Direct Expenses'))
  a.push(mk('6402', 'Packaging Expenses',     'expense', 'Other Direct Expenses', 'Other Direct Expenses'))

  // ── OPERATING & ADMINISTRATIVE EXPENSES ──────────────────────────────────────
  a.push(mk('6501', 'Advertisement and Promotion',               'expense', 'Operating Expenses', 'Operating and Administrative', 3_000))
  a.push(mk('6502', 'Auditors Remuneration',                     'expense', 'Operating Expenses', 'Operating and Administrative', 2_000))
  a.push(mk('6503', 'Computer Expenses',                         'expense', 'Operating Expenses', 'Operating and Administrative', 1_200))
  a.push(mk('6504', 'Printing and Stationery',                   'expense', 'Operating Expenses', 'Operating and Administrative', 1_200))
  a.push(mk('6505', 'Repairs and Maintenance',                   'expense', 'Operating Expenses', 'Operating and Administrative', 1_000))
  a.push(mk('6506', 'Water and Electricity',                     'expense', 'Operating Expenses', 'Operating and Administrative', 4_800))
  a.push(mk('6507', 'Fuel and Transport',                        'expense', 'Operating Expenses', 'Operating and Administrative', 2_400))
  a.push(mk('6508', 'Rent and Service Charge',                   'expense', 'Operating Expenses', 'Operating and Administrative', 18_000))
  a.push(mk('6509', 'Legal Expenses',                            'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6510', 'Telephone and Internet',                    'expense', 'Operating Expenses', 'Operating and Administrative', 2_400))
  a.push(mk('6511', 'Subsistence and Accommodation',             'expense', 'Operating Expenses', 'Operating and Administrative', 1_200))
  a.push(mk('6512', 'Bad Debts Written Off',                     'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6513', 'Provision for Bad and Doubtful Debts',      'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6514', 'Gifts and Donations',                       'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6515', 'Loss on Disposal of Assets',                'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6516', 'Management Fees',                           'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6517', 'Depreciation and Amortization',             'expense', 'Operating Expenses', 'Operating and Administrative', 9_200))
  a.push(mk('6518', 'Office Expenses',                           'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6519', 'Courier and Delivery',                      'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6520', 'Discount Allowed',                          'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6521', 'Expensed Assets',                           'expense', 'Operating Expenses', 'Operating and Administrative'))

  // ── EMPLOYMENT EXPENSES ────────────────────────────────────────────────────────
  a.push(mk('6601', 'Salaries',                            'expense', 'Employment Expenses', 'Employment Expenses'))
  a.push(mk('6602', 'Wages',                               'expense', 'Employment Expenses', 'Employment Expenses'))
  a.push(mk('6603', 'Commission',                          'expense', 'Employment Expenses', 'Employment Expenses'))
  a.push(mk('6604', 'Staff Bonus',                         'expense', 'Employment Expenses', 'Employment Expenses'))
  a.push(mk('6605', 'Training Expenses',                   'expense', 'Employment Expenses', 'Employment Expenses'))
  a.push(mk('6606', 'Contribution to Pension Fund (NSSF)', 'expense', 'Employment Expenses', 'Employment Expenses', 1_440))
  a.push(mk('6607', 'Leave Encashment',                    'expense', 'Employment Expenses', 'Employment Expenses'))
  a.push(mk('6608', 'Any Other Employment Costs',          'expense', 'Employment Expenses', 'Employment Expenses'))

  // ── FINANCIAL EXPENSES ────────────────────────────────────────────────────────
  a.push(mk('6701', 'Interest Expense',                            'expense', 'Financial Expenses', 'Financial Expenses'))
  a.push(mk('6702', 'Commitment Fees',                             'expense', 'Financial Expenses', 'Financial Expenses'))
  a.push(mk('6703', 'Bank Charges',                                'expense', 'Financial Expenses', 'Financial Expenses', 900))
  a.push(mk('6704', 'Insurance',                                   'expense', 'Financial Expenses', 'Financial Expenses', 2_400))
  a.push(mk('6705', 'Realized and Unrealized Exchange Loss',       'expense', 'Financial Expenses', 'Financial Expenses'))

  return a
}

export const seedAccounts: Account[] = buildSeedAccounts()

export const seedContacts: Contact[] = []

export const seedCompanies: Company[] = []

export const seedContactPersons: ContactPerson[] = []

export const seedOpportunities: Opportunity[] = []

export const seedQuotes: Quote[] = []

export const seedCustomerContracts: CustomerContract[] = []

export const seedOpportunityActivities: OpportunityActivity[] = []

export const seedDepartments: Department[] = [
  { id: 'HR', name: 'HR', description: 'Human resources and people operations' },
  { id: 'Sales', name: 'Sales', description: 'Sales and revenue operations' },
  { id: 'Marketing', name: 'Marketing', description: 'Marketing and demand generation' },
  { id: 'Finance', name: 'Finance', description: 'Finance, accounting, and controls' },
  { id: 'Engineering', name: 'Engineering', description: 'Engineering and technical delivery' },
  { id: 'Logistics & Supply Chain Management', name: 'Logistics & Supply Chain Management', description: 'Logistics, procurement, warehousing, and supply chain' },
  { id: 'Strategy & R&D', name: 'Strategy & R&D', description: 'Strategy, research, and development' },
  { id: 'Administration', name: 'Administration', description: 'Administration and office operations' },
  { id: 'Circular Computing Centre', name: 'Circular Computing Centre', description: 'Circular computing centre operations' },
  { id: 'Managed IT Services', name: 'Managed IT Services', description: 'Managed IT services delivery' },
  { id: 'AI & Automation', name: 'AI & Automation', description: 'AI, automation, and workflow transformation' },
  { id: 'Training & Certification', name: 'Training & Certification', description: 'Training, certification, and enablement' },
  { id: 'ESG & Sustainability', name: 'ESG & Sustainability', description: 'ESG reporting and sustainability programs' },
  { id: 'Investor Relations & Capital Raising', name: 'Investor Relations & Capital Raising', description: 'Investor relations and capital raising' },
  { id: 'Regional Expansion / New Markets', name: 'Regional Expansion / New Markets', description: 'Regional expansion and new market development' },
  { id: 'Deed Foundation', name: 'Deed Foundation', description: 'Deed Foundation programs and impact initiatives' },
]

export const seedEmployees: Employee[] = []

export const seedContracts: Contract[] = []

export const seedLeaveBalances: LeaveBalance[] = []

export const seedLeaveRequests: LeaveRequest[] = []

export const seedHRDocuments: HRDocument[] = []

export const seedWorkflowApprovals: WorkflowApproval[] = []

export const seedPayrollRuns: PayrollRun[] = []

export const seedPayslips: Payslip[] = []

export const seedJournalEntries: JournalEntry[] = []

export const seedEmployeeAssetAssignments: EmployeeAssetAssignment[] = []

export const seedJobPostings: JobPosting[] = []

export const seedCandidates: Candidate[] = []

export const seedTrainingPrograms: TrainingProgram[] = []

export const seedEmployeeTrainings: EmployeeTraining[] = []

export const seedProducts: Product[] = []

export const seedSerials: SerialNumber[] = []

export const seedPOs: PurchaseOrder[] = []

export const seedReceipts: Receipt[] = []

export const seedTransfers: StockTransfer[] = []

// Refurbishment seed — devices received with issues, awaiting tech assignment
export const seedRefurbishmentJobs: RefurbishmentJob[] = []

// SO seed

export const seedSOs: SaleOrder[] = []

export const seedRiders: Rider[] = []

export const seedDeliveryJobs: DeliveryJob[] = []

export const seedDeliveries: Delivery[] = []

export const seedWarranties: Warranty[] = []

export const seedInvoices: Invoice[] = []

export const seedBulkStock: BulkStockLevel[] = []

export const seedRepairs: RepairOrder[] = []

// ── SOP seed data ─────────────────────────────────────────────────────────────
export const seedSOPs: SOP[] = []

export const seedSopActuals: SOPActual[] = []

export const seedRefSOPs: RefSOP[] = []

// ── Expense seed data ─────────────────────────────────────────────────────────
export const seedExpenses: Expense[] = []

// ── Outsource seed data ───────────────────────────────────────────────────────
export const seedOutsourceVendors: OutsourceVendor[] = []

export const seedOutsourceJobs: OutsourceJob[] = []

export const seedOutsourcePayments: OutsourcePayment[] = []
