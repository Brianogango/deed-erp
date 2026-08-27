-- Complete remaining PR #490 / accounting-recommendation schema that was
-- previously skipped. Additive only. Safe to re-run.
--
-- * Number duplicate journal (source_type, source_id) rows so the unique
--   source-version index can exist without deleting history.
-- * Backfill payment amount_base and posting_status.
-- * Allow more than one cashbook bank to share a GL account.
-- * Supplier payment type default is vendor-oriented.

BEGIN;

-- Existing journals all received source_version = 1. Number duplicates 1..n
-- by created_at so every historical journal is kept.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY source_type, source_id
           ORDER BY created_at NULLS LAST, id
         ) AS rn
  FROM journal_entries
)
UPDATE journal_entries j
SET source_version = ranked.rn
FROM ranked
WHERE j.id = ranked.id
  AND COALESCE(j.source_version, 1) <> ranked.rn;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_journal_source_version"
  ON "journal_entries"("source_type", "source_id", "source_version");

UPDATE payments
SET amount_base = amount
WHERE amount_base = 0 AND amount <> 0;

UPDATE payments
SET posting_status = 'posted'
WHERE posting_status = 'unposted'
  AND journal_id IS NOT NULL;

UPDATE invoices
SET posting_status = 'posted'
WHERE posting_status = 'unposted'
  AND posted_journal_entry_id IS NOT NULL;

UPDATE supplier_payments
SET payment_type = 'supplier_payment'
WHERE payment_type = 'customer_receipt';

ALTER TABLE supplier_payments
  ALTER COLUMN payment_type SET DEFAULT 'supplier_payment';

ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS uq_bank_account_gl;
CREATE INDEX IF NOT EXISTS idx_bank_account_gl ON bank_accounts (gl_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_account_name ON bank_accounts (name);

INSERT INTO account_codes (
  id, code, name, account_type, account_group, sub_group,
  is_active, is_dynamic, dynamic_key, balance, notes, created_at, updated_at
)
SELECT gen_random_uuid(), v.code, v.name, v.account_type, v.account_group, v.sub_group,
       TRUE, v.is_dynamic, NULLIF(v.dynamic_key, ''), 0, NULLIF(v.notes, ''), NOW(), NOW()
FROM (VALUES
  ('1150', 'VAT Input', 'asset', 'Receivables - Tax', 'VAT', FALSE, '', 'Input VAT recoverable on vendor bills'),
  ('1200', 'Inventory', 'asset', 'Inventory - Closing', 'Finished Products', FALSE, '', ''),
  ('1800', 'Accounts Receivable (Products)', 'asset', 'Receivables - Product', 'Product', TRUE, 'ar', ''),
  ('1805', 'Outstanding Receipts', 'asset', 'Receivables - Clearing', 'Outstanding', FALSE, '', 'Unallocated customer receipts awaiting invoice application'),
  ('1810', 'Employee Salary Advances', 'asset', 'Employee Receivables', 'Salary Advances', FALSE, '', ''),
  ('2201', 'ABSA Bank', 'asset', 'Cash at Bank', 'Cash at Bank', FALSE, '', ''),
  ('2202', 'Equity Bank', 'asset', 'Cash at Bank', 'Cash at Bank', FALSE, '', ''),
  ('2211', 'Petty Cash / Mobile Money', 'asset', 'Cash in Hand', 'Cash in Hand', FALSE, '', ''),
  ('3000', 'Accounts Payable (Products)', 'liability', 'Payables - Product', 'Product', TRUE, 'ap', ''),
  ('3005', 'Outstanding Payments', 'liability', 'Payables - Clearing', 'Outstanding', FALSE, '', 'Unallocated vendor payments awaiting bill application'),
  ('3100', 'Customer Deposits', 'liability', 'Customer Liabilities', 'Deposits', FALSE, '', ''),
  ('3102', 'Customer Credits', 'liability', 'Customer Liabilities', 'Credits', FALSE, '', ''),
  ('3105', 'Employee Reimbursements Payable', 'liability', 'Accruals', 'Accruals', FALSE, '', ''),
  ('3110', 'Net Payroll Payable', 'liability', 'Payroll Liabilities', 'Employees', FALSE, '', ''),
  ('3201', 'Accruals', 'liability', 'Accruals', 'Accruals', FALSE, '', ''),
  ('3301', 'Output VAT Payable (16%)', 'liability', 'Statutory Liabilities', 'Current Liabilities', FALSE, '', ''),
  ('3305', 'PAYE Payable', 'liability', 'Statutory Liabilities', 'Payroll', FALSE, '', ''),
  ('3306', 'NSSF Payable', 'liability', 'Statutory Liabilities', 'Payroll', FALSE, '', ''),
  ('3307', 'SHIF Payable', 'liability', 'Statutory Liabilities', 'Payroll', FALSE, '', ''),
  ('3308', 'Affordable Housing Levy Payable', 'liability', 'Statutory Liabilities', 'Payroll', FALSE, '', ''),
  ('3309', 'Pension Payable', 'liability', 'Statutory Liabilities', 'Payroll', FALSE, '', ''),
  ('3311', 'Other Payroll Deductions Payable', 'liability', 'Payroll Liabilities', 'Other Deductions', FALSE, '', ''),
  ('5000', 'Sales — Products (Invoices)', 'revenue', 'Revenue - Products', 'Product', TRUE, 'revenue', ''),
  ('5105', 'Interest Income', 'revenue', 'Other Income', 'Finance', FALSE, '', ''),
  ('6001', 'Cost of Goods Sold', 'expense', 'Direct Expenses', 'COGS', FALSE, '', ''),
  ('6108', 'Trade-in Purchases', 'expense', 'Local Purchases', 'Trade-in', FALSE, '', ''),
  ('6201', 'Salaries and Wages', 'expense', 'Salaries Expense', 'Payroll', FALSE, '', ''),
  ('6202', 'Employer NSSF Expense', 'expense', 'Salaries Expense', 'Statutory Employer Cost', FALSE, '', ''),
  ('6203', 'Employer Housing Levy Expense', 'expense', 'Salaries Expense', 'Statutory Employer Cost', FALSE, '', ''),
  ('6401', 'Bank Charges', 'expense', 'Finance Costs', 'Bank', FALSE, '', '')
) AS v(code, name, account_type, account_group, sub_group, is_dynamic, dynamic_key, notes)
WHERE NOT EXISTS (SELECT 1 FROM account_codes a WHERE a.code = v.code);

INSERT INTO bank_accounts (id, name, account_number, currency_code, gl_account_id, is_active, created_at, updated_at)
SELECT gen_random_uuid(), v.name, v.account_number, 'KES', a.id, TRUE, NOW(), NOW()
FROM (VALUES
  ('NCBA Current Account', '1005157785', '2201'),
  ('ABSA Current Account', '2043953071', '2201'),
  ('I&M Current Account', '00105512776350', '2201'),
  ('Equity Bank Account', '0020284195905', '2202'),
  ('Credit Bank Current', '0131006000351', '2201'),
  ('M-Pesa Paybill', '880100', '2211'),
  ('Petty Cash Float', 'CASH', '2211')
) AS v(name, account_number, gl_code)
JOIN account_codes a ON a.code = v.gl_code
WHERE NOT EXISTS (SELECT 1 FROM bank_accounts b WHERE b.name = v.name);

INSERT INTO fiscal_periods (id, name, date_from, date_to, state, created_at, updated_at)
SELECT gen_random_uuid(), '2026', DATE '2026-01-01', DATE '2026-12-31', 'open', NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM fiscal_periods
  WHERE date_from = DATE '2026-01-01' AND date_to = DATE '2026-12-31'
);

COMMIT;
